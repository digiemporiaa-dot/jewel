# Deployment

Target: **Docker → Coolify → VPS → PostgreSQL**.

## Build output

`next.config.mjs` uses `output: 'standalone'`, so the runtime image ships a
self-contained `server.js` with only the files it needs.

> Local note: `next start` warns with standalone output. Run the standalone server
> directly instead: `node .next/standalone/server.js` (the Docker image does this).

## Docker

```bash
docker compose up --build
```

`docker-compose.yml` provisions Postgres + the app, waits for DB health, runs
`prisma migrate deploy`, then starts the server. Override secrets via env:

```bash
AUTH_SECRET=$(openssl rand -base64 32) \
NEXT_PUBLIC_SITE_URL=https://shop.example \
docker compose up --build -d
```

## Coolify

1. New Resource → Dockerfile app pointing at this repo.
2. Attach a managed **PostgreSQL** and copy its connection string to `DATABASE_URL`.
3. Set env vars from `.env.example` (`AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`,
   provider keys, `CRON_SECRET`, …).
4. **`AUTH_TRUST_HOST=true`** is required behind Coolify's proxy (already the
   default in the Dockerfile).
5. Deploy. Run `npx prisma migrate deploy` on release (compose does this
   automatically; for Coolify add it as a pre-start command) and seed once if
   desired: `npm run db:seed`.

## Environment variables

See `.env.example`. Minimum to boot: `DATABASE_URL`, `AUTH_SECRET`. Never commit
`.env`. Generate secrets with `openssl rand`.

## Health & readiness

The app renders its shell even if the database is briefly unavailable (data
accessors fall back), but `/admin` and checkout require the DB. Point health
checks at `/` or `/api/auth/session`.

## Pre-deploy checklist

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm test            # vitest
```
