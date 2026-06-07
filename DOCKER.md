# Docker Setup

1. Create the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Replace `POSTGRES_PASSWORD` in `.env`.

   Keep `COOKIE_SECURE=false` for local HTTP. Set it to `true` when the app is
   served through HTTPS.

3. Build and start the application:

   ```powershell
   docker compose up --build -d
   ```

4. Open `http://localhost:5173`.

The stack contains:

- `app`: Node.js API, frontend, and Redis background-task worker
- `postgres`: users, sessions, cards, decks, and future relational data
- `redis`: background task queue, task status, and short-lived API caches

## Existing JSON Data

After the containers are healthy, migrate the old JSON store once:

```powershell
docker compose run --rm -v "${PWD}/data:/legacy-data:ro" app `
  npm run migrate:json -- /legacy-data/store.json
```

The command preserves user password hashes, cards, decks, active sessions, and media.

## Useful Commands

```powershell
docker compose ps
docker compose logs -f app
docker compose down
docker compose down -v
```

`docker compose down -v` permanently removes the PostgreSQL, Redis, and media volumes.

## Render Free Deployment

The included `render.yaml` creates a no-disk Render deployment:

- a Free web service using the app-only `Dockerfile`
- a Free Render Postgres database
- a Free Render Key Value instance for Redis-compatible tasks and caching

Push the repository, create or update a Render Blueprint, and apply
`render.yaml`. The app receives `DATABASE_URL` and `REDIS_URL` automatically.

If updating an existing manually configured service:

1. Set its Dockerfile path to `./Dockerfile`.
2. Remove `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and
   `REDIS_SOCKET_PATH`.
3. Connect `DATABASE_URL` to the managed Postgres internal URL.
4. Connect `REDIS_URL` to the managed Key Value internal URL.
5. Remove the paid persistent disk, then clear the build cache and redeploy.

Free Render limitations:

- Free Postgres expires 30 days after creation.
- Free Key Value does not persist queued task or cache data across restarts.
- The Free web-service filesystem is ephemeral, so uploaded card and deck
  images stored under `/tmp` can disappear after a restart or redeploy.
- Free web services spin down after periods without traffic.

For permanent production data, use paid Render storage or external durable
Postgres and object-storage providers.
