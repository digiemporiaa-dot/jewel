# Deployment

Target: **Docker → Coolify → VPS → PostgreSQL**.

> Deploying to **Vercel** instead? See [`VERCEL.md`](./VERCEL.md) — serverless
> changes the database, rate-limiting and cron setup in ways this document does
> not cover.

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

## Coolify — step by step

### Prerequisites

A VPS (2 vCPU / 4 GB RAM is comfortable for this app + Postgres) with Coolify
installed, and a domain whose DNS A record points at that server's IP.

```bash
# On the VPS, as root — installs Coolify, then open http://<server-ip>:8000
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

### 1. Create the database first

Coolify -> **Project -> New Resource -> Database -> PostgreSQL 16**. Deploy it,
then open the resource and copy the **internal** connection string (the one using
the service hostname, not `localhost`). Keeping Postgres inside Coolify's network
means it is never exposed to the public internet.

### 2. Create the application

**New Resource -> Public Repository** (or GitHub App if the repo is private):

| Field | Value |
| --- | --- |
| Repository | `https://github.com/digiemporiaa-dot/jewel` |
| Branch | `claude/maya-jewellers-ecommerce-8v3un2` (or `main` once merged) |
| Build Pack | **Dockerfile** |
| Dockerfile location | `/Dockerfile` |
| Port | `3000` |

### 3. Environment variables

**Configuration -> Environment Variables.** Minimum to boot:

```
DATABASE_URL=<internal connection string from step 1>
AUTH_SECRET=<openssl rand -base64 32>
AUTH_TRUST_HOST=true
NEXT_PUBLIC_SITE_URL=https://your-domain.com
CRON_SECRET=<openssl rand -hex 32>
```

Add provider keys as you enable them - `RAZORPAY_*`, `SHIPROCKET_*`, `SMTP_*`,
`R2_*`. Anything left blank keeps that integration in simulated mode; the app
still builds and runs. Full list with comments in `.env.example`.

> `NEXT_PUBLIC_SITE_URL` is baked into canonical URLs, the sitemap and JSON-LD.
> Set the real domain before letting Google index the site.

> `AUTH_TRUST_HOST=true` is mandatory behind Coolify's Traefik proxy - without it
> Auth.js rejects every sign-in with `UntrustedHost`. The Dockerfile already sets
> it; keeping it in the dashboard too makes it visible.

### 4. Migrations

The image does **not** migrate on start, so a bad migration can never take the
site down on its own. Set it explicitly instead - Coolify ->
**Pre-deployment Command**:

```
npx prisma migrate deploy
```

Seed the demo catalogue once (optional - skip if importing real products), from
Coolify's terminal for the container:

```bash
npx prisma db seed
```

### 5. Domain, TLS and health

- **Configuration -> Domains** -> `https://your-domain.com`. Coolify issues the
  Let's Encrypt certificate automatically once DNS resolves.
- **Health Check Path** -> `/api/health`. It returns `200 {"status":"ok"}` when
  the database answers and `503 {"status":"degraded"}` when it does not, so a
  failed deploy rolls back instead of serving a broken site. The Dockerfile
  carries the same probe as a `HEALTHCHECK`.

### 6. Scheduled tasks

Coolify -> **Scheduled Tasks**, one per row in the cron table below. Each is an
HTTP call carrying the shared secret:

```bash
curl -fsS -X POST https://your-domain.com/api/cron/recompute-prices \
  -H "Authorization: Bearer $CRON_SECRET"
```

### 7. Verify the deployment

```bash
curl -s  https://your-domain.com/api/health          # {"status":"ok",...}
curl -sI https://your-domain.com | grep -i strict-transport
curl -sI https://your-domain.com/admin               # 307 -> sign-in
curl -i  https://your-domain.com/api/cron/campaigns  # 401 without the secret
curl -s  https://your-domain.com/sitemap.xml | head
```

Then sign in at `/admin`, **change the seeded admin password immediately**, and
fill in Store Settings - brand, phone, WhatsApp, address, GST. None of it is
hardcoded, so the site shows placeholder values until you do.

### 8. Webhooks

Point the provider dashboards at the live domain:

- Razorpay -> `https://your-domain.com/api/webhooks/razorpay`, with the same
  secret in `RAZORPAY_WEBHOOK_SECRET`.
- Shiprocket -> `https://your-domain.com/api/webhooks/logistics`, sending
  `x-api-key: $SHIPROCKET_WEBHOOK_TOKEN`. **Use the `/logistics` path, not
  `/shiprocket`** - their dashboard rejects any URL containing "shiprocket",
  "sr" or "kr" with "Address is not allowed". Both paths run the same handler;
  `/api/webhooks/shiprocket` still works for anything already pointed at it.
  If the deployed domain itself contains one of those substrings, their form
  will refuse it regardless of the path.

Both verify signatures and are idempotent - a redelivered event is recorded and
ignored, never processed twice.

## Environment variables

See `.env.example`. Minimum to boot: `DATABASE_URL`, `AUTH_SECRET`. Never commit
`.env`. Generate secrets with `openssl rand`.

## Health & readiness

`GET /api/health` is the probe: `200 {"status":"ok","database":"up"}` when
Postgres answers, `503 {"status":"degraded"}` when it does not. It is `no-store`
and reports nothing beyond up/down - an unauthenticated endpoint should not
become a reconnaissance surface.

The app renders its shell even if the database is briefly unavailable (data
accessors fall back), but `/admin` and checkout require the DB.

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

**Nothing calls these by itself.** Until a scheduler does, the shop keeps selling
at whatever metal rate was last entered by hand, and no abandoned-cart, birthday,
back-in-stock or price-drop email is ever sent. Neither failure shows an error
anywhere — that is the whole reason this section matters.

### Ready to paste

Coolify → **Scheduled Tasks**, one per row above. On a plain host, `crontab -e`:

```cron
# Maya Jewellers scheduled jobs. Replace the domain and export CRON_SECRET.
*/15 * * * *  curl -fsS -X POST https://your-domain/api/cron/recompute-prices        -H "Authorization: Bearer $CRON_SECRET" >/dev/null
0    * * * *  curl -fsS -X POST https://your-domain/api/cron/shipment-reconciliation -H "Authorization: Bearer $CRON_SECRET" >/dev/null
*/30 * * * *  curl -fsS -X POST https://your-domain/api/cron/abandoned-cart          -H "Authorization: Bearer $CRON_SECRET" >/dev/null
30   3 * * *  curl -fsS -X POST https://your-domain/api/cron/campaigns               -H "Authorization: Bearer $CRON_SECRET" >/dev/null
```

`03:30` UTC is 09:00 IST — cron runs in the server's timezone, so set the hour in
whatever the host uses, not in local time.

On Vercel, `vercel.json` instead:

```json
{
  "crons": [
    { "path": "/api/cron/recompute-prices",        "schedule": "*/15 * * * *" },
    { "path": "/api/cron/shipment-reconciliation", "schedule": "0 * * * *" },
    { "path": "/api/cron/abandoned-cart",          "schedule": "*/30 * * * *" },
    { "path": "/api/cron/campaigns",               "schedule": "30 3 * * *" }
  ]
}
```

Vercel Cron sends **GET** with the bearer token automatically; every endpoint
accepts both verbs through the identical secret-protected handler.

### Confirming it actually runs

Every run is recorded — success or failure — and the admin **Dashboard** shows
each job's last run, its run count and its last error. A job reading *never run*
means the scheduler was never wired to it; a run count that stops moving means it
has stopped. That panel also flags the other things that fail silently: missing
SMTP, an unconfigured payment webhook, OTP still writing codes to the log, and a
live metal rate more than two days old.

Check it once after deploying, and again an hour later.

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
