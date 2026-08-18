# Changelog

## Phase 2 — Pricing Engine + Catalog Admin · 2026-08-18

**Features added**
- **Pricing engine** (`lib/pricing.ts`, `calculatePrice()`): WEIGHT_BASED /
  COMPONENT_BASED / FIXED modes, wastage, making (%/per-gram/flat + minimum),
  diamonds (rate × carat × pieces, blended ₹/carat), stones (flat or rate),
  discounts (with cap), GST inclusive/exclusive, quantity, and `isRateLockValid()`.
  100% decimal.js — no floating point. Returns a full itemised breakup.
- **Making-charge resolution** (`lib/pricing/making.ts`): Variant → Category+Metal+
  Purity → Category+Metal → Metal → Global, with priority tie-break.
- **Server pricing resolver** (`lib/pricing/resolve.ts`): loads live rates, resolves
  making charges and gathers diamonds/stones from the DB, computes per-variant
  prices, and recomputes cached `priceFrom`/`priceTo`. Protected cron endpoint
  `POST /api/cron/recompute-prices` (CRON_SECRET).
- **Metal-rate admin** (`/admin/rates`): current rates, update with a live
  catalogue **impact preview** (products affected, old→new average price),
  confirm-to-apply, full rate history, atomic apply + auto price recompute,
  audit log. Diamond-rate inline updates.
- **Making-charge admin** (`/admin/making-charges`): create rules (scope/type/value/
  min/priority + scoped metal/category/purity), live sample-product preview, and
  inline value/min/priority/active edits — all recompute the catalogue.
- **Product CRUD** (`/admin/products`): searchable/filterable paginated list;
  create/edit with all fields; live engine price preview; delete (audit). A default
  variant is created automatically.
- **Variant CRUD + Inventory**: per-variant add/edit/delete, oversell-safe
  transactional stock (`lib/inventory.ts` — reserve/release/commit/set via a single
  conditional UPDATE + ledger), low-stock view (`/admin/inventory`).
- **Image manager**: add-by-URL and presigned **R2/S3 direct upload**
  (`/api/admin/upload-url`, MIME + size validation), set-primary, reorder, delete.
- **CSV bulk import** (`/admin/products/import`): Upload → Validate → **dry-run**
  report (processed/valid/invalid/duplicate/warnings + per-row issues) →
  downloadable error report → confirm → import. Server re-validates on import
  (never trusts the client). Minimal in-house CSV parser.

**Tests added** (Vitest, 59 total)
- Pricing: weight/component/fixed, GST incl/excl, wastage, making %/per-gram/flat +
  minimum, diamonds + blended carat rate, stones, discounts + cap, quantity,
  rate change, historical snapshot reproducibility, rate-lock expiry, invalid-input
  errors, and the **price-manipulation security test** (§59).
- Making-charge resolution order + priority + inactive handling.
- CSV parser (quotes, embedded commas/newlines, escaping, round-trip).
- Import validation: required columns, category/metal/purity resolution, FIXED
  rules, in-file and DB duplicate detection, component warnings.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (28 routes) · `vitest` ✓ (59/59).
- Rate change applied via admin recomputes affected products (verified through the
  cron endpoint: 20 products updated; unauthorized request → 401).
- Import pipeline verified end-to-end against the DB: dry-run flagged a duplicate,
  created products with correct variants + stock, then cleaned up.

**Known limitations**
- Storefront product cards / PDP price breakup consume the engine in Phase 3.
- R2 upload needs `R2_*` env vars; without them the image manager uses add-by-URL
  (the presign endpoint returns a clear message).
- Component pricing via CSV imports metal only; diamonds/stones are added per
  product afterwards (the dry-run warns about this).

**Next steps** — Phase 3: storefront (homepage, category/collection/search,
product page with price breakup, filters, cart, wishlist, pincode, WhatsApp).

---

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
