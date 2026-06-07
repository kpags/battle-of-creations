const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const {
  closeDatabase,
  createSession,
  getMetadata,
  initDatabase,
  pool,
  setMetadata,
  upsertOwnedRecord,
  withTransaction
} = require("../database");

const sourcePath = path.resolve(process.argv[2] || path.join("data", "store.json"));
const sourceDirectory = path.dirname(sourcePath);
const sourceMediaDirectory = path.join(sourceDirectory, "media");
const destinationMediaDirectory = path.resolve(
  process.env.MEDIA_DIR || path.join("data", "media")
);
const force = process.argv.includes("--force");
const MEDIA_EXTENSIONS = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
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

async function copyMediaFile(fileName) {
  if (!fileName || path.basename(fileName) !== fileName) return "";
  await fs.mkdir(destinationMediaDirectory, { recursive: true });
  const source = path.join(sourceMediaDirectory, fileName);
  const destination = path.join(destinationMediaDirectory, fileName);
  if (path.resolve(source) === path.resolve(destination)) return fileName;
  try {
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return fileName;
}

async function extractEmbeddedMedia(record, publicField) {
  const value = String(record?.[publicField] || "");
  const match = value.match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i
  );
  if (!match) return "";
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  const extension = MEDIA_EXTENSIONS[match[1].toLowerCase()];
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  const fileName = `${digest}${extension}`;
  await fs.mkdir(destinationMediaDirectory, { recursive: true });
  try {
    await fs.writeFile(path.join(destinationMediaDirectory, fileName), buffer, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return fileName;
}

async function prepareRecord(record, kind) {
  const isCard = kind === "cards";
  const publicField = isCard ? "uploadedImage" : "thumbnailImage";
  const privateField = isCard ? "_uploadedImageFile" : "_thumbnailImageFile";
  let fileName = String(record?.[privateField] || record?._mediaFile || "");
  if (fileName) {
    fileName = await copyMediaFile(fileName);
  } else {
    fileName = await extractEmbeddedMedia(record, publicField);
  }
  const data = recordData(record);
  if (fileName) {
    data[publicField] = `/api/media/${isCard ? "card" : "deck"}/file/${encodeURIComponent(fileName)}`;
  }
  return { data, fileName };
}

async function migrate() {
  await initDatabase();
  const migrationKey = `json-import:${crypto.createHash("sha256").update(sourcePath).digest("hex")}`;
  if (!force && await getMetadata(migrationKey)) {
    console.log("This JSON store has already been migrated. Add --force to run it again.");
    return;
  }

  const store = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  let sessions = store.sessions && typeof store.sessions === "object" ? store.sessions : {};
  try {
    const sessionPath = path.join(
      sourceDirectory,
      `${path.basename(sourcePath, path.extname(sourcePath))}.sessions.json`
    );
    sessions = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const counts = await withTransaction(async (client) => {
    for (const user of store.users || []) {
      await client.query(
        `
          INSERT INTO users (
            id, username, username_key, email, email_key,
            password_hash, password_salt, level, xp, xp_max, gold,
            created_at, password_updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (id) DO UPDATE
          SET username = EXCLUDED.username,
              username_key = EXCLUDED.username_key,
              email = EXCLUDED.email,
              email_key = EXCLUDED.email_key,
              password_hash = EXCLUDED.password_hash,
              password_salt = EXCLUDED.password_salt,
              level = EXCLUDED.level,
              xp = EXCLUDED.xp,
              xp_max = EXCLUDED.xp_max,
              gold = EXCLUDED.gold,
              password_updated_at = EXCLUDED.password_updated_at
        `,
        [
          user.id,
          user.username,
          normalizeUsername(user.username),
          user.email,
          normalizeEmail(user.email),
          user.passwordHash,
          user.passwordSalt,
          user.level || 1,
          user.xp || 0,
          user.xpMax || 1000,
          user.gold || 0,
          user.createdAt || new Date().toISOString(),
          user.passwordUpdatedAt || null
        ]
      );
    }

    for (const [token, session] of Object.entries(sessions || {})) {
      if (!session?.userId || Date.parse(session.expiresAt) <= Date.now()) continue;
      await createSession(hashSessionToken(token), session.userId, session, client);
    }

    for (const card of store.cards || []) {
      const prepared = await prepareRecord(card, "cards");
      await upsertOwnedRecord("cards", {
        id: String(card.id),
        ownerId: String(card.ownerId),
        data: prepared.data,
        createdAt: card.createdAt || new Date().toISOString(),
        updatedAt: card.updatedAt || card.createdAt || new Date().toISOString()
      }, prepared.fileName, client);
    }

    for (const deck of store.decks || []) {
      const prepared = await prepareRecord(deck, "decks");
      await upsertOwnedRecord("decks", {
        id: String(deck.id),
        ownerId: String(deck.ownerId),
        data: prepared.data,
        createdAt: deck.createdAt || new Date().toISOString(),
        updatedAt: deck.updatedAt || deck.createdAt || new Date().toISOString()
      }, prepared.fileName, client);
    }

    await setMetadata(migrationKey, {
      sourcePath,
      migratedAt: new Date().toISOString()
    }, client);

    return {
      users: (store.users || []).length,
      cards: (store.cards || []).length,
      decks: (store.decks || []).length
    };
  });

  console.log(
    `Migrated ${counts.users} users, ${counts.cards} cards, and ${counts.decks} decks.`
  );
}

migrate()
  .catch((error) => {
    console.error("JSON migration failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
