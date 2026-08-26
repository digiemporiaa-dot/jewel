# Deploying to Vercel

The brief targets Docker → Coolify → VPS, and `Dockerfile` / `docker-compose.yml`
remain valid. This document covers the **Vercel** path instead. Vercel is
serverless, which changes four things: the database needs connection pooling,
rate limiting needs a shared store, cron is configured in `vercel.json`, and
functions have an execution-time cap.

---

## 1. Database (do this first)

Vercel has no database. Pick a managed Postgres — **Neon** and **Supabase** both
have usable free tiers — and note that you get **two** connection strings:

| String | Host looks like | Used for |
| --- | --- | --- |
| **Pooled** | `...-pooler.neon.tech` / port `6543` on Supabase | The app at runtime (`DATABASE_URL`) |
| **Direct** | `...neon.tech` / port `5432` | Migrations and seeding only |

This split is not optional. Every warm serverless isolate holds its own Prisma
pool, so a direct URL will exhaust `max_connections` under real traffic. Equally,
`prisma migrate deploy` takes an advisory lock that PgBouncer cannot pass through,
so migrations must use the direct URL.

Run the migration and seed **from your machine**, once, before the first deploy:

```bash
export DATABASE_URL="<DIRECT connection string>"
npx prisma migrate deploy
npm run db:seed          # optional — demo catalogue, skip if importing real data
```

Repeat the `migrate deploy` step (direct URL) whenever a migration is added.

> The build does **not** run migrations, because Vercel builds with the pooled
> `DATABASE_URL`. See "Automating migrations" at the bottom.

## 2. Import the project

1. Push this branch to GitHub (already done).
2. Vercel → **Add New → Project** → import `digiemporiaa-dot/jewel`.
3. Framework preset: **Next.js** (auto-detected). Leave the build settings alone —
   `vercel.json` already sets `prisma generate && next build`.
4. Set the branch to deploy: `claude/maya-jewellers-ecommerce-8v3un2`, or merge to
   `main` first and deploy that.

## 3. Environment variables

Add these in **Settings → Environment Variables** (Production + Preview). Full
list and comments in `.env.example`.

**Required to boot:**

```
DATABASE_URL          <POOLED connection string>
AUTH_SECRET           openssl rand -base64 32
AUTH_TRUST_HOST       true
NEXT_PUBLIC_SITE_URL  https://your-domain.com
CRON_SECRET           openssl rand -hex 32
```

**Required for rate limiting to actually work** — see §5:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

**Per integration, as you enable them:**

```
RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD / SHIPROCKET_WEBHOOK_TOKEN
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM
R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_URL
```

Anything left blank keeps that integration in its simulated/dev mode — the app
still builds and runs.

> `NEXT_PUBLIC_SITE_URL` feeds canonical URLs, the sitemap and JSON-LD. Set it to
> the real domain before you let Google index the site.

## 4. Cron

`vercel.json` declares four scheduled jobs. Vercel Cron sends a **GET** with
`Authorization: Bearer $CRON_SECRET`, which is why each route exports both `GET`
and `POST` — the POST form still works for Coolify/cURL/GitHub Actions.

| Path | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `/api/cron/recompute-prices` | `*/15 * * * *` | Refresh cached `priceFrom`/`priceTo` after rate changes |
| `/api/cron/shipment-reconciliation` | `0 * * * *` | Poll couriers for missed webhooks |
| `/api/cron/abandoned-cart` | `*/30 * * * *` | Staged abandoned-cart reminders |
| `/api/cron/campaigns` | `30 3 * * *` | Birthday / anniversary (= 09:00 IST) |

**Vercel cron schedules are UTC**, so `30 3 * * *` is 09:00 India time.

> ⚠️ **Hobby plan limits: 2 cron jobs, once-per-day granularity.** The schedule
> above needs **Pro**. On Hobby, either trim `vercel.json` to two daily entries, or
> leave all four and drive them from an external scheduler (cron-job.org, GitHub
> Actions) POSTing with the `CRON_SECRET` bearer token.

Verify a job is protected — this must return 401:

```bash
curl -i https://your-domain.com/api/cron/recompute-prices
```

## 5. Rate limiting — read this one

`lib/rate-limit.ts` guards OTP send/verify, appointments and reviews. In-memory
counters are per-process; on Vercel consecutive requests land in different
isolates, so **an attacker gets roughly one free attempt per cold isolate** and the
limit stops being a limit.

Fix: create a free **Upstash Redis** database and set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. The limiter then uses a shared fixed-window counter
over Upstash's REST API (no extra npm dependency). If Redis is unreachable it
**fails open** to the in-memory counter — a limiter must never take checkout down
with it.

Without those two variables the site works, but treat OTP abuse protection as off.

## 6. Images

`next.config.mjs` builds `images.remotePatterns` from `R2_PUBLIC_URL` /
`R2_ENDPOINT`, plus anything in `IMAGE_HOSTS`. When none are set it falls back to
allowing any HTTPS host — convenient locally, but on Vercel that makes your image
optimizer an open proxy anyone can bill to your account. **Set `R2_PUBLIC_URL`
(or `IMAGE_HOSTS`) before going live.**

## 7. Domain and post-deploy checks

Settings → Domains → add your domain and follow the DNS instructions. Then:

```bash
curl -sI https://your-domain.com | grep -i 'content-security-policy\|strict-transport'
curl -s  https://your-domain.com/robots.txt
curl -s  https://your-domain.com/sitemap.xml | head
curl -sI https://your-domain.com/admin          # expect 307 → sign-in
curl -i  https://your-domain.com/api/cron/campaigns  # expect 401
```

Then sign in at `/admin`, change the seeded admin password immediately, and fill
in Store Settings (brand, phone, WhatsApp, GST, address) — none of it is hardcoded.

## 8. Webhooks

Point the provider dashboards at the deployed domain:

- Razorpay → `https://your-domain.com/api/webhooks/razorpay` (set the same secret
  in `RAZORPAY_WEBHOOK_SECRET`).
- Shiprocket → `https://your-domain.com/api/webhooks/logistics` with
  `x-api-key: $SHIPROCKET_WEBHOOK_TOKEN`. **Use the `/logistics` path, not
  `/shiprocket`** — their dashboard rejects any URL containing "shiprocket",
  "sr" or "kr" with "Address is not allowed". Both paths run the same handler;
  `/api/webhooks/shiprocket` still works for anything already pointed at it.
  If the deployed domain itself contains one of those substrings, their form
  will refuse it regardless of the path.

Both verify signatures and are idempotent — a redelivered event is recorded and
ignored, never processed twice.

---

## Known trade-offs vs. the Docker/Coolify target

| Concern | Docker/Coolify | Vercel |
| --- | --- | --- |
| DB connections | One pool, one container | Needs a pooled URL, always |
| Rate limiting | In-memory is correct | Needs Upstash Redis |
| Cron | Any schedule | Pro plan for sub-daily |
| Long jobs | Unbounded | 60s cap (`maxDuration`) |
| Cost at scale | Fixed VPS | Per-invocation + image optimization |
| Migrations | Run on release | Manual, or a deploy hook |

## Automating migrations (optional, needs approval)

Running `prisma migrate deploy` inside the Vercel build would require adding a
`directUrl` to the `datasource` block in `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")      // pooled — runtime
  directUrl = env("DIRECT_DATABASE_URL") // direct — migrations
}
```

That is a Prisma schema change, so per **RULE 3** it has not been made. Until it
is approved, run migrations manually with the direct URL as shown in §1.
