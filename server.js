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
const PORT = Number(process.env.PORT || 5173);
const COOKIE_NAME = "boc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES || 256 * 1024 * 1024);
const MAX_IMPORT_RECORDS = 1000;
const MAX_ACTIVE_IMPORTS_PER_USER = 2;
const BACKGROUND_TASK_RETENTION_MS = 60 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
let storeCache = null;
let storeLoadPromise = null;
let storeMutationQueue = Promise.resolve();
const backgroundTasks = new Map();

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
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      storeCache = defaultStore();
    } finally {
      storeLoadPromise = null;
    }

    return storeCache;
  })();

  return storeLoadPromise;
}

async function writeJsonAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(payload));
  await fsp.rename(tempFile, filePath);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

async function writeStoreAtomic(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  const output = fs.createWriteStream(tempFile, { encoding: "utf8" });

  try {
    await writeChunk(output, '{"users":[');
    for (let index = 0; index < store.users.length; index += 1) {
      if (index > 0) await writeChunk(output, ",");
      await writeChunk(output, JSON.stringify(store.users[index]));
    }

    await writeChunk(output, '],"cards":[');
    for (let index = 0; index < store.cards.length; index += 1) {
      if (index > 0) await writeChunk(output, ",");
      await writeChunk(output, JSON.stringify(store.cards[index]));
    }

    await writeChunk(output, '],"decks":[');
    for (let index = 0; index < store.decks.length; index += 1) {
      if (index > 0) await writeChunk(output, ",");
      await writeChunk(output, JSON.stringify(store.decks[index]));
    }
    output.end("]}");
    await once(output, "finish");
    await fsp.rename(tempFile, DATA_FILE);
  } catch (error) {
    output.destroy();
    await fsp.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveSessions(sessions) {
  await writeJsonAtomic(SESSIONS_FILE, sessions);
}

async function saveStore(store) {
  await Promise.all([
    writeStoreAtomic(store),
    saveSessions(store.sessions)
  ]);
}

async function updateStore(mutator) {
  const runMutation = async () => {
    const store = await loadStore();
    const result = await mutator(store);
    if (result === null) return result;

    try {
      await saveStore(store);
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
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index < 0) {
        return cookies;
      }

      cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
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

  return store.users.find((user) => user.id === session.userId) || null;
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
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
      await writeChunk(output, JSON.stringify(mapRecord(records[index])));
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

function upsertOwnedRecord(records, payload, user, prefix) {
  const now = new Date().toISOString();
  const id = String(payload.id || createId(prefix));
  const existingIndex = records.findIndex((record) => record.id === id);

  if (existingIndex >= 0 && records[existingIndex].ownerId !== user.id) {
    const error = new Error("This record belongs to another user.");
    error.status = 403;
    throw error;
  }

  const savedRecord = withOwner(
    {
      ...payload,
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
    "__proto__",
    "prototype",
    "constructor"
  ]);
  return Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !excluded.has(key))
  );
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

function importCardsIntoStore(store, user, records) {
  const idMap = new Map();
  const importedIds = [];

  records.forEach((record, index) => {
    const sourceId = String(record.id || `card-${index}`);
    const payload = portableRecord(record);
    delete payload.id;
    payload.savedAt = new Date().toISOString();
    const saved = upsertOwnedRecord(store.cards, payload, user, "card");
    idMap.set(sourceId, saved.id);
    importedIds.push(saved.id);
  });

  return { idMap, importedIds };
}

function importDecksIntoStore(store, user, records, cardIdMap) {
  const ownedCardIds = new Set(
    store.cards.filter((card) => card.ownerId === user.id).map((card) => card.id)
  );
  const importedIds = [];
  let skippedCardReferences = 0;

  records.forEach((record) => {
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
    payload.savedAt = new Date().toISOString();
    const saved = upsertOwnedRecord(store.decks, payload, user, "deck");
    importedIds.push(saved.id);
  });

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

async function handleApi(req, res, pathname) {
  try {
    const method = String(req.method || "").toUpperCase();
    const routePath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

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
      await streamJsonCollections(req, res, 200, {}, {
        cards: {
          records: store.cards.filter((card) => card.ownerId === user.id)
        },
        decks: {
          records: store.decks.filter((deck) => deck.ownerId === user.id)
        }
      });
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
          records: store.cards.filter((card) => card.ownerId === user.id),
          mapRecord: portableRecord
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
      const decks = store.decks.filter((deck) => deck.ownerId === user.id);
      const referencedCardIds = new Set(
        decks.flatMap((deck) =>
          (Array.isArray(deck.cardIds) ? deck.cardIds : []).map((id) => String(id))
        )
      );
      const cards = store.cards.filter(
        (card) => card.ownerId === user.id && referencedCardIds.has(String(card.id))
      );
      const dateStamp = new Date().toISOString().slice(0, 10);
      await streamJsonCollections(req, res, 200, {
        format: "battle-of-creations/decks",
        version: 1,
        exportedAt: new Date().toISOString()
      }, {
        decks: {
          records: decks,
          mapRecord: portableRecord
        },
        cards: {
          records: cards,
          mapRecord: portableRecord
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
        const result = await updateStore((latestStore) => {
          const latestUser = latestStore.users.find((storedUser) => storedUser.id === user.id);
          if (!latestUser) {
            const error = new Error("The importing account no longer exists.");
            error.status = 404;
            throw error;
          }
          updateBackgroundTask(activeTask, {
            progress: 45,
            message: "Importing cards into your library."
          });
          const imported = importCardsIntoStore(latestStore, latestUser, body.cards);
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
        const result = await updateStore((latestStore) => {
          const latestUser = latestStore.users.find((storedUser) => storedUser.id === user.id);
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
            ? importCardsIntoStore(latestStore, latestUser, bundledCards)
            : { idMap: new Map(), importedIds: [] };
          const importedDecks = importDecksIntoStore(
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
        if (store.users.some((user) => user.email === email)) {
          const error = new Error("An account with this email already exists.");
          error.status = 409;
          throw error;
        }

        if (store.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
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
      });

      sendJson(res, 201, { user: publicUser(result.user) }, { "Set-Cookie": sessionCookie(result.token) });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await readJson(req);
      const email = normalizeEmail(body.email);
      const password = String(body.password || "");
      const store = await loadStore();
      const user = store.users.find((storedUser) => storedUser.email === email);

      if (!user || !await verifyPassword(password, user)) {
        const error = new Error("Invalid email or password.");
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
        delete sessions[token];
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
        const user = store.users.find((storedUser) => storedUser.email === email);
        if (!user) {
          return;
        }

        Object.assign(user, await hashPassword(password), {
          passwordUpdatedAt: new Date().toISOString()
        });

        Object.entries(store.sessions).forEach(([token, session]) => {
          if (session.userId === user.id) {
            delete store.sessions[token];
          }
        });
      });

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

      await streamJsonCollections(req, res, 200, {}, {
        cards: {
          records: store.cards.filter((card) => card.ownerId === user.id)
        }
      });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/cards") {
      const body = await readJson(req);
      const result = await updateStore((store) => {
        const user = requireUser(req, res, store);
        if (!user) {
          return null;
        }

        return upsertOwnedRecord(store.cards, body, user, "card");
      });

      if (result) {
        sendJson(res, 200, { card: result });
      }
      return true;
    }

    if (req.method === "GET" && pathname === "/api/decks") {
      const store = await loadStore();
      const user = requireUser(req, res, store);
      if (!user) {
        return true;
      }

      await streamJsonCollections(req, res, 200, {}, {
        decks: {
          records: store.decks.filter((deck) => deck.ownerId === user.id)
        }
      });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/decks") {
      const body = await readJson(req);
      const result = await updateStore((store) => {
        const user = requireUser(req, res, store);
        if (!user) {
          return null;
        }

        return upsertOwnedRecord(store.decks, body, user, "deck");
      });

      if (result) {
        sendJson(res, 200, { deck: result });
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

  fs.createReadStream(filePath)
    .on("error", () => {
      res.writeHead(404);
      res.end("Not found");
    })
    .once("open", () => {
      const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      const cacheControl = requestedPath.startsWith("/assets/")
        ? "public, max-age=3600"
        : "no-cache";
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff"
      });
    })
    .pipe(res);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (await handleApi(req, res, pathname)) {
    return;
  }

  await serveStatic(req, res, pathname);
});

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
