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

## Render: Single-Container Deployment

Render does not run Docker Compose. Use `Dockerfile.render` when you need the
Node app, PostgreSQL, and Redis in one Render web service.

The included `render.yaml` Blueprint configures:

- the all-in-one Docker image
- `/api/health` as the health check
- a generated PostgreSQL password
- a persistent disk mounted at `/var/data`

To deploy:

1. Push the repository to GitHub or GitLab.
2. In Render, create a new Blueprint and select this repository.
3. Review the `starter` service and 10 GB disk costs.
4. Apply the Blueprint.

For a manually created Render web service, choose Docker and set the Dockerfile
path to `./Dockerfile.render`. Add a persistent disk mounted at `/var/data`,
set `POSTGRES_PASSWORD` to a strong secret, and use `/api/health` as the health
check path.

The persistent disk is required. Without it, PostgreSQL, Redis task data, and
uploaded media are deleted whenever Render restarts or redeploys the service.

This all-in-one deployment is convenient but cannot scale horizontally and
shares memory and CPU among the app, PostgreSQL, and Redis. For higher traffic,
use the regular `Dockerfile` for the app plus Render Postgres and Render Key
Value as separate managed services.
