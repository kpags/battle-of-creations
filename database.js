const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || "";
const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
  allowExitOnIdle: false
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function dateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    level: row.level,
    xp: row.xp,
    xpMax: row.xp_max,
    gold: row.gold,
    createdAt: dateValue(row.created_at),
    passwordUpdatedAt: dateValue(row.password_updated_at)
  };
}

function ownedRecordFromRow(row) {
  if (!row) return null;
  return {
    ...(row.data || {}),
    id: row.id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    ownerUsername: row.owner_username,
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    _mediaFile: row.media_file || ""
  };
}

function recordsQuery(table, whereClause) {
  return `
    SELECT
      r.id,
      r.owner_id,
      r.data,
      r.media_file,
      r.created_at,
      r.updated_at,
      users.email AS owner_email,
      users.username AS owner_username
    FROM ${table} AS r
    JOIN users ON users.id = r.owner_id
    ${whereClause}
  `;
}

async function initDatabase() {
  const schemaPath = path.join(__dirname, "db", "schema.sql");
  const schema = await fs.readFile(schemaPath, "utf8");
  await pool.query(schema);
}

async function closeDatabase() {
  await pool.end();
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findUserById(id, client = pool) {
  const result = await client.query("SELECT * FROM users WHERE id = $1", [String(id)]);
  return userFromRow(result.rows[0]);
}

async function findUserByIdentifier(identifier, client = pool) {
  const normalized = String(identifier || "").trim().toLowerCase();
  const result = await client.query(
    "SELECT * FROM users WHERE email_key = $1 OR username_key = $1 LIMIT 1",
    [normalized]
  );
  return userFromRow(result.rows[0]);
}

async function createUser(user, tokenHash, session, client = pool) {
  await client.query(
    `
      INSERT INTO users (
        id, username, username_key, email, email_key,
        password_hash, password_salt, level, xp, xp_max, gold, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      user.id,
      user.username,
      normalizeUsername(user.username),
      user.email,
      normalizeEmail(user.email),
      user.passwordHash,
      user.passwordSalt,
      user.level,
      user.xp,
      user.xpMax,
      user.gold,
      user.createdAt
    ]
  );
  await createSession(tokenHash, user.id, session, client);
  return user;
}

async function createSession(tokenHash, userId, session, client = pool) {
  await client.query(
    `
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (token_hash) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at
    `,
    [tokenHash, userId, session.createdAt, session.expiresAt]
  );
}

async function findUserBySession(tokenHash, client = pool) {
  if (!tokenHash) return null;
  const result = await client.query(
    `
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );
  return userFromRow(result.rows[0]);
}

async function deleteSession(tokenHash, client = pool) {
  if (!tokenHash) return false;
  const result = await client.query(
    "DELETE FROM sessions WHERE token_hash = $1",
    [tokenHash]
  );
  return result.rowCount > 0;
}

async function resetUserPassword(email, passwordFields, client = pool) {
  const result = await client.query(
    `
      UPDATE users
      SET password_hash = $2,
          password_salt = $3,
          password_updated_at = NOW()
      WHERE email_key = $1
      RETURNING id
    `,
    [normalizeEmail(email), passwordFields.passwordHash, passwordFields.passwordSalt]
  );
  if (!result.rows[0]) return null;
  await client.query("DELETE FROM sessions WHERE user_id = $1", [result.rows[0].id]);
  return result.rows[0].id;
}

async function listOwnedRecords(kind, ownerId, client = pool) {
  const table = kind === "cards" ? "cards" : "decks";
  const result = await client.query(
    `${recordsQuery(table, "WHERE r.owner_id = $1")}
     ORDER BY r.updated_at DESC, r.id`,
    [String(ownerId)]
  );
  return result.rows.map(ownedRecordFromRow);
}

async function findOwnedRecord(kind, id, ownerId, client = pool) {
  const table = kind === "cards" ? "cards" : "decks";
  const result = await client.query(
    `${recordsQuery(table, "WHERE r.id = $1 AND r.owner_id = $2")}
     LIMIT 1`,
    [String(id), String(ownerId)]
  );
  return ownedRecordFromRow(result.rows[0]);
}

async function upsertOwnedRecord(kind, record, mediaFile, client = pool) {
  const table = kind === "cards" ? "cards" : "decks";
  const result = await client.query(
    `
      INSERT INTO ${table} (id, owner_id, data, media_file, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE
      SET data = EXCLUDED.data,
          media_file = COALESCE(EXCLUDED.media_file, ${table}.media_file),
          updated_at = EXCLUDED.updated_at
      WHERE ${table}.owner_id = EXCLUDED.owner_id
      RETURNING id, owner_id, data, media_file, created_at, updated_at
    `,
    [
      record.id,
      record.ownerId,
      JSON.stringify(record.data || {}),
      mediaFile || null,
      record.createdAt,
      record.updatedAt
    ]
  );
  return result.rows[0] || null;
}

async function deleteOwnedRecords(kind, ids, ownerId, client = pool) {
  const table = kind === "cards" ? "cards" : "decks";
  const result = await client.query(
    `DELETE FROM ${table}
     WHERE owner_id = $1 AND id = ANY($2::text[])
     RETURNING id`,
    [String(ownerId), ids.map(String)]
  );
  return result.rows.map((row) => row.id);
}

async function removeCardReferences(ownerId, cardIds, client = pool) {
  const result = await client.query(
    "SELECT id, data FROM decks WHERE owner_id = $1",
    [String(ownerId)]
  );
  const removed = new Set(cardIds.map(String));

  for (const row of result.rows) {
    const data = { ...(row.data || {}) };
    const previousIds = Array.isArray(data.cardIds) ? data.cardIds.map(String) : [];
    const nextIds = previousIds.filter((id) => !removed.has(id));
    if (nextIds.length === previousIds.length) continue;
    data.cardIds = nextIds;
    if (removed.has(String(data.coverCardId || ""))) data.coverCardId = "";
    await client.query(
      "UPDATE decks SET data = $2::jsonb, updated_at = NOW() WHERE id = $1",
      [row.id, JSON.stringify(data)]
    );
  }
}

async function findMediaRecord(kind, recordId, ownerId, client = pool) {
  const table = kind === "card" ? "cards" : "decks";
  const result = await client.query(
    `SELECT media_file FROM ${table} WHERE id = $1 AND owner_id = $2`,
    [String(recordId), String(ownerId)]
  );
  return result.rows[0]?.media_file || "";
}

async function userOwnsMediaFile(kind, fileName, ownerId, client = pool) {
  const table = kind === "card" ? "cards" : "decks";
  const result = await client.query(
    `SELECT 1 FROM ${table}
     WHERE owner_id = $1 AND media_file = $2
     LIMIT 1`,
    [String(ownerId), String(fileName)]
  );
  return result.rowCount > 0;
}

async function getMetadata(key, client = pool) {
  const result = await client.query(
    "SELECT value FROM app_metadata WHERE key = $1",
    [String(key)]
  );
  return result.rows[0]?.value || null;
}

async function setMetadata(key, value, client = pool) {
  await client.query(
    `
      INSERT INTO app_metadata (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
    `,
    [String(key), JSON.stringify(value || {})]
  );
}

module.exports = {
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
  getMetadata,
  initDatabase,
  listOwnedRecords,
  normalizeEmail,
  normalizeUsername,
  pool,
  removeCardReferences,
  resetUserPassword,
  setMetadata,
  upsertOwnedRecord,
  userOwnsMediaFile,
  withTransaction
};
