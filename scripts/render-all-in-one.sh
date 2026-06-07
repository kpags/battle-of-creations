#!/bin/sh

set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

DATA_ROOT="${DATA_ROOT:-/var/data}"
PGDATA="${PGDATA:-$DATA_ROOT/postgres}"
REDIS_DATA_DIR="${REDIS_DATA_DIR:-$DATA_ROOT/redis}"
MEDIA_DIR="${MEDIA_DIR:-$DATA_ROOT/media}"
POSTGRES_DB="${POSTGRES_DB:-battle_of_creations}"
POSTGRES_USER="${POSTGRES_USER:-boc}"
PGPORT="${PGPORT:-5432}"
REDIS_SOCKET_DIR="${REDIS_SOCKET_DIR:-/run/redis}"
REDIS_SOCKET_PATH="${REDIS_SOCKET_PATH:-$REDIS_SOCKET_DIR/redis.sock}"
REDIS_MAXMEMORY="${REDIS_MAXMEMORY:-64mb}"

case "$POSTGRES_USER" in
  ""|*[!A-Za-z0-9_]*)
    echo "POSTGRES_USER may contain only letters, numbers, and underscores." >&2
    exit 1
    ;;
esac

case "$POSTGRES_DB" in
  ""|*[!A-Za-z0-9_]*)
    echo "POSTGRES_DB may contain only letters, numbers, and underscores." >&2
    exit 1
    ;;
esac

mkdir -p "$PGDATA" "$REDIS_DATA_DIR" "$MEDIA_DIR" /run/postgresql "$REDIS_SOCKET_DIR"
chown -R postgres:postgres "$PGDATA" /run/postgresql
chown -R redis:redis "$REDIS_DATA_DIR" "$REDIS_SOCKET_DIR"
chown -R node:node "$MEDIA_DIR"
chmod 700 "$PGDATA"
chmod 770 "$REDIS_SOCKET_DIR"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  password_file="$(mktemp)"
  trap 'rm -f "$password_file"' EXIT
  printf '%s\n' "$POSTGRES_PASSWORD" > "$password_file"
  chown postgres:postgres "$password_file"
  chmod 600 "$password_file"

  echo "Initializing PostgreSQL in $PGDATA"
  su-exec postgres initdb \
    -D "$PGDATA" \
    --username="$POSTGRES_USER" \
    --pwfile="$password_file" \
    --auth-local=trust \
    --auth-host=scram-sha-256

  rm -f "$password_file"
  trap - EXIT
fi

APP_PID=""
POSTGRES_PID=""
REDIS_PID=""
SHUTTING_DOWN=0

shutdown() {
  if [ "$SHUTTING_DOWN" -eq 1 ]; then
    return
  fi
  SHUTTING_DOWN=1
  set +e

  echo "Stopping Battle of Creations services..."
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID"
  fi
  if [ -n "$REDIS_PID" ] && kill -0 "$REDIS_PID" 2>/dev/null; then
    kill -TERM "$REDIS_PID"
  fi
  if [ -n "$POSTGRES_PID" ] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
    kill -TERM "$POSTGRES_PID"
  fi

  [ -n "$APP_PID" ] && wait "$APP_PID" 2>/dev/null
  [ -n "$REDIS_PID" ] && wait "$REDIS_PID" 2>/dev/null
  [ -n "$POSTGRES_PID" ] && wait "$POSTGRES_PID" 2>/dev/null
}

trap 'shutdown; exit 0' TERM INT

echo "Starting PostgreSQL..."
su-exec postgres postgres \
  -D "$PGDATA" \
  -p "$PGPORT" \
  -k /run/postgresql \
  -c listen_addresses= \
  -c max_connections=40 \
  -c shared_buffers=64MB \
  -c work_mem=2MB \
  -c maintenance_work_mem=32MB &
POSTGRES_PID=$!

echo "Starting Redis..."
su-exec redis redis-server \
  --port 0 \
  --unixsocket "$REDIS_SOCKET_PATH" \
  --unixsocketperm 770 \
  --dir "$REDIS_DATA_DIR" \
  --appendonly yes \
  --appendfsync everysec \
  --maxmemory "$REDIS_MAXMEMORY" \
  --maxmemory-policy noeviction \
  --daemonize no &
REDIS_PID=$!

attempt=0
until pg_isready -q -h /run/postgresql -p "$PGPORT" -U "$POSTGRES_USER" -d postgres; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ] || ! kill -0 "$POSTGRES_PID" 2>/dev/null; then
    echo "PostgreSQL failed to become ready." >&2
    shutdown
    exit 1
  fi
  sleep 1
done

attempt=0
until redis-cli -s "$REDIS_SOCKET_PATH" ping >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ] || ! kill -0 "$REDIS_PID" 2>/dev/null; then
    echo "Redis failed to become ready." >&2
    shutdown
    exit 1
  fi
  sleep 1
done

# Keep the persisted database credential aligned with the Render secret.
escaped_password="$(printf '%s' "$POSTGRES_PASSWORD" | sed "s/'/''/g")"
su-exec postgres psql \
  -h /run/postgresql \
  -p "$PGPORT" \
  -U "$POSTGRES_USER" \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE \"$POSTGRES_USER\" WITH PASSWORD '$escaped_password';" >/dev/null

database_exists="$(su-exec postgres psql \
  -h /run/postgresql \
  -p "$PGPORT" \
  -U "$POSTGRES_USER" \
  -d postgres \
  -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB';")"

if [ "$database_exists" != "1" ]; then
  echo "Creating PostgreSQL database $POSTGRES_DB"
  su-exec postgres createdb \
    -h /run/postgresql \
    -p "$PGPORT" \
    -U "$POSTGRES_USER" \
    --owner="$POSTGRES_USER" \
    "$POSTGRES_DB"
fi

export PGHOST=/run/postgresql
export PGPORT
export PGDATABASE="$POSTGRES_DB"
export PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PASSWORD"
export REDIS_SOCKET_PATH
unset DATABASE_URL
unset REDIS_URL
export MEDIA_DIR

echo "Starting the Battle of Creations app on port ${PORT:-10000}..."
su-exec node node /app/server.js &
APP_PID=$!

while
  kill -0 "$APP_PID" 2>/dev/null &&
  kill -0 "$POSTGRES_PID" 2>/dev/null &&
  kill -0 "$REDIS_PID" 2>/dev/null
do
  sleep 2
done

echo "A required service exited unexpectedly." >&2
shutdown
exit 1
