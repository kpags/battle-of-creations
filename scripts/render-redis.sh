#!/bin/sh

set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"

PORT="${PORT:-6379}"
REDIS_DATA_DIR="${REDIS_DATA_DIR:-/var/data}"
REDIS_MAXMEMORY="${REDIS_MAXMEMORY:-64mb}"

mkdir -p "$REDIS_DATA_DIR"
chown -R redis:redis "$REDIS_DATA_DIR"

echo "Starting private Redis service on port $PORT..."
exec su-exec redis redis-server \
  --bind 0.0.0.0 \
  --protected-mode yes \
  --port "$PORT" \
  --dir "$REDIS_DATA_DIR" \
  --appendonly yes \
  --appendfsync everysec \
  --maxmemory "$REDIS_MAXMEMORY" \
  --maxmemory-policy noeviction \
  --requirepass "$REDIS_PASSWORD" \
  --daemonize no
