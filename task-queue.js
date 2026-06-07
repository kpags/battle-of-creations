const { createClient } = require("redis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_SOCKET_PATH = String(process.env.REDIS_SOCKET_PATH || "").trim();
const TASK_PREFIX = "boc:task:";
const USER_TASK_PREFIX = "boc:user-tasks:";
const QUEUE_KEY = "boc:tasks:queue";
const PROCESSING_KEY = "boc:tasks:processing";
const TASK_RETENTION_SECONDS = Number(process.env.TASK_RETENTION_SECONDS || 3600);
const ACTIVE_TASK_SECONDS = Number(process.env.ACTIVE_TASK_SECONDS || 86400);
const MAX_ACTIVE_TASKS_PER_USER = Number(process.env.MAX_ACTIVE_TASKS_PER_USER || 2);

const redis = createClient(
  REDIS_SOCKET_PATH
    ? { socket: { path: REDIS_SOCKET_PATH } }
    : { url: REDIS_URL }
);
const workerRedis = redis.duplicate();
let workerRunning = false;
let workerPromise = null;

redis.on("error", (error) => console.error("Redis error:", error));
workerRedis.on("error", (error) => console.error("Redis worker error:", error));

function taskKey(id) {
  return `${TASK_PREFIX}${id}`;
}

function payloadKey(id) {
  return `${TASK_PREFIX}${id}:payload`;
}

function userTaskKey(ownerId) {
  return `${USER_TASK_PREFIX}${ownerId}`;
}

function serialize(value) {
  return JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function connectTaskQueue() {
  if (!redis.isOpen) await redis.connect();
  if (!workerRedis.isOpen) await workerRedis.connect();
}

async function closeTaskQueue() {
  workerRunning = false;
  if (workerRedis.isOpen) await workerRedis.disconnect();
  await workerPromise?.catch(() => {});
  if (redis.isOpen) await redis.quit();
}

async function readTask(id) {
  const raw = await redis.get(taskKey(id));
  return parseJson(raw);
}

async function writeTask(task, terminal = false) {
  const ttl = terminal ? TASK_RETENTION_SECONDS : ACTIVE_TASK_SECONDS;
  await Promise.all([
    redis.set(taskKey(task.id), serialize(task), { EX: ttl }),
    redis.zAdd(userTaskKey(task.ownerId), [{
      score: Date.parse(task.createdAt),
      value: task.id
    }]),
    redis.expire(userTaskKey(task.ownerId), Math.max(ttl, ACTIVE_TASK_SECONDS))
  ]);
}

async function updateTask(id, updates) {
  const task = await readTask(id);
  if (!task) return null;
  Object.assign(task, updates, { updatedAt: new Date().toISOString() });
  const terminal = ["completed", "failed"].includes(task.status);
  await writeTask(task, terminal);
  return task;
}

async function listTasks(ownerId) {
  const key = userTaskKey(ownerId);
  const ids = await redis.zRange(key, 0, -1, { REV: true });
  if (ids.length === 0) return [];
  const values = await redis.mGet(ids.map(taskKey));
  const tasks = values.map((value) => parseJson(value)).filter(Boolean);
  const missing = ids.filter((id, index) => !values[index]);
  if (missing.length > 0) await redis.zRem(key, missing);
  return tasks;
}

async function createTask(task, payload) {
  const tasks = await listTasks(task.ownerId);
  const activeCount = tasks.filter((entry) =>
    ["queued", "running"].includes(entry.status)
  ).length;
  if (activeCount >= MAX_ACTIVE_TASKS_PER_USER) {
    const error = new Error("Wait for an active import to finish before starting another.");
    error.status = 429;
    throw error;
  }

  await Promise.all([
    writeTask(task),
    redis.set(payloadKey(task.id), serialize(payload), { EX: ACTIVE_TASK_SECONDS })
  ]);
  await redis.lPush(QUEUE_KEY, task.id);
  return task;
}

async function getTaskForOwner(id, ownerId) {
  const task = await readTask(id);
  return task?.ownerId === ownerId ? task : null;
}

async function invalidateApiCache(ownerId) {
  await redis.del([
    `boc:api:cards:${ownerId}`,
    `boc:api:decks:${ownerId}`,
    `boc:api:library:${ownerId}`
  ]);
}

async function getApiCache(key) {
  return redis.get(`boc:api:${key}`);
}

async function setApiCache(key, value, ttlSeconds = 30) {
  await redis.set(`boc:api:${key}`, value, { EX: ttlSeconds });
}

async function pingTaskQueue() {
  return redis.ping();
}

async function recoverProcessingTasks() {
  while (true) {
    const id = await workerRedis.rPopLPush(PROCESSING_KEY, QUEUE_KEY);
    if (!id) break;
    await updateTask(id, {
      status: "queued",
      progress: 0,
      message: "Task recovered after an app restart."
    });
  }
}

async function runWorker(handler) {
  if (workerRunning) return workerPromise;
  workerRunning = true;

  workerPromise = (async () => {
    await recoverProcessingTasks();
    while (workerRunning) {
      let id;
      try {
        id = await workerRedis.brPopLPush(QUEUE_KEY, PROCESSING_KEY, 5);
      } catch (error) {
        if (!workerRunning) break;
        console.error("Could not read the Redis task queue:", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (!id) continue;

      try {
        const task = await updateTask(id, {
          status: "running",
          progress: 10,
          message: "Task is being processed."
        });
        const payload = parseJson(await redis.get(payloadKey(id)), {});
        if (!task) continue;
        const result = await handler(task, payload, (updates) => updateTask(id, updates));
        await updateTask(id, {
          status: "completed",
          progress: 100,
          message: `${task.label} completed.`,
          result: result || null
        });
      } catch (error) {
        await updateTask(id, {
          status: "failed",
          progress: 100,
          message: error.status ? error.message : "Task failed."
        }).catch(() => {});
        console.error(`Background task ${id} failed:`, error);
      } finally {
        await Promise.all([
          redis.lRem(PROCESSING_KEY, 1, id),
          redis.del(payloadKey(id))
        ]).catch(() => {});
      }
    }
  })();

  return workerPromise;
}

module.exports = {
  closeTaskQueue,
  connectTaskQueue,
  createTask,
  getApiCache,
  getTaskForOwner,
  invalidateApiCache,
  listTasks,
  pingTaskQueue,
  runWorker,
  setApiCache,
  updateTask
};
