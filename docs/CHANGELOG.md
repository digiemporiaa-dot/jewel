# Changelog

## Phase 1 — Foundation · 2026-08-18

**Features added**
- Next.js 15 (App Router) + TypeScript + Tailwind + Prisma + PostgreSQL scaffold.
- Comprehensive Prisma schema covering all planned domains (store settings, staff
  & customers, catalog, metals/purities/rates, making charges, products/variants/
  diamonds/stones, inventory, cart, wishlist, orders/payments/refunds, webhooks,
  shipping, reviews, appointments, CRM, CMS, blog, campaigns, notifications,
  analytics, audit). Baseline migration `0_init`.
- Design system: brand tokens as CSS variables mapped into Tailwind; `Bodoni Moda`
  + `Jost` via `next/font`; 2px max radius. Living reference at
  `docs/maya-jewellers-prototype.html`.
- Storefront shell: premium Header (top rate ticker, desktop + mobile layouts,
  accessible mobile drawer), Footer (store-driven links/social/newsletter),
  foundation homepage (hero, shop-by-category from DB, editorial band, collections,
  trust row). Global `error.tsx`, `not-found.tsx`, storefront `loading.tsx`.
- Auth foundation: NextAuth v5 (Auth.js), JWT sessions, edge-safe middleware
  guarding `/admin`, Prisma+bcrypt staff Credentials provider, `trustHost` for
  proxy deployment.
- **Role-based access control**: central permission matrix (5 roles), server-side
  `requirePermission` / `assertPermission` guards, role-filtered admin sidebar,
  admin shell + login + dashboard (live counts) + 18 access-controlled section
  scaffolds.
- Resellable/white-label: all store-specific config in `StoreSetting`; nothing
  brand-specific hardcoded. `formatCurrency()` with Indian grouping and safe
  fallbacks (no ₹0/₹NaN/₹undefined).
- Seed: store settings, 12 categories, 3 collections, gold/silver metals &
  purities, live metal & diamond rates, 4 making-charge rules, **20 products**
  across WEIGHT_BASED (10) / COMPONENT_BASED (6) / FIXED (4) with 28 variants,
  diamonds, stones, inventory, ready-to-ship & made-to-order, and 5 staff accounts.
- Docker (standalone multi-stage) + docker-compose + Coolify notes; docs suite.

**Tests added**
- Vitest: RBAC matrix (per-role capabilities, nav filtering integrity) and
  currency/number/weight formatting. 12 tests passing.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (22 routes, middleware) · `vitest` ✓ (12/12).
- Runtime smoke: homepage 200; `/admin` → 307 login redirect; end-to-end staff
  login (CSRF → session with role → dashboard 200); server-side authorization
  proven (DISPATCH blocked from `/admin/rates`, allowed on `/admin/shipments`,
  "Metal Rates" absent from its nav); wrong-password rejected.

**Known limitations**
- Product cards/pricing display, storefront category/product pages, cart and
  checkout are Phase 2/3/4. Section pages under `/admin/*` are access-controlled
  scaffolds pending their phase.
- Customer phone-OTP login, payments, shipping, media uploads, CRM/CMS UIs land in
  later phases (data model & env contract already in place).
- The visual prototype was established from the approved token/spec brief (no prior
  HTML existed); future phases must not redesign it.

**Next steps** — Phase 2: pricing engine (`lib/pricing`) + unit tests, rate &
making-charge admin with impact preview, product/variant/image CRUD, CSV import
(dry-run), inventory.
