# Maya Jewellers — Jewellery E-commerce Platform

A production-grade, mobile-first jewellery commerce platform with **dynamic
metal-rate pricing**, secure server-side checkout, role-based admin operations
and a resellable (white-label) architecture.

> **Status:** Phase 1 (Foundation) complete. See `docs/CHANGELOG.md` for the
> phased roadmap.

## Stack

- **Next.js 15** (App Router, Server Components) · **TypeScript** · **Tailwind CSS**
- **Prisma** + **PostgreSQL**
- **NextAuth v5 (Auth.js)** — staff email/password now; customer phone-OTP in Phase 4
- **Zod** validation · **Decimal.js**-grade money (Prisma `Decimal`) — never floats
- **Razorpay** (payments) · **Shiprocket** (shipping) · **R2/S3** (media) — integrated in later phases
- **Docker** / **Coolify**-ready

## Quick start

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env      # set DATABASE_URL + AUTH_SECRET at minimum

# 3. Database
npx prisma migrate deploy # or: npx prisma db push
npm run db:seed           # seeds settings, catalog, rates, 20 products, staff

# 4. Develop
npm run dev               # http://localhost:3000  ·  admin at /admin
```

### Seeded staff logins (development)


## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build |
| `npm start` | Production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite |
| `npm run db:seed` | Seed the database |
| `npm run prisma:studio` | Prisma Studio |

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — structure & conventions
- [`docs/DATABASE.md`](docs/DATABASE.md) — data model
- [`docs/PRICING.md`](docs/PRICING.md) — the dynamic pricing engine (design)
- [`docs/ADMIN.md`](docs/ADMIN.md) — roles & admin console
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — Razorpay, Shiprocket, R2, email
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker / Coolify
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — phased changelog
