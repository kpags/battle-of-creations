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

## Render Deployment

Render does not run Docker Compose. The Render deployment is split into:

- `Dockerfile.render`: Node app and PostgreSQL web service
- `Dockerfile.redis`: private Redis service
- `render.yaml`: Blueprint networking, secrets, and persistent disks

The included `render.yaml` Blueprint configures:

- the app/database Docker image
- the private Redis Docker image
- `/api/health` as the health check
- generated PostgreSQL and Redis passwords
- separate persistent disks for PostgreSQL/media and Redis
- private-network Redis host and port injection

To deploy:

1. Push the repository to GitHub or GitLab.
2. In Render, create a new Blueprint and select this repository.
3. Review the two `starter` services and persistent-disk costs.
4. Apply the Blueprint.

For manual deployment, create a private service from `Dockerfile.redis` first.
Mount its disk at `/var/data`, generate `REDIS_PASSWORD`, and note its internal
host and port. Then create the web service from `Dockerfile.render`, mount its
disk at `/var/data`, and configure `REDIS_HOST`, `REDIS_PORT`, and the same
`REDIS_PASSWORD`. Use `/api/health` as the web-service health check.

The persistent disks are required. Without them, PostgreSQL, Redis task data,
and uploaded media are deleted whenever Render restarts or redeploys a service.

PostgreSQL remains private inside the web container through a Unix socket.
Redis exposes its protocol port only through Render's private service network.

After deploying, the logs should show `PostgreSQL database is ready`, followed
by `Starting the Battle of Creations app`. If Render still reports no open
ports, redeploy with the build cache cleared so the updated entrypoint is used.
