# Changelog

## Phase 6 — CRM + CMS · 2026-08-19

**Features added**
- **CRM** (`/admin/crm`): lead pipeline with per-stage counts, create/assign leads,
  stage transitions, **scheduled follow-ups** with a "due in 24h" worklist, and
  **call logging**. Sales executives are scoped server-side to their own leads;
  managers see everything (`lib/admin/crm.ts`).
- **Customers** (`/admin/customers`): searchable list plus a detail view with
  lifetime value, paid-order count, order history, addresses, appointments and
  linked CRM leads.
- **Appointments**: storefront `/appointments` booking (showroom visit or video
  consultation, live slot availability, product of interest) which **re-checks slot
  availability server-side**, links/creates the customer, **raises a CRM lead**, and
  sends a best-effort confirmation email. `/admin/appointments` manages status and
  staff assignment.
- **Reviews**: submission restricted to **verified purchases** (re-verified
  server-side against a fulfilled order), one review per customer per product,
  admin moderation queue (`/admin/reviews`) with approve/reject, and approved
  reviews + aggregate rating on the product page.
- **CMS** (`/admin/cms`): block-based pages with **ten fixed block types** and a
  strict Zod schema per type — there is deliberately **no free-form HTML editor**,
  so content cannot inject markup or scripts. Add/edit/reorder/hide/delete blocks,
  draft / published / scheduled states, rendered at `/pages/[slug]`.
- **Blog** (`/admin/blog` + `/blog`, `/blog/[slug]`): full CRUD, categories, tags,
  excerpt, featured image, SEO fields, and **Article JSON-LD**.
- **Campaigns & abandoned cart** (`/admin/campaigns`): per-campaign on/off plus
  **configurable abandoned-cart delays** (abandon-after, three reminder stages,
  minimum gap), editable **message templates** with `{{placeholder}}` rendering, and
  cron endpoints `POST /api/cron/abandoned-cart` and `POST /api/cron/campaigns`
  (both CRON_SECRET-protected). Birthday/anniversary greetings for opted-in
  customers.
- **Seed content**: a published "Our Story" CMS page (hero, rich text, trust row,
  FAQ, CTA), two blog posts, three campaigns and two message templates.

**Tests** (Vitest, 92 total; +13)
- Abandoned-cart scheduling (`lib/campaigns/schedule.ts` is pure): abandonment
  threshold, per-stage due dates, empty/converted carts skipped, and the
  **anti-spam guarantees** — never more than the configured number of reminders,
  minimum gap respected even when a stage is due, at most one reminder per run,
  and custom delay configuration honoured.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (58 routes) · `vitest` ✓ (92/92).
- **End-to-end against the running app:**
  - Appointment booked through the real form → appointment `REQUESTED`, customer
    created, and a CRM lead auto-raised with `source=APPOINTMENT`.
  - CMS page renders every seeded block type; blog post emits `"@type":"Article"`.
  - Abandoned-cart cron: unauthorized → 401; run 1 **marks** abandoned without
    sending; run 2 **sends exactly one** reminder; run 3 immediately after
    **sends nothing** (minimum gap) — reminder count stays at 1, one Notification.
  - **RBAC**: SALES_EXECUTIVE reaches CRM/customers/appointments but is blocked
    from campaigns/CMS/blog, sees only "Your assigned leads", and a direct URL to
    an unassigned lead **leaks nothing** (not-found; admin sees it fine).
  - Reviews: anonymous PDP shows the sign-in gate with **no review form**.

**Known limitations**
- WhatsApp/SMS templates are stored and rendered but dispatch is email-only for
  now (the channel field is ready; a gateway is a drop-in).
- Back-in-stock and price-drop campaigns have configuration and wishlist flags but
  no trigger job yet.
- The CMS block editor covers all ten types; drag-and-drop reordering is
  up/down buttons rather than pointer dragging.

**Next steps** — Phase 7: SEO (sitemap, robots, structured data sweep),
performance, security & accessibility passes, audit-log UI, error pages,
monitoring and production polish.

---

## Phase 5 — Shipping (Shiprocket) · 2026-08-19

**Features added**
- **Provider abstraction** (`lib/shipping/provider.ts`): a `ShippingProvider`
  interface covering serviceability, shipment creation, AWB, pickup, label,
  manifest, tracking and cancellation, resolved via `getShippingProvider()` so the
  aggregator can be replaced without touching callers (brief §21).
- **Shiprocket implementation** (`lib/shipping/shiprocket.ts`): token auth with
  refresh, REST calls for every operation, and a **simulated dev mode** when
  credentials are absent so the whole lifecycle runs locally and in tests.
- **Pure status mapping** (`lib/shipping/status.ts`): courier status → internal
  `ShipmentStatus` + the `OrderStatus` it drives, plus terminal-state detection.
- **Shipment service** (`lib/shipping/shipments.ts`): create → AWB → pickup →
  label/manifest → tracking, with order-status sync and side effects:
  **commit reserved stock + capture COD on delivery** (recording the cash balance
  as its own `BALANCE` payment row), **release stock on RTO**, NDR reason capture.
- **Admin**: `/admin/shipments` list with status facets (NDR/RTO highlighted) and a
  **shipment panel** on the order detail with all lifecycle actions — permission-
  gated (`shipments.manage`) and audited.
- **Shiprocket webhook** (`/api/webhooks/shiprocket`): shared-token authenticated,
  idempotent via `WebhookEvent`, reprocessable on failure; handles tracking, NDR
  and RTO through the same mapping.
- **Reconciliation cron** (`/api/cron/shipment-reconciliation`, CRON_SECRET): polls
  non-terminal shipments so late/missed webhooks self-heal.
- **Customer tracking**: public `/track` (order number + phone, ownership-checked,
  no disclosure on mismatch) and a tracking block on the order page.

**Bug found and fixed by tests**
- `"UNDELIVERED"` contains the substring `"DELIVERED"`, so a **failed delivery was
  being mapped to DELIVERED** — which would have wrongly committed stock and
  captured COD. Fixed by ordering the NDR rule before DELIVERED and adding a
  `\bDELIVERED\b` word-boundary guard, plus a regression test.

**Tests** (Vitest, 79 total; +7)
- Status mapping: delivery/transit/pickup/NDR/RTO-initiated vs RTO-delivered,
  unknown fallback, terminal-state detection, and the UNDELIVERED regression.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (45 routes) · `vitest` ✓ (79/79).
- **End-to-end lifecycle** driven through the real admin UI (headless Chromium) +
  webhooks + DB assertions:
  - Prepaid order: create shipment → AWB → pickup → label → tracking →
    order `SHIPPED` / shipment `IN_TRANSIT`; then `DELIVERED` webhook →
    order `DELIVERED`, **stock committed 5→4, reserved 1→0**.
  - Webhook auth + idempotency: no token → 401; duplicate delivery → deduped
    (`duplicate:true`), both events `PROCESSED`.
  - **UNDELIVERED webhook → shipment `NDR`** (not delivered), NDR reason recorded.
  - **COD**: ₹1,000 token collected online at checkout, balance on delivery →
    payments reconcile exactly (₹1,000 `COD_TOKEN` + ₹1,052.72 `BALANCE` =
    ₹2,052.72 grand total), order `DELIVERED` / `CAPTURED`.
  - **RTO**: `RTO Initiated` webhook → order `RTO`, shipment `RTO_INITIATED`,
    **reserved inventory released 1→0**.
  - Cron: unauthorized → 401; authorized skips terminal shipments.
  - `/track`: correct order+phone shows status/AWB/timeline; **wrong phone
    discloses nothing**.

**Known limitations**
- Live Shiprocket needs real credentials; dev mode simulates AWBs and tracking.
  Courier selection uses the recommended option (no rate-shopping UI yet).
- NDR follow-up workflow (re-attempt scheduling, customer outreach) is recorded but
  not automated — that belongs with the Phase 6 CRM/campaign work.

**Next steps** — Phase 6: CRM (leads, follow-ups, call logs), CMS + blog, reviews,
appointments, campaigns and abandoned-cart automation.

---

## Phase 4 — Checkout, Payments & Orders · 2026-08-18

**Features added**
- **Phone OTP** (`lib/otp.ts`): hashed codes (HMAC), 10-min expiry, 5-attempt cap,
  resend cooldown, constant-time compare; codes never logged in production.
- **Customer session** (`lib/customer-session.ts` + pure `lib/sign.ts`):
  tamper-evident HMAC-signed cookie, separate from staff auth.
- **Order pipeline** (`lib/orders.ts`) — the server is authoritative:
  - Totals are **always recomputed from the cart/pricing engine**; no amount is
    ever accepted from the browser (RULE 1, §59).
  - **Rate lock**: snapshots the live rates + per-item price breakup onto the
    immutable order; `isRateLockValid` honours `StoreSetting.rateLockMinutes`.
  - **Inventory reserved in a transaction** for ready-to-ship lines (oversell-safe);
    released on payment failure / cancellation.
  - **Rules**: COD blocked above `codMaxOrderValue`; `VERIFICATION_HOLD` above
    `verificationCallAbove`; PAN required above `panThreshold`; made-to-order
    **advance/partial payment** via product `advancePercent`; COD token support.
- **Razorpay** (`lib/payments/*`): orders created **server-side only** from the
  server total; payment + webhook **signature verification** (pure, unit-tested);
  a simulated dev-mode so the whole flow runs without live keys.
- **Webhook** (`/api/webhooks/razorpay`): signature-verified, **idempotent**
  (WebhookEvent recorded before processing, unique per delivery), **reprocessable**
  on failure; handles payment.captured / order.paid / payment.failed / refund.processed.
- **Checkout** (`/checkout`): guest checkout with phone-OTP verification, address,
  payment method (Razorpay / COD / bank transfer), server-side place-order action,
  Razorpay Checkout (live) or simulated confirm (dev). Order confirmation / tracking
  page with timeline; **PDF invoice** (`pdf-lib`) from the frozen snapshot, access-
  controlled (owner or staff).
- **Transactional email** (`lib/email/*`, nodemailer): order + payment confirmations,
  **non-blocking** so an order never fails if email fails (§67); recorded as
  Notifications.
- **Admin orders** (`/admin/orders`): searchable list + detail with price snapshot,
  payments, timeline, internal notes, **controlled state transitions** (pure
  `lib/order-status.ts`), high-value verification recording, manual payment
  confirmation — all permission-gated + audited (DISPATCH is view-only).
- **Customer account** (`/my-account`, `/my-account/orders`): OTP login/logout,
  order history and tracking.

**Tests** (Vitest, 72 total; +13)
- Razorpay payment & webhook signatures (compute/verify, tamper + wrong-secret
  rejection); signed-session round-trip + tamper rejection; order-status state
  machine (valid/invalid transitions, terminal states).

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (42 routes) · `vitest` ✓ (72/72).
- **End-to-end financial flows** driven through the real server with headless
  Chromium + DB assertions:
  - Online order: OTP → pay (dev) → **CONFIRMED / CAPTURED**, `grandTotal` =
    `amountPaid` = server-computed ₹24,432, **inventory reserved** (1 unit), correct
    timeline, valid **PDF invoice** (401 unauthenticated, 200 for staff).
  - High-value made-to-order (₹4.02L): **COD disabled**, **PAN captured**,
    **VERIFICATION_HOLD**, **50% advance** collected (₹201,096) — partial payment.
  - Webhook: bad signature → 400; valid → processed; duplicate delivery → deduped
    (exactly one WebhookEvent).
  - Admin: order manager sees actions; DISPATCH is view-only.

**Known limitations**
- Live Razorpay/SMS/SMTP require real credentials; dev-mode simulates payment and
  logs OTP/email. Balance-payment collection for made-to-order and full refund UI
  are minimal (statuses + webhook wired; richer flows in later phases).
- Shipping/AWB is Phase 5; abandoned-cart automation and campaigns are Phase 6.

**Next steps** — Phase 5: Shiprocket (serviceability, shipment, AWB, pickup,
tracking, NDR, RTO) behind the provider interface; customer tracking.

---

## Phase 3 — Storefront · 2026-08-18

**Features added**
- **Storefront data layer** (`lib/storefront.ts`): URL-param filtering (metal, purity,
  colour, price range, availability, occasion), sorting (recommended / newest /
  price-low / price-high / best-selling), pagination, and search with logging.
  "Virtual" categories (Gold / Silver / Diamond / New Arrivals) filter by attribute
  so the nav resolves to populated pages.
- **Product card + shared UI**: `ProductCard` (badges, wishlist heart, "From ₹"
  range), `PriceLabel` (safe fallbacks), `ProductImage` (monogram fallback,
  SSR-safe onError), `ProductGrid`, `ProductRow` (mobile scroll-snap).
- **Listing pages**: `/c/[category]`, `/collection/[slug]`, `/collections`,
  `/search` with a shared `FilterSort` panel (URL-driven, shareable) + `ListingView`.
- **Product page** (`/p/[slug]`): desktop thumbnail+main / mobile swipe gallery;
  variant & size selector (client picks the engine-computed breakup per variant);
  expandable **price breakup** ("How this price is calculated" — metal, wastage,
  making, diamond, stone, GST, total, rate used, weight, purity, timestamp);
  availability + lead time; **pincode serviceability** check; Add to Bag / Buy Now;
  Wishlist; **WhatsApp enquiry** (pre-filled, number from settings); sticky mobile
  CTA; specs; related products; full SEO + Product & Breadcrumb JSON-LD.
- **Cart** (`/cart`): guest cookie session; add/update/remove server actions with
  ownership + stock checks; **server always recomputes** every line via the pricing
  engine (browser totals never trusted); order summary (metal, making, stones, GST,
  shipping, total) with free-shipping threshold from settings.
- **Wishlist** (`/wishlist`): guest cookie session; toggle heart across cards;
  move-to-bag using the first available variant. Live cart/wishlist counts in the
  header.
- **Pincode serviceability** (`lib/shipping/pincode.ts`): provider stub behind a
  24h cache (Phase 5 swaps in Shiprocket). Site-wide WhatsApp floating button.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (37 routes) · `vitest` ✓ (59/59).
- **Responsive check with headless Chromium** at 360 / 390 / 768 / 1280 across home,
  category, product and cart: **zero horizontal overflow** at every width; mobile
  gallery, sticky CTA and grids verified by screenshot.
- Storefront runtime smoke: listings render engine prices (e.g. gold category shows
  12 products ₹14,171–₹1,57,940); cart totals recomputed server-side (2×ring
  ₹48,564 line, GST ₹1,441, grand total ₹49,490; header badge = 3).

**Known limitations**
- Checkout is a placeholder showing the server-computed total; the full flow (OTP,
  address, rate-lock, Razorpay, COD, invoice) is Phase 4.
- Reviews/ratings appear once Phase 6 adds them (JSON-LD includes aggregateRating
  only when present).
- Product media uses the monogram fallback until real images are uploaded (R2).

**Next steps** — Phase 4: checkout (guest + phone OTP), rate-lock, Razorpay + COD +
bank transfer, webhooks, order creation, invoice, transactional email.

---

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
