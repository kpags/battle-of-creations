#!/bin/sh

set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

DATA_ROOT="${DATA_ROOT:-/var/data}"
PGDATA="${PGDATA:-$DATA_ROOT/postgres}"
MEDIA_DIR="${MEDIA_DIR:-$DATA_ROOT/media}"
POSTGRES_DB="${POSTGRES_DB:-battle_of_creations}"
POSTGRES_USER="${POSTGRES_USER:-boc}"
PGPORT="${PGPORT:-5432}"

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

mkdir -p "$PGDATA" "$MEDIA_DIR" /run/postgresql
chown -R postgres:postgres "$PGDATA" /run/postgresql
chown -R node:node "$MEDIA_DIR"
chmod 700 "$PGDATA"

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
  if [ -n "$POSTGRES_PID" ] && kill -0 "$POSTGRES_PID" 2>/dev/null; then
    kill -TERM "$POSTGRES_PID"
  fi

  [ -n "$APP_PID" ] && wait "$APP_PID" 2>/dev/null
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

echo "Preparing PostgreSQL database $POSTGRES_DB..."
database_exists="$(PGCONNECT_TIMEOUT=5 timeout 10 su-exec postgres psql \
  -h /run/postgresql \
  -p "$PGPORT" \
  -U "$POSTGRES_USER" \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB';")"

if [ "$database_exists" != "1" ]; then
  echo "Creating PostgreSQL database $POSTGRES_DB"
  PGCONNECT_TIMEOUT=5 timeout 10 su-exec postgres createdb \
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
export MEDIA_DIR

# REDIS_HOST takes precedence in the app. Remove legacy all-in-one settings
# that Render might retain from an earlier deployment.
unset DATABASE_URL
unset REDIS_SOCKET_PATH

echo "PostgreSQL database is ready."
echo "Connecting to Redis at ${REDIS_HOST:-unset}:${REDIS_PORT:-6379}."
echo "Starting the Battle of Creations app on port ${PORT:-10000}..."
su-exec node node /app/server.js &
APP_PID=$!

while
  kill -0 "$APP_PID" 2>/dev/null &&
  kill -0 "$POSTGRES_PID" 2>/dev/null
do
  sleep 2
done

echo "A required service exited unexpectedly." >&2
shutdown
exit 1
