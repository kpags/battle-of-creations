const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { promisify } = require("util");
const { URL } = require("url");
const zlib = require("zlib");

const {
  closeDatabase,
  createSession,
  createUser,
  deleteOwnedRecords,
  deleteSession,
  findMediaRecord,
  findOwnedRecord,
  findUserById,
  findUserByIdentifier,
  findUserBySession,
  initDatabase,
  listOwnedRecords,
  normalizeEmail,
  pool,
  removeCardReferences,
  resetUserPassword,
  upsertOwnedRecord,
  userOwnsMediaFile,
  withTransaction
} = require("./database");
const {
  closeTaskQueue,
  connectTaskQueue,
  createTask,
  getApiCache,
  getTaskForOwner,
  invalidateApiCache,
  listTasks,
  pingTaskQueue,
  runWorker,
  setApiCache
} = require("./task-queue");

const ROOT_DIR = __dirname;
const MEDIA_DIR = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(ROOT_DIR, "data", "media");
const PORT = Number(process.env.PORT || 5173);
const COOKIE_NAME = "boc_session";
const SESSION_MAX_AGE_SECONDS = Number(process.env.SESSION_MAX_AGE_SECONDS || 60 * 60 * 24 * 7);
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 256 * 1024 * 1024);
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES || 16 * 1024 * 1024);
const MAX_IMPORT_RECORDS = Number(process.env.MAX_IMPORT_RECORDS || 1000);
const API_CACHE_SECONDS = Number(process.env.API_CACHE_SECONDS || 30);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "").toLowerCase() === "true";
const scrypt = promisify(crypto.scrypt);
const gzip = promisify(zlib.gzip);
const responseCompressionCache = new Map();
const mediaFileInfoCache = new Map();
let mediaDirectoryPromise = null;
let shuttingDown = false;

const MEDIA_CONFIG = {
  card: {
    collection: "cards",
    publicField: "uploadedImage",
    privateField: "_uploadedImageFile"
  },
  deck: {
    collection: "decks",
    publicField: "thumbnailImage",
    privateField: "_thumbnailImageFile"
  }
};

const MEDIA_EXTENSIONS = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

const MEDIA_MIME_TYPES = Object.fromEntries(
  Object.entries(MEDIA_EXTENSIONS).map(([mimeType, extension]) => [extension, mimeType])
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = Buffer.from(
    await scrypt(String(password), passwordSalt, 64)
  ).toString("hex");
  return { passwordHash, passwordSalt };
}

async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const candidate = Buffer.from(await scrypt(String(password), user.passwordSalt, 64));
  const expected = Buffer.from(user.passwordHash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    level: user.level,
    xp: user.xp,
    xpMax: user.xpMax,
    gold: user.gold,
    createdAt: user.createdAt
  };
}

function parseCookies(req) {
  const cookies = {};
  const header = String(req.headers.cookie || "");
  let start = 0;
  while (start < header.length) {
    const end = header.indexOf(";", start);
    const part = header.slice(start, end < 0 ? header.length : end).trim();
    const separator = part.indexOf("=");
    if (separator >= 0) {
      cookies[part.slice(0, separator)] = decodeURIComponent(part.slice(separator + 1));
    }
    if (end < 0) break;
    start = end + 1;
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || "";
}

function sessionCookie(token) {
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

function expiredSessionCookie() {
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

async function getAuthenticatedUser(req, client = pool) {
  const token = getSessionToken(req);
  return token ? findUserBySession(hashSessionToken(token), client) : null;
}

async function requireUser(req, res, client = pool) {
  const user = await getAuthenticatedUser(req, client);
  if (!user) {
    sendError(res, 401, "You must be logged in.");
    return null;
  }
  return user;
}

async function readJson(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_JSON_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body.");
    error.status = 400;
    throw error;
  }
}

function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
}

async function sendCachedJson(req, res, cacheKey, payloadFactory) {
  let rawText = await getApiCache(cacheKey);
  if (!rawText) {
    rawText = JSON.stringify(await payloadFactory());
    await setApiCache(cacheKey, rawText, API_CACHE_SECONDS);
  }

  const raw = Buffer.from(rawText);
  const etag = `"${crypto.createHash("sha256").update(raw).digest("base64url")}"`;
  if (String(req.headers["if-none-match"] || "") === etag) {
    res.writeHead(304, {
      "Cache-Control": "private, no-cache",
      ETag: etag,
      Vary: "Accept-Encoding"
    });
    res.end();
    return;
  }

  let compressed = responseCompressionCache.get(etag);
  if (compressed === undefined) {
    compressed = raw.length >= 1024
      ? await gzip(raw, { level: zlib.constants.Z_BEST_SPEED })
      : null;
    responseCompressionCache.set(etag, compressed);
    if (responseCompressionCache.size > 200) {
      responseCompressionCache.delete(responseCompressionCache.keys().next().value);
    }
  }

  const useGzip = acceptsGzip(req) && compressed;
  const body = useGzip ? compressed : raw;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    Vary: "Accept-Encoding",
    ...(useGzip ? { "Content-Encoding": "gzip" } : {})
  });
  res.end(body);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve, reject) => {
      stream.once("drain", resolve);
      stream.once("error", reject);
    });
  }
}

async function streamJsonCollections(req, res, fields, collections, headers = {}) {
  const useGzip = acceptsGzip(req);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
    ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    ...headers
  });

  const output = useGzip
    ? zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })
    : res;
  if (useGzip) {
    output.on("error", () => res.destroy());
    output.pipe(res);
  }

  let needsComma = false;
  await writeChunk(output, "{");
  for (const [key, value] of Object.entries(fields || {})) {
    if (needsComma) await writeChunk(output, ",");
    await writeChunk(output, `${JSON.stringify(key)}:${JSON.stringify(value)}`);
    needsComma = true;
  }
  for (const [key, collection] of Object.entries(collections || {})) {
    if (needsComma) await writeChunk(output, ",");
    await writeChunk(output, `${JSON.stringify(key)}:[`);
    const records = collection.records || [];
    const mapRecord = collection.mapRecord || ((record) => record);
    for (let index = 0; index < records.length; index += 1) {
      if (index > 0) await writeChunk(output, ",");
      await writeChunk(output, JSON.stringify(await mapRecord(records[index])));
    }
    await writeChunk(output, "]");
    needsComma = true;
  }
  output.end("}");
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i
  );
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = MEDIA_EXTENSIONS[mimeType];
  if (!extension) return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
    const error = new Error(
      `Uploaded images must be smaller than ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)} MB.`
    );
    error.status = 413;
    throw error;
  }
  return { buffer, extension };
}

function ensureMediaDirectory() {
  if (!mediaDirectoryPromise) {
    mediaDirectoryPromise = fsp.mkdir(MEDIA_DIR, { recursive: true }).catch((error) => {
      mediaDirectoryPromise = null;
      throw error;
    });
  }
  return mediaDirectoryPromise;
}

function mediaUrl(kind, fileName) {
  return `/api/media/${kind}/file/${encodeURIComponent(fileName)}`;
}

async function persistRecordMedia(record, kind) {
  const config = MEDIA_CONFIG[kind];
  const parsed = config ? parseImageDataUrl(record[config.publicField]) : null;
  if (!parsed) return "";
  const digest = crypto.createHash("sha256").update(parsed.buffer).digest("hex");
  const fileName = `${digest}${parsed.extension}`;
  await ensureMediaDirectory();
  try {
    await fsp.writeFile(path.join(MEDIA_DIR, fileName), parsed.buffer, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  mediaFileInfoCache.set(fileName, { size: parsed.buffer.length });
  record[config.publicField] = mediaUrl(kind, fileName);
  return fileName;
}

function clientRecord(record) {
  if (!record) return record;
  const result = { ...record };
  delete result._uploadedImageFile;
  delete result._thumbnailImageFile;
  delete result._mediaFile;
  return result;
}

function recordData(record) {
  const result = { ...(record || {}) };
  [
    "id",
    "ownerId",
    "ownerEmail",
    "ownerUsername",
    "createdAt",
    "updatedAt",
    "_uploadedImageFile",
    "_thumbnailImageFile",
    "_mediaFile"
  ].forEach((key) => delete result[key]);
  return result;
}

function portableRecord(record) {
  const result = recordData(record);
  delete result.__proto__;
  delete result.prototype;
  delete result.constructor;
  result.id = record.id;
  return result;
}

async function portableRecordForExport(record, kind) {
  const portable = portableRecord(record);
  const fileName = record._mediaFile;
  if (!fileName || path.basename(fileName) !== fileName) return portable;
  try {
    const mimeType = MEDIA_MIME_TYPES[path.extname(fileName).toLowerCase()];
    if (!mimeType) return portable;
    const image = await fsp.readFile(path.join(MEDIA_DIR, fileName));
    portable[MEDIA_CONFIG[kind].publicField] =
      `data:${mimeType};base64,${image.toString("base64")}`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return portable;
}

async function saveOwnedRecord(kind, payload, user, options = {}, client = pool) {
  const collection = kind === "card" ? "cards" : "decks";
  const prefix = kind;
  const id = String(options.newId ? createId(prefix) : payload.id || createId(prefix));
  const existing = options.newId ? null : await findOwnedRecord(collection, id, user.id, client);
  const now = options.timestamp || new Date().toISOString();
  const prepared = {
    ...(existing ? recordData(existing) : {}),
    ...recordData(payload)
  };
  const newMediaFile = await persistRecordMedia(prepared, kind);
  const mediaFile = newMediaFile || existing?._mediaFile || "";
  const config = MEDIA_CONFIG[kind];
  if (mediaFile && !prepared[config.publicField]) {
    prepared[config.publicField] = mediaUrl(kind, mediaFile);
  }

  const saved = await upsertOwnedRecord(collection, {
    id,
    ownerId: user.id,
    data: prepared,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }, mediaFile, client);
  if (!saved) {
    const error = new Error("This record belongs to another user.");
    error.status = 403;
    throw error;
  }
  return {
    ...prepared,
    id,
    ownerId: user.id,
    ownerEmail: user.email,
    ownerUsername: user.username,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    _mediaFile: mediaFile
  };
}

function validateImportPackage(body, expectedFormat) {
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || body.format !== expectedFormat
    || Number(body.version) !== 1
  ) {
    const error = new Error("This is not a supported Battle of Creations export file.");
    error.status = 400;
    throw error;
  }
}

function validateImportRecords(records, label) {
  if (!Array.isArray(records) || records.length === 0) {
    const error = new Error(`The import file does not contain any ${label}.`);
    error.status = 400;
    throw error;
  }
  if (
    records.length > MAX_IMPORT_RECORDS
    || records.some((record) => !record || typeof record !== "object" || Array.isArray(record))
  ) {
    const error = new Error(`The import contains too many or invalid ${label}.`);
    error.status = 400;
    throw error;
  }
}

function validateUniqueSourceIds(records, label) {
  const ids = new Set();
  records.forEach((record, index) => {
    const id = String(record.id || `${label}-${index}`);
    if (ids.has(id)) {
      const error = new Error(`The import contains duplicate ${label} identifiers.`);
      error.status = 400;
      throw error;
    }
    ids.add(id);
  });
}

async function processCardImport(task, payload, updateProgress) {
  return withTransaction(async (client) => {
    const user = await findUserById(task.ownerId, client);
    if (!user) {
      const error = new Error("The importing account no longer exists.");
      error.status = 404;
      throw error;
    }
    const importedIds = [];
    const importedAt = new Date().toISOString();
    for (let index = 0; index < payload.cards.length; index += 1) {
      const saved = await saveOwnedRecord(
        "card",
        { ...portableRecord(payload.cards[index]), savedAt: importedAt },
        user,
        { newId: true, timestamp: importedAt },
        client
      );
      importedIds.push(saved.id);
      if (index > 0 && index % 25 === 0) {
        await updateProgress({
          progress: Math.min(90, 20 + Math.floor((index / payload.cards.length) * 70)),
          message: `Imported ${index} of ${payload.cards.length} cards.`
        });
      }
    }
    return { importedCount: importedIds.length, importedIds };
  }).then(async (result) => {
    await invalidateApiCache(task.ownerId);
    return result;
  });
}

async function processDeckImport(task, payload, updateProgress) {
  return withTransaction(async (client) => {
    const user = await findUserById(task.ownerId, client);
    if (!user) {
      const error = new Error("The importing account no longer exists.");
      error.status = 404;
      throw error;
    }

    const idMap = new Map();
    const importedCardIds = [];
    const importedDeckIds = [];
    const importedAt = new Date().toISOString();
    const bundledCards = Array.isArray(payload.cards) ? payload.cards : [];
    for (let index = 0; index < bundledCards.length; index += 1) {
      const sourceId = String(bundledCards[index].id || `card-${index}`);
      const saved = await saveOwnedRecord(
        "card",
        { ...portableRecord(bundledCards[index]), savedAt: importedAt },
        user,
        { newId: true, timestamp: importedAt },
        client
      );
      idMap.set(sourceId, saved.id);
      importedCardIds.push(saved.id);
    }

    const ownedCards = await listOwnedRecords("cards", user.id, client);
    const ownedCardIds = new Set(ownedCards.map((card) => String(card.id)));
    let skippedCardReferences = 0;
    for (let index = 0; index < payload.decks.length; index += 1) {
      const source = payload.decks[index];
      const data = portableRecord(source);
      data.cardIds = (Array.isArray(source.cardIds) ? source.cardIds : [])
        .map((sourceId) => {
          const normalizedId = String(sourceId);
          const mapped = idMap.get(normalizedId);
          if (mapped) return mapped;
          if (ownedCardIds.has(normalizedId)) return normalizedId;
          skippedCardReferences += 1;
          return "";
        })
        .filter(Boolean)
        .slice(0, 50);
      if (source.coverCardId) {
        const coverId = String(source.coverCardId);
        data.coverCardId = idMap.get(coverId)
          || (ownedCardIds.has(coverId) ? coverId : "");
      }
      data.savedAt = importedAt;
      const saved = await saveOwnedRecord(
        "deck",
        data,
        user,
        { newId: true, timestamp: importedAt },
        client
      );
      importedDeckIds.push(saved.id);
      if (index > 0 && index % 25 === 0) {
        await updateProgress({
          progress: Math.min(90, 45 + Math.floor((index / payload.decks.length) * 45)),
          message: `Imported ${index} of ${payload.decks.length} decks.`
        });
      }
    }

    return {
      importedCardCount: importedCardIds.length,
      importedDeckCount: importedDeckIds.length,
      importedCardIds,
      importedDeckIds,
      skippedCardReferences
    };
  }).then(async (result) => {
    await invalidateApiCache(task.ownerId);
    return result;
  });
}

async function processBackgroundTask(task, payload, updateProgress) {
  if (task.kind === "cards-import") {
    return processCardImport(task, payload, updateProgress);
  }
  if (task.kind === "decks-import") {
    return processDeckImport(task, payload, updateProgress);
  }
  const error = new Error(`Unsupported background task: ${task.kind}`);
  error.status = 400;
  throw error;
}

function publicBackgroundTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    kind: task.kind,
    label: task.label,
    status: task.status,
    progress: task.progress,
    message: task.message,
    result: task.result || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

async function deleteCards(req, res) {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(String).filter(Boolean))]
    : [];
  if (ids.length === 0) {
    sendError(res, 400, "Select at least one card to delete.");
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;
  const deletedIds = await withTransaction(async (client) => {
    const removed = await deleteOwnedRecords("cards", ids, user.id, client);
    if (removed.length > 0) await removeCardReferences(user.id, removed, client);
    return removed;
  });
  await invalidateApiCache(user.id);
  sendJson(res, 200, { deletedIds, deletedCount: deletedIds.length });
}

async function deleteDecks(req, res) {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map(String).filter(Boolean))]
    : [];
  if (ids.length === 0) {
    sendError(res, 400, "Select at least one deck to delete.");
    return;
  }
  const user = await requireUser(req, res);
  if (!user) return;
  const deletedIds = await deleteOwnedRecords("decks", ids, user.id);
  await invalidateApiCache(user.id);
  sendJson(res, 200, { deletedIds, deletedCount: deletedIds.length });
}

async function serveMediaFile(req, res, fileName) {
  if (!fileName || path.basename(fileName) !== fileName) {
    sendError(res, 404, "Image not found.");
    return;
  }
  const extension = path.extname(fileName).toLowerCase();
  const mimeType = MEDIA_MIME_TYPES[extension];
  if (!mimeType) {
    sendError(res, 404, "Image not found.");
    return;
  }
  const filePath = path.join(MEDIA_DIR, fileName);
  let fileInfo = mediaFileInfoCache.get(fileName);
  if (!fileInfo) {
    try {
      const stats = await fsp.stat(filePath);
      fileInfo = { size: stats.size };
      mediaFileInfoCache.set(fileName, fileInfo);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendError(res, 404, "Image not found.");
        return;
      }
      throw error;
    }
  }
  const etag = `"${path.basename(fileName, extension)}"`;
  if (String(req.headers["if-none-match"] || "") === etag) {
    res.writeHead(304, {
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag
    });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": fileInfo.size,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ETag: etag
  });
  fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

async function handleApi(req, res, pathname) {
  try {
    const method = String(req.method || "").toUpperCase();
    const routePath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

    if (method === "GET" && routePath === "/api/health") {
      await Promise.all([pool.query("SELECT 1"), pingTaskQueue()]);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const mediaFileMatch = routePath.match(/^\/api\/media\/(card|deck)\/file\/([^/]+)$/);
    if (method === "GET" && mediaFileMatch) {
      const user = await requireUser(req, res);
      if (!user) return true;
      const kind = mediaFileMatch[1];
      const fileName = decodeURIComponent(mediaFileMatch[2]);
      if (!await userOwnsMediaFile(kind, fileName, user.id)) {
        sendError(res, 404, "Image not found.");
        return true;
      }
      await serveMediaFile(req, res, fileName);
      return true;
    }

    const legacyMediaMatch = routePath.match(/^\/api\/media\/(card|deck)\/([^/]+)$/);
    if (method === "GET" && legacyMediaMatch) {
      const user = await requireUser(req, res);
      if (!user) return true;
      const fileName = await findMediaRecord(
        legacyMediaMatch[1],
        decodeURIComponent(legacyMediaMatch[2]),
        user.id
      );
      if (!fileName) {
        sendError(res, 404, "Image not found.");
        return true;
      }
      await serveMediaFile(req, res, fileName);
      return true;
    }

    if ((method === "DELETE" && routePath === "/api/cards")
      || (method === "POST" && routePath === "/api/cards/delete")) {
      await deleteCards(req, res);
      return true;
    }
    if (method === "DELETE" && routePath === "/api/decks") {
      await deleteDecks(req, res);
      return true;
    }

    if (method === "GET" && routePath === "/api/session") {
      sendJson(res, 200, { user: publicUser(await getAuthenticatedUser(req)) });
      return true;
    }

    if (method === "POST" && routePath === "/api/register") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      if (username.length < 6) {
        sendError(res, 400, "Username must be at least 6 characters.");
        return true;
      }
      if (!email || !email.includes("@")) {
        sendError(res, 400, "Enter a valid email address.");
        return true;
      }
      if (password.length < 6) {
        sendError(res, 400, "Password must be at least 6 characters.");
        return true;
      }

      const now = new Date();
      const user = {
        id: createId("user"),
        username,
        email,
        ...await hashPassword(password),
        level: 1,
        xp: 0,
        xpMax: 1000,
        gold: 1250,
        createdAt: now.toISOString()
      };
      const token = crypto.randomBytes(32).toString("hex");
      try {
        await withTransaction((client) => createUser(
          user,
          hashSessionToken(token),
          {
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
          },
          client
        ));
      } catch (error) {
        if (error.code === "23505") {
          const duplicate = String(error.constraint || "").includes("username")
            ? "That username is already taken."
            : "An account with this email already exists.";
          sendError(res, 409, duplicate);
          return true;
        }
        throw error;
      }
      sendJson(res, 201, { user: publicUser(user) }, {
        "Set-Cookie": sessionCookie(token)
      });
      return true;
    }

    if (method === "POST" && routePath === "/api/login") {
      const body = await readJson(req);
      const identifier = String(body.identifier || body.email || "").trim();
      const password = String(body.password || "");
      if (!identifier || !password) {
        sendError(res, 400, "Enter your email or username and password.");
        return true;
      }
      const user = await findUserByIdentifier(identifier);
      if (!user) {
        sendError(res, 401, "Account not found. Create an account first.");
        return true;
      }
      if (!await verifyPassword(password, user)) {
        sendError(res, 401, "Incorrect password.");
        return true;
      }
      const token = crypto.randomBytes(32).toString("hex");
      const now = new Date();
      await createSession(hashSessionToken(token), user.id, {
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
      });
      sendJson(res, 200, { user: publicUser(user) }, {
        "Set-Cookie": sessionCookie(token)
      });
      return true;
    }

    if (method === "POST" && routePath === "/api/logout") {
      const token = getSessionToken(req);
      if (token) await deleteSession(hashSessionToken(token));
      sendJson(res, 200, { ok: true }, {
        "Set-Cookie": expiredSessionCookie()
      });
      return true;
    }

    if (method === "POST" && routePath === "/api/reset-password") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const password = String(body.newPassword || "");
      if (password.length < 6) {
        sendError(res, 400, "Password must be at least 6 characters.");
        return true;
      }
      await withTransaction(async (client) => {
        const user = await findUserByIdentifier(email, client);
        if (!user || normalizeEmail(user.email) !== email) return;
        await resetUserPassword(email, await hashPassword(password), client);
      });
      sendJson(res, 200, {
        message: "If that account exists, the password has been reset."
      }, {
        "Set-Cookie": expiredSessionCookie()
      });
      return true;
    }

    if (method === "GET" && routePath === "/api/cards") {
      const user = await requireUser(req, res);
      if (!user) return true;
      await sendCachedJson(req, res, `cards:${user.id}`, async () => ({
        cards: (await listOwnedRecords("cards", user.id)).map(clientRecord)
      }));
      return true;
    }

    if (method === "POST" && routePath === "/api/cards") {
      const body = await readJson(req);
      const user = await requireUser(req, res);
      if (!user) return true;
      const saved = await saveOwnedRecord("card", body, user);
      await invalidateApiCache(user.id);
      sendJson(res, 200, { card: clientRecord(saved) });
      return true;
    }

    if (method === "GET" && routePath === "/api/decks") {
      const user = await requireUser(req, res);
      if (!user) return true;
      await sendCachedJson(req, res, `decks:${user.id}`, async () => ({
        decks: (await listOwnedRecords("decks", user.id)).map(clientRecord)
      }));
      return true;
    }

    if (method === "POST" && routePath === "/api/decks") {
      const body = await readJson(req);
      const user = await requireUser(req, res);
      if (!user) return true;
      const saved = await saveOwnedRecord("deck", body, user);
      await invalidateApiCache(user.id);
      sendJson(res, 200, { deck: clientRecord(saved) });
      return true;
    }

    if (method === "GET" && routePath === "/api/library") {
      const user = await requireUser(req, res);
      if (!user) return true;
      await sendCachedJson(req, res, `library:${user.id}`, async () => {
        const [cards, decks] = await Promise.all([
          listOwnedRecords("cards", user.id),
          listOwnedRecords("decks", user.id)
        ]);
        return {
          cards: cards.map(clientRecord),
          decks: decks.map(clientRecord)
        };
      });
      return true;
    }

    if (method === "GET" && routePath === "/api/export/cards") {
      const user = await requireUser(req, res);
      if (!user) return true;
      const cards = await listOwnedRecords("cards", user.id);
      const dateStamp = new Date().toISOString().slice(0, 10);
      await streamJsonCollections(req, res, {
        format: "battle-of-creations/cards",
        version: 1,
        exportedAt: new Date().toISOString()
      }, {
        cards: {
          records: cards,
          mapRecord: (record) => portableRecordForExport(record, "card")
        }
      }, {
        "Content-Disposition": `attachment; filename="battle-of-creations-cards-${dateStamp}.json"`
      });
      return true;
    }

    if (method === "GET" && routePath === "/api/export/decks") {
      const user = await requireUser(req, res);
      if (!user) return true;
      const [decks, allCards] = await Promise.all([
        listOwnedRecords("decks", user.id),
        listOwnedRecords("cards", user.id)
      ]);
      const referenced = new Set(
        decks.flatMap((deck) => Array.isArray(deck.cardIds) ? deck.cardIds.map(String) : [])
      );
      const cards = allCards.filter((card) => referenced.has(String(card.id)));
      const dateStamp = new Date().toISOString().slice(0, 10);
      await streamJsonCollections(req, res, {
        format: "battle-of-creations/decks",
        version: 1,
        exportedAt: new Date().toISOString()
      }, {
        decks: {
          records: decks,
          mapRecord: (record) => portableRecordForExport(record, "deck")
        },
        cards: {
          records: cards,
          mapRecord: (record) => portableRecordForExport(record, "card")
        }
      }, {
        "Content-Disposition": `attachment; filename="battle-of-creations-decks-${dateStamp}.json"`
      });
      return true;
    }

    const taskMatch = routePath.match(/^\/api\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      const user = await requireUser(req, res);
      if (!user) return true;
      const task = await getTaskForOwner(decodeURIComponent(taskMatch[1]), user.id);
      if (!task) {
        sendError(res, 404, "Background task not found.");
        return true;
      }
      sendJson(res, 200, { task: publicBackgroundTask(task) });
      return true;
    }

    if (method === "GET" && routePath === "/api/tasks") {
      const user = await requireUser(req, res);
      if (!user) return true;
      sendJson(res, 200, {
        tasks: (await listTasks(user.id)).map(publicBackgroundTask)
      });
      return true;
    }

    if (method === "POST" && routePath === "/api/import/cards") {
      const body = await readJson(req);
      validateImportPackage(body, "battle-of-creations/cards");
      validateImportRecords(body.cards, "cards");
      validateUniqueSourceIds(body.cards, "card");
      const user = await requireUser(req, res);
      if (!user) return true;
      const now = new Date().toISOString();
      const task = await createTask({
        id: createId("task"),
        ownerId: user.id,
        kind: "cards-import",
        label: "Card import",
        status: "queued",
        progress: 0,
        message: "Card import queued.",
        result: null,
        createdAt: now,
        updatedAt: now
      }, { cards: body.cards });
      sendJson(res, 202, { task: publicBackgroundTask(task) });
      return true;
    }

    if (method === "POST" && routePath === "/api/import/decks") {
      const body = await readJson(req);
      validateImportPackage(body, "battle-of-creations/decks");
      validateImportRecords(body.decks, "decks");
      validateUniqueSourceIds(body.decks, "deck");
      const cards = Array.isArray(body.cards) ? body.cards : [];
      if (cards.length > 0) {
        validateImportRecords(cards, "cards");
        validateUniqueSourceIds(cards, "card");
      }
      const user = await requireUser(req, res);
      if (!user) return true;
      const now = new Date().toISOString();
      const task = await createTask({
        id: createId("task"),
        ownerId: user.id,
        kind: "decks-import",
        label: "Deck import",
        status: "queued",
        progress: 0,
        message: "Deck import queued.",
        result: null,
        createdAt: now,
        updatedAt: now
      }, { decks: body.decks, cards });
      sendJson(res, 202, { task: publicBackgroundTask(task) });
      return true;
    }

    if (routePath.startsWith("/api/")) {
      sendError(res, 404, "API route not found.");
      return true;
    }
    return false;
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return true;
    }
    if (!error.status) {
      console.error(`${req.method || "REQUEST"} ${pathname} failed:`, error);
    }
    sendError(res, error.status || 500, error.status ? error.message : "Server error.");
    return true;
  }
}

function isOutsideRoot(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath);
}

function isPrivateStaticPath(filePath) {
  const relativePath = path.relative(ROOT_DIR, filePath);
  const firstSegment = relativePath.split(path.sep)[0];
  const privateFiles = new Set([
    "package.json",
    "package-lock.json",
    "progress.md",
    "server.js",
    "database.js",
    "task-queue.js",
    "compose.yaml",
    "Dockerfile"
  ]);
  return ["data", "db", "scripts", "node_modules"].includes(firstSegment)
    || privateFiles.has(relativePath);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.end("Method not allowed");
    return;
  }
  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  const protectedPages = new Set([
    "/home.html",
    "/cards.html",
    "/card-creator.html",
    "/decks.html",
    "/deck-creator.html",
    "/lobby.html",
    "/battle.html"
  ]);
  if (protectedPages.has(requestedPath) && !await getAuthenticatedUser(req)) {
    res.writeHead(302, { Location: "/index.html" });
    res.end();
    return;
  }
  try {
    requestedPath = decodeURIComponent(requestedPath);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const filePath = path.resolve(ROOT_DIR, `.${requestedPath}`);
  if (isOutsideRoot(filePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (isPrivateStaticPath(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  let stats;
  try {
    stats = await fsp.stat(filePath);
    if (!stats.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 500);
    res.end(error.code === "ENOENT" ? "Not found" : "Server error");
    return;
  }
  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  const isAsset = requestedPath.startsWith("/assets/");
  const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  const cacheControl = isAsset
    ? "public, max-age=86400"
    : "no-cache";
  if (String(req.headers["if-none-match"] || "") === etag) {
    res.writeHead(304, { "Cache-Control": cacheControl, ETag: etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Content-Length": stats.size,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    "Last-Modified": stats.mtime.toUTCString()
  });
  fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (await handleApi(req, res, pathname)) return;
  await serveStatic(req, res, pathname);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.maxRequestsPerSocket = 1000;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down.`);
  const serverClosed = new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([serverClosed, closeTaskQueue()]);
  await closeDatabase().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function initializeInfrastructure() {
  const attempts = Number(process.env.STARTUP_RETRY_ATTEMPTS || 30);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await Promise.all([initDatabase(), connectTaskQueue(), ensureMediaDirectory()]);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const delay = Math.min(5000, 500 * attempt);
      console.warn(`Infrastructure is not ready (attempt ${attempt}/${attempts}). Retrying.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

initializeInfrastructure()
  .then(() => {
    void runWorker(processBackgroundTask).catch((error) => {
      console.error("Redis background worker stopped:", error);
    });
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Battle of Creations server running at http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Could not initialize PostgreSQL or Redis.");
    console.error(error);
    process.exit(1);
  });
