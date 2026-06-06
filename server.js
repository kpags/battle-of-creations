const crypto = require("crypto");
const { once } = require("events");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { promisify } = require("util");
const { URL } = require("url");
const zlib = require("zlib");

const ROOT_DIR = __dirname;
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(ROOT_DIR, "data", "store.json");
const DATA_DIR = path.dirname(DATA_FILE);
const SESSIONS_FILE = process.env.SESSIONS_FILE
  ? path.resolve(process.env.SESSIONS_FILE)
  : path.join(
      DATA_DIR,
      `${path.basename(DATA_FILE, path.extname(DATA_FILE))}.sessions.json`
    );
const MEDIA_DIR = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(DATA_DIR, "media");
const PORT = Number(process.env.PORT || 5173);
const COOKIE_NAME = "boc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 256 * 1024 * 1024);
const MAX_MEDIA_BYTES = Number(process.env.MAX_MEDIA_BYTES || 16 * 1024 * 1024);
const MAX_IMPORT_RECORDS = 1000;
const MAX_ACTIVE_IMPORTS_PER_USER = 2;
const BACKGROUND_TASK_RETENTION_MS = 60 * 60 * 1000;
const MEDIA_MIGRATION_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.MEDIA_MIGRATION_CONCURRENCY || 4))
);
const scrypt = promisify(crypto.scrypt);
const gzip = promisify(zlib.gzip);
let storeCache = null;
let storeLoadPromise = null;
let storeMutationQueue = Promise.resolve();
let mediaDirectoryPromise = null;
const backgroundTasks = new Map();
const collectionResponseCache = new Map();
const collectionResponseBuilds = new Map();
const mediaFileInfoCache = new Map();
let storeIndexes = null;
let storeRevision = 0;

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

function defaultStore() {
  return {
    users: [],
    sessions: {},
    cards: [],
    decks: []
  };
}

function addOwnedRecord(index, record) {
  const ownerId = String(record?.ownerId || "");
  if (!ownerId) return;
  const records = index.get(ownerId);
  if (records) {
    records.push(record);
  } else {
    index.set(ownerId, [record]);
  }
}

function addMediaOwner(index, kind, record) {
  const config = MEDIA_CONFIG[kind];
  const ownerId = String(record?.ownerId || "");
  const fileName = String(record?.[config?.privateField] || "");
  if (!config || !ownerId || !fileName || path.basename(fileName) !== fileName) return;

  const key = `${kind}:${fileName}`;
  const owners = index.get(key);
  if (owners) {
    owners.add(ownerId);
  } else {
    index.set(key, new Set([ownerId]));
  }
}

function rebuildStoreIndexes(store) {
  const nextIndexes = {
    usersById: new Map(),
    usersByEmail: new Map(),
    usersByUsername: new Map(),
    cardsById: new Map(),
    cardsByOwner: new Map(),
    decksById: new Map(),
    decksByOwner: new Map(),
    mediaOwners: new Map()
  };

  for (const user of store.users) {
    nextIndexes.usersById.set(String(user.id), user);
    nextIndexes.usersByEmail.set(normalizeEmail(user.email), user);
    nextIndexes.usersByUsername.set(String(user.username || "").trim().toLowerCase(), user);
  }
  for (const card of store.cards) {
    nextIndexes.cardsById.set(String(card.id), card);
    addOwnedRecord(nextIndexes.cardsByOwner, card);
    addMediaOwner(nextIndexes.mediaOwners, "card", card);
  }
  for (const deck of store.decks) {
    nextIndexes.decksById.set(String(deck.id), deck);
    addOwnedRecord(nextIndexes.decksByOwner, deck);
    addMediaOwner(nextIndexes.mediaOwners, "deck", deck);
  }

  storeIndexes = nextIndexes;
  storeRevision += 1;
  collectionResponseCache.clear();
}

function ownedRecords(kind, ownerId) {
  const index = kind === "cards"
    ? storeIndexes?.cardsByOwner
    : storeIndexes?.decksByOwner;
  return index?.get(String(ownerId)) || [];
}

function recordById(kind, id) {
  const index = kind === "cards"
    ? storeIndexes?.cardsById
    : storeIndexes?.decksById;
  return index?.get(String(id)) || null;
}

function parseImageDataUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  const extension = MEDIA_EXTENSIONS[mimeType];
  if (!extension) return null;

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
    const error = new Error(`Uploaded images must be smaller than ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)} MB.`);
    error.status = 413;
    throw error;
  }

  return { buffer, extension, mimeType };
}

function mediaUrl(kind, fileName) {
  return `/api/media/${kind}/file/${encodeURIComponent(fileName)}`;
}

function normalizeStoredMediaUrl(record, kind) {
  const config = MEDIA_CONFIG[kind];
  const fileName = String(record?.[config?.privateField] || "");
  if (!config || !fileName || path.basename(fileName) !== fileName) return false;
  if (!MEDIA_MIME_TYPES[path.extname(fileName).toLowerCase()]) return false;

  const expectedUrl = mediaUrl(kind, fileName);
  if (record[config.publicField] === expectedUrl) return false;
  record[config.publicField] = expectedUrl;
  return true;
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

async function persistRecordMedia(record, kind) {
  const config = MEDIA_CONFIG[kind];
  if (!config) return false;

  const parsed = parseImageDataUrl(record[config.publicField]);
  if (!parsed) return false;

  const digest = crypto.createHash("sha256").update(parsed.buffer).digest("hex");
  const fileName = `${digest}${parsed.extension}`;
  const filePath = path.join(MEDIA_DIR, fileName);
  await ensureMediaDirectory();

  try {
    await fsp.writeFile(filePath, parsed.buffer, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  mediaFileInfoCache.set(fileName, { size: parsed.buffer.length });
  record[config.privateField] = fileName;
  record[config.publicField] = mediaUrl(kind, fileName);
  return true;
}

async function migrateEmbeddedMedia(store) {
  const records = [
    ...store.cards.map((record) => ({ record, kind: "card" })),
    ...store.decks.map((record) => ({ record, kind: "deck" }))
  ];
  if (records.length === 0) return false;

  let changed = false;
  let cursor = 0;
  const workerCount = Math.min(MEDIA_MIGRATION_CONCURRENCY, records.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < records.length) {
      const current = records[cursor];
      cursor += 1;
      if (await persistRecordMedia(current.record, current.kind)) {
        changed = true;
      }
    }
  }));
  for (const current of records) {
    changed = normalizeStoredMediaUrl(current.record, current.kind) || changed;
  }

  return changed;
}

async function loadStore() {
  if (storeCache) return storeCache;
  if (storeLoadPromise) return storeLoadPromise;

  storeLoadPromise = (async () => {
    try {
      const raw = await fsp.readFile(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      let sessions = parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
      try {
        const sessionRaw = await fsp.readFile(SESSIONS_FILE, "utf8");
        const persistedSessions = JSON.parse(sessionRaw);
        if (persistedSessions && typeof persistedSessions === "object" && !Array.isArray(persistedSessions)) {
          sessions = persistedSessions;
        }
      } catch (sessionError) {
        if (sessionError.code !== "ENOENT") throw sessionError;
      }
      storeCache = {
        ...defaultStore(),
        ...parsed,
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions,
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
        decks: Array.isArray(parsed.decks) ? parsed.decks : []
      };
      if (await migrateEmbeddedMedia(storeCache)) {
        await writeStoreAtomic(storeCache);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      storeCache = defaultStore();
    } finally {
      storeLoadPromise = null;
    }

    rebuildStoreIndexes(storeCache);
    return storeCache;
  })();

  return storeLoadPromise;
}

async function writeJsonAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(tempFile, JSON.stringify(payload));
    await renameWithRetry(tempFile, filePath);
  } catch (error) {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function renameWithRetry(sourcePath, destinationPath) {
  const retryableCodes = new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]);
  let lastError;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fsp.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error.code) || attempt === 7) break;
      if (process.platform === "win32" && attempt === 1) {
        try {
          await replaceFileOnWindows(sourcePath, destinationPath);
          return;
        } catch (replacementError) {
          try {
            await fsp.copyFile(sourcePath, destinationPath);
            await fsp.rm(sourcePath, { force: true }).catch(() => {});
            return;
          } catch (copyError) {
            lastError = copyError;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (2 ** attempt)));
    }
  }

  throw lastError;
}

async function replaceFileOnWindows(sourcePath, destinationPath) {
  const backupPath = `${destinationPath}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.bak`;
  let hasBackup = false;

  try {
    try {
      await fsp.rename(destinationPath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await fsp.rename(sourcePath, destinationPath);
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error.code)) throw error;
      await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
      await fsp.rm(sourcePath, { force: true }).catch(() => {});
    }

    if (hasBackup) {
      await fsp.rm(backupPath, { force: true }).catch(() => {});
    }
  } catch (error) {
    if (hasBackup) {
      await fsp.rm(destinationPath, { force: true }).catch(() => {});
      await fsp.rename(backupPath, destinationPath).catch(() => {});
    }
    throw error;
  }
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

async function writeStoreAtomic(store) {
  await writeJsonAtomic(DATA_FILE, {
    users: store.users,
    cards: store.cards,
    decks: store.decks
  });
}

async function saveSessions(sessions) {
  await writeJsonAtomic(SESSIONS_FILE, sessions);
}

async function saveStore(store, persistSessions = false) {
  const writes = [writeStoreAtomic(store)];
  if (persistSessions) {
    writes.push(saveSessions(store.sessions));
  }
  await Promise.all(writes);
}

async function updateStore(mutator, options = {}) {
  const runMutation = async () => {
    const store = await loadStore();
    const result = await mutator(store);
    if (result === null) return result;
    rebuildStoreIndexes(store);

    try {
      await saveStore(store, options.persistSessions === true);
    } catch (error) {
      storeCache = null;
      throw error;
    }
    return result;
  };

  const pending = storeMutationQueue.then(runMutation, runMutation);
  storeMutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function updateSessions(mutator) {
  const runMutation = async () => {
    const store = await loadStore();
    const result = await mutator(store.sessions, store);
    if (result === null) return result;
    await saveSessions(store.sessions);
    return result;
  };

  const pending = storeMutationQueue.then(runMutation, runMutation);
  storeMutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

async function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = Buffer.from(await scrypt(String(password), passwordSalt, 64)).toString("hex");
  return { passwordHash, passwordSalt };
}

async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) {
    return false;
  }

  const candidate = Buffer.from(await scrypt(String(password), user.passwordSalt, 64));
  const expected = Buffer.from(user.passwordHash, "hex");

  if (candidate.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(candidate, expected);
}

function publicUser(user) {
  if (!user) {
    return null;
  }

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

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function expiredSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
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
    "server.js"
  ]);

  return firstSegment === "data" || privateFiles.has(relativePath);
}

function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || "";
}

function getAuthenticatedUser(req, store) {
  const token = getSessionToken(req);
  const session = token ? store.sessions[token] : null;

  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  return storeIndexes?.usersById.get(String(session.userId))
    || store.users.find((user) => user.id === session.userId)
    || null;
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
  if (!raw.trim()) {
    return {};
  }

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

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
}

async function sendCachedCollectionJson(req, res, cacheKey, payloadFactory) {
  const revision = storeRevision;
  const versionedCacheKey = `${revision}:${cacheKey}`;
  let cached = collectionResponseCache.get(versionedCacheKey);
  if (!cached) {
    let build = collectionResponseBuilds.get(versionedCacheKey);
    if (!build) {
      build = (async () => {
        const raw = Buffer.from(JSON.stringify(payloadFactory()));
        const etag = `"${crypto.createHash("sha256").update(raw).digest("base64url")}"`;
        const response = {
          raw,
          gzip: raw.length >= 1024
            ? await gzip(raw, { level: zlib.constants.Z_BEST_SPEED })
            : null,
          etag
        };
        if (storeRevision === revision) {
          collectionResponseCache.set(versionedCacheKey, response);
        }
        return response;
      })();
      collectionResponseBuilds.set(versionedCacheKey, build);
      void build.then(
        () => collectionResponseBuilds.delete(versionedCacheKey),
        () => collectionResponseBuilds.delete(versionedCacheKey)
      );
    }
    cached = await build;
  }

  if (String(req.headers["if-none-match"] || "") === cached.etag) {
    res.writeHead(304, {
      "Cache-Control": "private, no-cache",
      ETag: cached.etag,
      Vary: "Accept-Encoding"
    });
    res.end();
    return;
  }

  const useGzip = acceptsGzip(req) && cached.gzip;
  const body = useGzip ? cached.gzip : cached.raw;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    ETag: cached.etag,
    Vary: "Accept-Encoding",
    ...(useGzip ? { "Content-Encoding": "gzip" } : {})
  });
  res.end(body);
}

async function streamJsonCollections(req, res, status, fields, collections, headers = {}) {
  const useGzip = acceptsGzip(req);
  const responseHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Accept-Encoding",
    ...headers
  };

  if (useGzip) {
    responseHeaders["Content-Encoding"] = "gzip";
  }

  res.writeHead(status, responseHeaders);
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
    const records = Array.isArray(collection.records) ? collection.records : [];
    const mapRecord = typeof collection.mapRecord === "function"
      ? collection.mapRecord
      : (record) => record;

    for (let index = 0; index < records.length; index += 1) {
      if (index > 0) await writeChunk(output, ",");
      await writeChunk(output, JSON.stringify(await mapRecord(records[index])));
    }

    await writeChunk(output, "]");
    needsComma = true;
  }

  output.end("}");
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function requireUser(req, res, store) {
  const user = getAuthenticatedUser(req, store);

  if (!user) {
    sendError(res, 401, "You must be logged in.");
    return null;
  }

  return user;
}

function withOwner(record, user) {
  return {
    ...record,
    ownerId: user.id,
    ownerEmail: user.email,
    ownerUsername: user.username
  };
}

async function upsertOwnedRecord(records, payload, user, prefix, mediaKind = "") {
  const now = new Date().toISOString();
  const id = String(payload.id || createId(prefix));
  const existingIndex = records.findIndex((record) => record.id === id);

  if (existingIndex >= 0 && records[existingIndex].ownerId !== user.id) {
    const error = new Error("This record belongs to another user.");
    error.status = 403;
    throw error;
  }

  const preparedPayload = { ...payload };
  if (mediaKind) {
    await persistRecordMedia(preparedPayload, mediaKind);
  }

  const savedRecord = withOwner(
    {
      ...preparedPayload,
      id,
      updatedAt: now,
      createdAt: existingIndex >= 0 ? records[existingIndex].createdAt : now
    },
    user
  );

  if (existingIndex >= 0) {
    records[existingIndex] = {
      ...records[existingIndex],
      ...savedRecord
    };
  } else {
    records.push(savedRecord);
  }

  return savedRecord;
}

async function appendOwnedRecord(records, payload, user, prefix, timestamp, mediaKind = "") {
  const id = createId(prefix);
  const preparedPayload = { ...payload };
  if (mediaKind) {
    await persistRecordMedia(preparedPayload, mediaKind);
  }

  const savedRecord = withOwner(
    {
      ...preparedPayload,
      id,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    user
  );
  records.push(savedRecord);
  return savedRecord;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function portableRecord(record) {
  const excluded = new Set([
    "ownerId",
    "ownerEmail",
    "ownerUsername",
    "createdAt",
    "updatedAt",
    "_uploadedImageFile",
    "_thumbnailImageFile",
    "__proto__",
    "prototype",
    "constructor"
  ]);
  return Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !excluded.has(key))
  );
}

function clientRecord(record) {
  if (!record) return record;
  const result = { ...record };
  delete result._uploadedImageFile;
  delete result._thumbnailImageFile;
  return result;
}

async function portableRecordForExport(record, kind) {
  const portable = portableRecord(record);
  const config = MEDIA_CONFIG[kind];
  const fileName = config && record?.[config.privateField];
  if (!fileName || path.basename(fileName) !== fileName) return portable;

  try {
    const extension = path.extname(fileName).toLowerCase();
    const mimeType = MEDIA_MIME_TYPES[extension];
    if (!mimeType) return portable;
    const image = await fsp.readFile(path.join(MEDIA_DIR, fileName));
    portable[config.publicField] = `data:${mimeType};base64,${image.toString("base64")}`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return portable;
}

function validateImportPackage(body, expectedFormat) {
  if (!isPlainObject(body) || body.format !== expectedFormat || Number(body.version) !== 1) {
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
  if (records.length > MAX_IMPORT_RECORDS || records.some((record) => !isPlainObject(record))) {
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

async function importCardsIntoStore(store, user, records) {
  const idMap = new Map();
  const importedIds = [];
  const importedAt = new Date().toISOString();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sourceId = String(record.id || `card-${index}`);
    const payload = portableRecord(record);
    delete payload.id;
    payload.savedAt = importedAt;
    const saved = await appendOwnedRecord(store.cards, payload, user, "card", importedAt, "card");
    idMap.set(sourceId, saved.id);
    importedIds.push(saved.id);
  }

  return { idMap, importedIds };
}

async function importDecksIntoStore(store, user, records, cardIdMap) {
  const ownedCardIds = new Set(
    store.cards.filter((card) => card.ownerId === user.id).map((card) => card.id)
  );
  const importedIds = [];
  let skippedCardReferences = 0;
  const importedAt = new Date().toISOString();

  for (const record of records) {
    const payload = portableRecord(record);
    delete payload.id;
    const sourceCardIds = Array.isArray(record.cardIds) ? record.cardIds : [];
    payload.cardIds = sourceCardIds.map((sourceId) => {
      const normalizedId = String(sourceId);
      const mappedId = cardIdMap.get(normalizedId);
      if (mappedId) return mappedId;
      if (ownedCardIds.has(normalizedId)) return normalizedId;
      skippedCardReferences += 1;
      return "";
    }).filter(Boolean).slice(0, 50);
    if (record.coverCardId) {
      const sourceCoverId = String(record.coverCardId);
      payload.coverCardId = cardIdMap.get(sourceCoverId)
        || (ownedCardIds.has(sourceCoverId) ? sourceCoverId : "");
    }
    payload.savedAt = importedAt;
    const saved = await appendOwnedRecord(store.decks, payload, user, "deck", importedAt, "deck");
    importedIds.push(saved.id);
  }

  return { importedIds, skippedCardReferences };
}

function pruneBackgroundTasks() {
  const cutoff = Date.now() - BACKGROUND_TASK_RETENTION_MS;
  for (const [id, task] of backgroundTasks) {
    if (
      ["completed", "failed"].includes(task.status)
      && Date.parse(task.updatedAt) < cutoff
    ) {
      backgroundTasks.delete(id);
    }
  }
}

function publicBackgroundTask(task) {
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

function updateBackgroundTask(task, updates) {
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
}

function createBackgroundTask(user, kind, label, runner) {
  pruneBackgroundTasks();
  const activeCount = [...backgroundTasks.values()].filter(
    (task) => task.ownerId === user.id && ["queued", "running"].includes(task.status)
  ).length;

  if (activeCount >= MAX_ACTIVE_IMPORTS_PER_USER) {
    const error = new Error("Wait for an active import to finish before starting another.");
    error.status = 429;
    throw error;
  }

  const now = new Date().toISOString();
  const task = {
    id: createId("task"),
    ownerId: user.id,
    kind,
    label,
    status: "queued",
    progress: 0,
    message: `${label} queued.`,
    result: null,
    createdAt: now,
    updatedAt: now
  };
  backgroundTasks.set(task.id, task);

  setImmediate(async () => {
    updateBackgroundTask(task, {
      status: "running",
      progress: 10,
      message: `${label} is being processed.`
    });

    try {
      const result = await runner(task);
      updateBackgroundTask(task, {
        status: "completed",
        progress: 100,
        message: `${label} completed.`,
        result
      });
    } catch (error) {
      updateBackgroundTask(task, {
        status: "failed",
        progress: 100,
        message: error.status ? error.message : `${label} failed.`
      });
      console.error(`${label} failed:`, error);
    }
  });

  return task;
}

async function deleteOwnedCards(req, res) {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id)).filter(Boolean))]
    : [];

  if (ids.length === 0) {
    sendError(res, 400, "Select at least one card to delete.");
    return true;
  }

  const result = await updateStore((store) => {
    const user = requireUser(req, res, store);
    if (!user) {
      return null;
    }

    const idSet = new Set(ids);
    const deletedIds = [];
    store.cards = store.cards.filter((card) => {
      if (card.ownerId === user.id && idSet.has(card.id)) {
        deletedIds.push(card.id);
        return false;
      }

      return true;
    });

    store.decks = store.decks.map((deck) => {
      if (deck.ownerId !== user.id || !Array.isArray(deck.cardIds)) {
        return deck;
      }

      return {
        ...deck,
        cardIds: deck.cardIds.filter((cardId) => !idSet.has(cardId))
      };
    });

    return { deletedIds };
  });

  if (result) {
    sendJson(res, 200, {
      deletedIds: result.deletedIds,
      deletedCount: result.deletedIds.length
    });
  }

  return true;
}

async function deleteOwnedDecks(req, res) {
  const body = await readJson(req);
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id)).filter(Boolean))]
    : [];

  if (ids.length === 0) {
    sendError(res, 400, "Select at least one deck to delete.");
    return true;
  }

  const result = await updateStore((store) => {
    const user = requireUser(req, res, store);
    if (!user) return null;

    const idSet = new Set(ids);
    const deletedIds = [];
    store.decks = store.decks.filter((deck) => {
      if (deck.ownerId === user.id && idSet.has(deck.id)) {
        deletedIds.push(deck.id);
        return false;
      }
      return true;
    });

    return { deletedIds };
  });

  if (result) {
    sendJson(res, 200, {
      deletedIds: result.deletedIds,
      deletedCount: result.deletedIds.length
    });
  }

  return true;
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
    let pending = fsp.stat(filePath)
      .then((stats) => ({ size: stats.size }))
      .catch((error) => {
        mediaFileInfoCache.delete(fileName);
        throw error;
      });
    mediaFileInfoCache.set(fileName, pending);
    try {
      fileInfo = await pending;
      mediaFileInfoCache.set(fileName, fileInfo);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendError(res, 404, "Image not found.");
        return;
      }
      throw error;
    }
  } else if (typeof fileInfo.then === "function") {
    fileInfo = await fileInfo;
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
  fs.createReadStream(filePath)
    .on("error", () => res.destroy())
    .pipe(res);
}

async function serveOwnedMedia(req, res, store, kind, recordId) {
  const user = requireUser(req, res, store);
  if (!user) return;

  const config = MEDIA_CONFIG[kind];
  const record = config ? recordById(config.collection, recordId) : null;
  if (!record || record.ownerId !== user.id) {
    sendError(res, 404, "Image not found.");
    return;
  }

  await serveMediaFile(req, res, record[config.privateField]);
}

async function serveOwnedMediaByFile(req, res, store, kind, fileName) {
  const user = requireUser(req, res, store);
  if (!user) return;

  const owners = storeIndexes?.mediaOwners.get(`${kind}:${fileName}`);
  if (!owners?.has(String(user.id))) {
    sendError(res, 404, "Image not found.");
    return;
  }

  await serveMediaFile(req, res, fileName);
}

async function handleApi(req, res, pathname) {
  try {
    const method = String(req.method || "").toUpperCase();
    const routePath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

    const mediaFileMatch = routePath.match(/^\/api\/media\/(card|deck)\/file\/([^/]+)$/);
    if (method === "GET" && mediaFileMatch) {
      const store = await loadStore();
      await serveOwnedMediaByFile(
        req,
        res,
        store,
        mediaFileMatch[1],
        decodeURIComponent(mediaFileMatch[2])
      );
      return true;
    }

    const mediaMatch = routePath.match(/^\/api\/media\/(card|deck)\/([^/]+)$/);
    if (method === "GET" && mediaMatch) {
      const store = await loadStore();
      await serveOwnedMedia(req, res, store, mediaMatch[1], decodeURIComponent(mediaMatch[2]));
      return true;
    }

    if (method === "DELETE" && routePath === "/api/cards") {
      return await deleteOwnedCards(req, res);
    }

    if (method === "POST" && routePath === "/api/cards/delete") {
      return await deleteOwnedCards(req, res);
    }

    if (method === "DELETE" && routePath === "/api/decks") {
      return await deleteOwnedDecks(req, res);
    }

    if (method === "GET" && routePath === "/api/library") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;
      await sendCachedCollectionJson(req, res, `library:${user.id}`, () => ({
        cards: ownedRecords("cards", user.id).map(clientRecord),
        decks: ownedRecords("decks", user.id).map(clientRecord)
      }));
      return true;
    }

    if (method === "GET" && routePath === "/api/export/cards") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;
      const dateStamp = new Date().toISOString().slice(0, 10);
      await streamJsonCollections(req, res, 200, {
        format: "battle-of-creations/cards",
        version: 1,
        exportedAt: new Date().toISOString()
      }, {
        cards: {
          records: ownedRecords("cards", user.id),
          mapRecord: (record) => portableRecordForExport(record, "card")
        }
      }, {
        "Content-Disposition": `attachment; filename="battle-of-creations-cards-${dateStamp}.json"`
      });
      return true;
    }

    if (method === "GET" && routePath === "/api/export/decks") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;
      const decks = ownedRecords("decks", user.id);
      const referencedCardIds = new Set(
        decks.flatMap((deck) =>
          (Array.isArray(deck.cardIds) ? deck.cardIds : []).map((id) => String(id))
        )
      );
      const cards = ownedRecords("cards", user.id).filter(
        (card) => referencedCardIds.has(String(card.id))
      );
      const dateStamp = new Date().toISOString().slice(0, 10);
      await streamJsonCollections(req, res, 200, {
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
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;
      pruneBackgroundTasks();
      const task = backgroundTasks.get(decodeURIComponent(taskMatch[1]));
      if (!task || task.ownerId !== user.id) {
        sendError(res, 404, "Background task not found.");
        return true;
      }
      sendJson(res, 200, { task: publicBackgroundTask(task) });
      return true;
    }

    if (method === "GET" && routePath === "/api/tasks") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;
      pruneBackgroundTasks();
      const tasks = [...backgroundTasks.values()]
        .filter((task) => task.ownerId === user.id)
        .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
        .map(publicBackgroundTask);
      sendJson(res, 200, { tasks });
      return true;
    }

    if (method === "POST" && routePath === "/api/import/cards") {
      const body = await readJson(req);
      validateImportPackage(body, "battle-of-creations/cards");
      validateImportRecords(body.cards, "cards");
      validateUniqueSourceIds(body.cards, "card");
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;

      const task = createBackgroundTask(user, "cards-import", "Card import", async (activeTask) => {
        const result = await updateStore(async (latestStore) => {
          const latestUser = storeIndexes?.usersById.get(String(user.id));
          if (!latestUser) {
            const error = new Error("The importing account no longer exists.");
            error.status = 404;
            throw error;
          }
          updateBackgroundTask(activeTask, {
            progress: 45,
            message: "Importing cards into your library."
          });
          const imported = await importCardsIntoStore(latestStore, latestUser, body.cards);
          return { importedIds: imported.importedIds };
        });
        return {
          importedCount: result.importedIds.length,
          importedIds: result.importedIds
        };
      });

      sendJson(res, 202, { task: publicBackgroundTask(task) });
      return true;
    }

    if (method === "POST" && routePath === "/api/import/decks") {
      const body = await readJson(req);
      validateImportPackage(body, "battle-of-creations/decks");
      validateImportRecords(body.decks, "decks");
      validateUniqueSourceIds(body.decks, "deck");
      const bundledCards = Array.isArray(body.cards) ? body.cards : [];
      if (bundledCards.length > 0) {
        validateImportRecords(bundledCards, "cards");
        validateUniqueSourceIds(bundledCards, "card");
      }
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) return true;

      const task = createBackgroundTask(user, "decks-import", "Deck import", async (activeTask) => {
        const result = await updateStore(async (latestStore) => {
          const latestUser = storeIndexes?.usersById.get(String(user.id));
          if (!latestUser) {
            const error = new Error("The importing account no longer exists.");
            error.status = 404;
            throw error;
          }
          updateBackgroundTask(activeTask, {
            progress: 35,
            message: "Importing deck cards and rebuilding deck references."
          });
          const importedCards = bundledCards.length
            ? await importCardsIntoStore(latestStore, latestUser, bundledCards)
            : { idMap: new Map(), importedIds: [] };
          const importedDecks = await importDecksIntoStore(
            latestStore,
            latestUser,
            body.decks,
            importedCards.idMap
          );
          return {
            importedCardIds: importedCards.importedIds,
            importedDeckIds: importedDecks.importedIds,
            skippedCardReferences: importedDecks.skippedCardReferences
          };
        });
        return {
          importedCardCount: result.importedCardIds.length,
          importedDeckCount: result.importedDeckIds.length,
          importedCardIds: result.importedCardIds,
          importedDeckIds: result.importedDeckIds,
          skippedCardReferences: result.skippedCardReferences
        };
      });

      sendJson(res, 202, { task: publicBackgroundTask(task) });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/session") {
      const store = await loadStore();
      sendJson(res, 200, { user: publicUser(getAuthenticatedUser(req, store)) });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/register") {
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

      const result = await updateStore(async (store) => {
        if (storeIndexes?.usersByEmail.has(email)) {
          const error = new Error("An account with this email already exists.");
          error.status = 409;
          throw error;
        }

        if (storeIndexes?.usersByUsername.has(username.toLowerCase())) {
          const error = new Error("That username is already taken.");
          error.status = 409;
          throw error;
        }

        const user = {
          id: createId("user"),
          username,
          email,
          ...await hashPassword(password),
          level: 1,
          xp: 0,
          xpMax: 1000,
          gold: 1250,
          createdAt: new Date().toISOString()
        };
        const token = crypto.randomBytes(32).toString("hex");

        store.users.push(user);
        store.sessions[token] = {
          userId: user.id,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
        };

        return { user, token };
      }, { persistSessions: true });

      sendJson(res, 201, { user: publicUser(result.user) }, { "Set-Cookie": sessionCookie(result.token) });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readJson(req);
      const identifier = String(body.identifier || body.email || "").trim();
      const normalizedIdentifier = normalizeEmail(identifier);
      const password = String(body.password || "");

      if (!identifier || !password) {
        const error = new Error("Enter your email or username and password.");
        error.status = 400;
        throw error;
      }

      const store = await loadStore();
      const user = storeIndexes?.usersByEmail.get(normalizedIdentifier)
        || storeIndexes?.usersByUsername.get(normalizedIdentifier)
        || null;

      if (!user) {
        const error = new Error("Account not found. Create an account first.");
        error.status = 401;
        throw error;
      }

      if (!await verifyPassword(password, user)) {
        const error = new Error("Incorrect password.");
        error.status = 401;
        throw error;
      }

      const result = await updateSessions((sessions) => {
        const token = crypto.randomBytes(32).toString("hex");
        sessions[token] = {
          userId: user.id,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
        };

        return { user, token };
      });

      sendJson(res, 200, { user: publicUser(result.user) }, { "Set-Cookie": sessionCookie(result.token) });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const token = getSessionToken(req);
      await updateSessions((sessions) => {
        if (!token || !sessions[token]) return null;
        delete sessions[token];
        return true;
      });
      sendJson(res, 200, { ok: true }, { "Set-Cookie": expiredSessionCookie() });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/reset-password") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const password = String(body.newPassword || "");

      if (password.length < 6) {
        sendError(res, 400, "Password must be at least 6 characters.");
        return true;
      }

      await updateStore(async (store) => {
        const user = storeIndexes?.usersByEmail.get(email);
        if (!user) {
          return null;
        }

        Object.assign(user, await hashPassword(password), {
          passwordUpdatedAt: new Date().toISOString()
        });

        Object.entries(store.sessions).forEach(([token, session]) => {
          if (session.userId === user.id) {
            delete store.sessions[token];
          }
        });
      }, { persistSessions: true });

      sendJson(res, 200, {
        message: "If that account exists, the password has been reset."
      }, { "Set-Cookie": expiredSessionCookie() });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/cards") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) {
        return true;
      }

      await sendCachedCollectionJson(req, res, `cards:${user.id}`, () => ({
        cards: ownedRecords("cards", user.id).map(clientRecord)
      }));
      return true;
    }

    if (req.method === "POST" && pathname === "/api/cards") {
      const body = await readJson(req);
      const result = await updateStore(async (store) => {
        const user = requireUser(req, res, store);
        if (!user) {
          return null;
        }

        return upsertOwnedRecord(store.cards, body, user, "card", "card");
      });

      if (result) {
        sendJson(res, 200, { card: clientRecord(result) });
      }
      return true;
    }

    if (req.method === "GET" && pathname === "/api/decks") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) {
        return true;
      }

      await sendCachedCollectionJson(req, res, `decks:${user.id}`, () => ({
        decks: ownedRecords("decks", user.id).map(clientRecord)
      }));
      return true;
    }

    if (req.method === "POST" && pathname === "/api/decks") {
      const body = await readJson(req);
      const result = await updateStore(async (store) => {
        const user = requireUser(req, res, store);
        if (!user) {
          return null;
        }

        return upsertOwnedRecord(store.decks, body, user, "deck", "deck");
      });

      if (result) {
        sendJson(res, 200, { deck: clientRecord(result) });
      }
      return true;
    }

    if (pathname.startsWith("/api/")) {
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

  if (protectedPages.has(requestedPath)) {
    const store = await loadStore();
    if (!getAuthenticatedUser(req, store)) {
      res.writeHead(302, { Location: "/index.html" });
      res.end();
      return;
    }
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
    res.writeHead(304, {
      "Cache-Control": cacheControl,
      ETag: etag
    });
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
  fs.createReadStream(filePath)
    .on("error", () => res.destroy())
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (await handleApi(req, res, pathname)) {
    return;
  }

  await serveStatic(req, res, pathname);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.maxRequestsPerSocket = 1000;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Close the existing server or start this one on a different port.");
    console.error("PowerShell: $env:PORT=5174; npm start");
    console.error("Git Bash: PORT=5174 npm start");
    process.exit(1);
  }

  throw error;
});

loadStore()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Battle of Creations server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Could not load the Battle of Creations data store.");
    console.error(error);
    process.exit(1);
  });
