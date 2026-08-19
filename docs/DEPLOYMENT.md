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

## Scheduled jobs (cron)

All cron endpoints are `POST` and require the `CRON_SECRET` bearer token. Schedule
them from Coolify's scheduled tasks, or any external scheduler:

| Endpoint | Suggested schedule | Purpose |
| --- | --- | --- |
| `/api/cron/recompute-prices` | every 15 min | Refresh cached `priceFrom`/`priceTo` after rate changes |
| `/api/cron/shipment-reconciliation` | hourly | Poll couriers for shipments whose webhooks were missed |
| `/api/cron/abandoned-cart` | every 30 min | Staged abandoned-cart reminders |
| `/api/cron/campaigns` | daily 09:00 IST | Birthday / anniversary greetings |

```bash
curl -X POST https://your-domain/api/cron/recompute-prices \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Backups

The database is the only stateful component (media lives in R2/S3, which has its
own durability). Back it up on a schedule and **test a restore** — an untested
backup is not a backup.

```bash
# Nightly logical backup (retain 30 days)
pg_dump "$DATABASE_URL" --format=custom --file="maya-$(date +%F).dump"

# Restore into a fresh database
pg_restore --clean --if-exists --dbname="$DATABASE_URL" maya-2026-08-19.dump
```

Recommended practice:
- Nightly `pg_dump` retained 30 days, plus a weekly copy retained 12 weeks.
- Store backups **off the app server** (object storage or a managed backup add-on).
- Coolify's managed PostgreSQL offers scheduled backups — enable them and set the
  retention there rather than rolling your own where possible.
- Before any `prisma migrate deploy` on production, take a fresh dump first.

## Monitoring & observability

- **Structured logs** — `lib/logger.ts` emits single-line JSON with sensitive keys
  redacted (passwords, OTPs, tokens, signatures, PAN, card data are never logged).
  Ship container logs to your aggregator of choice; filter on `event`:
  `pricing.failure`, `payment.failure`, `shipping.failure`, `webhook.failure`,
  `order.creation_failure`, `inventory.conflict`.
- **Health check** — point the platform probe at `/` (renders even if the database
  is briefly unavailable) or `/api/auth/session` for a deeper check.
- **What to alert on:**
  - Any `payment.failure` / `order.creation_failure` spike.
  - `WebhookEvent` rows stuck in `FAILED` (they are reprocessable — redeliver).
  - Shipments sitting in `NDR` or `RTO_INITIATED`.
  - Orders in `PENDING_PAYMENT` older than the rate-lock window.
  - Cron endpoints returning non-200.
- **Audit trail** — `/admin/audit` records every sensitive action (who, what,
  before/after, IP, timestamp) and is append-only from the admin UI.

## Security posture

- CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and
  `Permissions-Policy` are set in `next.config.mjs`; transactional routes are
  `no-store`.
- Rate limiting (`lib/rate-limit.ts`) protects OTP send/verify, appointments and
  reviews. It is in-memory and therefore **per container** — correct for a single
  instance; swap the store for Redis if you scale horizontally.
- Rotate `AUTH_SECRET`, `CRON_SECRET` and all provider keys before go-live, and
  never commit `.env`.

## Pre-deploy checklist

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm test            # vitest
```

Then verify against the built server (not `next dev`):

```bash
node .next/standalone/server.js
```
