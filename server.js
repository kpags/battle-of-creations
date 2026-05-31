const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 5173);
const COOKIE_NAME = "boc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const MAX_JSON_BYTES = 12 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
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
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultStore(),
      ...parsed,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      decks: Array.isArray(parsed.decks) ? parsed.decks : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultStore();
    }

    throw error;
  }
}

async function saveStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`);
}

async function updateStore(mutator) {
  const store = await loadStore();
  const result = await mutator(store);
  await saveStore(store);
  return result;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(String(password), passwordSalt, 64).toString("hex");
  return { passwordHash, passwordSalt };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) {
    return false;
  }

  const candidate = crypto.scryptSync(String(password), user.passwordSalt, 64);
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
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
  }

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

      const result = await updateStore((store) => {
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
          ...hashPassword(password),
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
      const result = await updateStore((store) => {
        const user = store.users.find((storedUser) => storedUser.email === email);

        if (!user || !verifyPassword(password, user)) {
          const error = new Error("Invalid email or password.");
          error.status = 401;
          throw error;
        }

        const token = crypto.randomBytes(32).toString("hex");
        store.sessions[token] = {
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
      await updateStore((store) => {
        delete store.sessions[token];
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

      await updateStore((store) => {
        const user = store.users.find((storedUser) => storedUser.email === email);
        if (!user) {
          return;
        }

        Object.assign(user, hashPassword(password), {
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

      sendJson(res, 200, {
        cards: store.cards.filter((card) => card.ownerId === user.id)
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

      sendJson(res, 200, {
        decks: store.decks.filter((deck) => deck.ownerId === user.id)
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
  const protectedPages = new Set(["/home.html", "/cards.html", "/card-creator.html", "/decks.html", "/deck-creator.html"]);

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
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Cache-Control": "no-cache",
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

server.listen(PORT, () => {
  console.log(`Battle of Creations server running at http://localhost:${PORT}`);
});
