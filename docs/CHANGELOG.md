# Changelog

## Phase 3 · Item 4 — Editable email templates · 2026-08-22

Every word the shop emails a customer was hardcoded. Birthday and anniversary
campaigns ran from `lib/campaigns/`, but the client could not change a syllable
without a code edit — and the one `MessageTemplate` row that *was* seeded for
birthdays was never read, so editing it did nothing.

### What the client can now change

Marketing → **Email Templates** lists all six emails the shop sends: order
confirmation, payment received, abandoned-cart reminder, birthday, anniversary
and appointment request. Each opens on its current wording, with a live preview,
a click-to-insert list of the variables it may use, and a send-yourself-a-test
box.

### What it deliberately does not accept

There is no "paste your script here" field, no custom `<head>` fragment, and no
way for operator-typed text to become executable.

- **Substitution is plain string replacement against a fixed per-template
  whitelist.** No expression language, no `eval`, no `new Function`. `{{1+1}}`
  is not a variable name and renders literally; `{{__proto__}}` resolves to
  nothing. A substituted value is never re-scanned, so a customer cannot name
  themselves `{{items_table}}` and pull in data the template never referenced.
- **Values are HTML-escaped** unless the registry marks them as HTML, which only
  `items_table` is — because this codebase builds it. A customer called
  `<img onerror=…>` is text in the email and text in the admin preview.
- **Bodies are sanitised on save**, not on send, so the database only ever holds
  safe markup. Formatting, links and images survive; `<script>`, `<style>`,
  `<iframe>`, `on*` handlers and `javascript:`/`data:` URLs do not. Saving
  something that gets stripped says so rather than silently swallowing it.
- **Unknown placeholders are rejected, not dropped.** An operator who types
  `{{tracking_number}}` is told it will never resolve, instead of finding a
  blank gap in a customer's inbox.
- The preview renders in a **fully sandboxed iframe** through the same sanitiser
  the save uses — a preview that shows what the save would strip is a preview
  that lies.

The old template editor on the Campaigns page has been **removed**. It accepted
an arbitrary key and arbitrary markup with no sanitisation, which is exactly the
free-form-markup vector the marketing-tag work ruled out.

### Nothing goes silent

A row is an *override* of built-in copy in `lib/templates/registry.ts`, never
the only copy. Missing row, inactive row, row saved empty, database hiccup on
lookup — all of them fall back to the built-in wording. A silent non-send on an
order confirmation is worse than an unstyled email, so it cannot happen. For the
same reason transactional emails can be reworded but not switched off.

"Reset to default" **deletes** the override rather than rewriting it with
today's default text, so a reset template tracks future improvements to the
built-in copy instead of freezing this week's version into the database.

### Two behaviour changes on deploy

- The seeded `abandoned_cart` and `birthday` rows are now actually **read**. The
  birthday email will use the seeded row's wording (no brand heading) rather
  than the hardcoded version. Reset it from the admin to go back to the
  built-in copy.
- Fresh deployments seed **no** template rows at all, for the reason above.

### Plain-text alternative

Derived from the HTML when no plain-text version is authored: block boundaries
become line breaks, table cells stay on one line separated by a space, and the
entities the stripper produced are decoded — so a shop called "Ram & Co" reads
as itself rather than as `Ram &amp; Co`.

### Still needed from the operator

`sendEmail` no-ops without SMTP. Templates can be written and previewed today,
but nothing is delivered — and the test-send button says so plainly rather than
reporting a success that did not happen — until `SMTP_HOST` and `SMTP_PORT` are
set on the deployment.

### Verified

`tsc` clean, `next build` clean, lint clean, **277 tests across 21 files**. End
to end against a production build: six templates listed, preview resolves every
sample, `{{card_number}}` rejected by name, a pasted `<script>`/`onclick` body
saved with the markup stripped and the harmless text kept, test-send refused
honestly with no mail server, and reset restoring the built-in copy byte for
byte.

## Phase 3 · Item 3 — EMI display · 2026-08-22

A ₹70,000–₹4,00,000 order is hard to pay in one UPI transfer, and Indian
jewellery shoppers expect to see a monthly figure.

### What shows

"EMI from ₹X/month" on the product page and in the bag, with the full tenure
table behind a "View plans" disclosure. The headline is the **cheapest** monthly
instalment across the configured tenures.

Everywhere it appears it carries: *"Indicative only. Final EMI, tenure and
interest are set by your bank at checkout."* Quoting a firm monthly figure the
bank then refuses is a support problem and a trust problem, so the disclaimer
lives in `lib/emi.ts` rather than being retyped per component.

### Details that matter

- **Recomputed per selected variant.** An 18K and a 22K version of the same ring
  are different money; quoting the default variant's EMI against another
  variant's price would be wrong on screen.
- **Rounded up, never down.** Quoting a rupee less than the bank will charge is
  the kind of small inaccuracy that becomes a support ticket.
- **Hidden below a configurable minimum.** Banks impose their own floor, and
  showing an EMI the shopper cannot get is worse than showing none.
- **0% no-cost EMI does not divide by zero** — a common offer, and it degrades to
  simple division.
- **Malformed configuration is dropped, not rendered.** A bad tenure row would
  otherwise produce `₹NaN/month`, which reads as a broken site.

### Razorpay

`method: { emi: true, cardless_emi: true }` on the checkout options, so the
methods the messaging advertises are actually offered at payment.

### Admin

Settings gains an EMI section: on/off, minimum order value, and a plan table
entered as `months@annualRate` per line. Left blank, it falls back to a shipped
default set rather than saving an empty table that would silently hide EMI.

### Verified

`tsc` clean · `next build` clean · **233 tests** (19 new).

Against a running production build:

- **EMI off (the default): nothing rendered** — 0 occurrences on the product page.
- **EMI on:** `EMI from ₹1,178/month` plus the disclaimer.
- The figure was cross-checked against an independent calculation: the variant's
  live price is ₹24,282.13, which over 24 months at 15% gives ₹1,177.36 exactly —
  quoted as ₹1,178, i.e. rounded up as intended.
- **Minimum raised above the item price: hidden again**, 0 occurrences.

### Operator note

EMI ships **off**. Turn it on in Settings once you have confirmed the tenures and
rates your bank actually offers — the defaults are typical figures, not promises.

## Phase 3 · Item 2 — Jewellery-aware coupons · 2026-08-22

In jewellery, discounts belong on **making charges**. Metal sells at the live
rate with effectively no margin, so "10% off the order total" on a ₹4,00,000
necklace gives away ₹40,000 that is overwhelmingly gold sold at cost.

Measured on the live site with two coupons that differ only in scope, on a
₹24,432 ring:

| Same 10% coupon | Discount |
| --- | --- |
| `MAKING_CHARGES` | **₹161** |
| `ORDER_TOTAL` | **₹2,357** |

Fourteen times the giveaway, for the same headline offer.

### Schema

`CouponScope` enum and, on `Coupon`: `appliesTo` (default `MAKING_CHARGES`),
`categoryIds`, `collectionIds`, `metalTypes`, `purities`, `minWeightGrams`,
`maxWeightGrams`, `excludeDiscounted`, `firstOrderOnly`, `stackable`. Existing
coupons default to `MAKING_CHARGES` — the conservative direction, so no code
suddenly gives away more than it used to.

### Calculation

`lib/coupons/calculate.ts` is pure and fully tested. **Computed per eligible
line, on one named component** — never as a percentage of the bag total.

- Filters narrow, never widen: an empty list means no restriction, and a line
  must match **every** list that is set.
- Weight bounds compare **per piece**: "above 10g" means a 10g piece, not two 5g
  ones that add up.
- A flat coupon spreads across eligible lines in proportion to their base and
  never exceeds it — ₹5,000 off ₹1,000 of making charges would otherwise pay the
  shopper.
- `maxDiscount` scales the per-line parts down together so they still sum to the
  capped total.
- The discount comes off the **taxable value**, so GST is charged on the reduced
  amount. Discounting after tax would have the store remitting GST on money it
  never received.

### Redemption safety

`usageCount` is claimed by a conditional `updateMany` **inside the order
transaction**, before anything else commits. Two shoppers taking the last use at
the same moment cannot both succeed; at these order values one leaked redemption
is a ₹50,000 mistake. If the claim fails the whole transaction aborts, so no
order can exist holding a discount the store refused.

Validity is re-checked at order creation, not only when the code is entered —
rates move, carts sit open for hours, and the last use may go in between. The
browser sends a **code and nothing else**; a client-supplied discount is the same
class of bug as a client-supplied price.

The applied discount is frozen into the order's price snapshot next to the rate
lock, with the per-line detail, so a later edit to the coupon cannot change what
a past order was charged.

### Admin

The coupon section was a placeholder; it is now a real list plus create and edit
screens. The scope selector carries the trade-off in plain terms, and
`ORDER_TOTAL` / `METAL_VALUE` show a warning with the actual arithmetic.
Deactivate rather than delete — orders reference the coupon they were placed
with, and refunds surface months later. `usageCount` is deliberately not
editable.

### Verified

`tsc` clean · `next build` clean · **214 tests** (32 new).

A complete checkout was driven through the browser against a running production
build, ending in a real order:

```
couponCode        LIVEMAKING
discountTotal     161.20        (10% of ₹1,612 making charges)
subtotal(taxable) 23,413.68     (reduced by the discount)
gstTotal            702.41      (3% of the DISCOUNTED base)
tax split         INTRA_STATE cgst=351.21 sgst=351.20
usageCount        0 → 1
```

Concurrency: ten simultaneous claims on a coupon with one use left produced
**exactly one** winner; forty claims on a limit of five produced exactly five.
Those tests need a real database — they run against Postgres when reachable and
skip cleanly when not.

### Operator note

Coupons default to discounting **making charges only**. If a campaign genuinely
needs to discount metal, the scope has to be changed deliberately, and the admin
will warn you.

## Phase 3 · Item 1 — HSN codes and a GST-correct invoice · 2026-08-21

An invoice missing HSN or the wrong tax split is what gets flagged in a GST
audit, and it cannot be corrected retroactively once the goods have shipped.

### Schema

`Product.hsnCode` (default `7113`, backfilled onto existing products by the
column default), `StoreSetting.sellerStateCode`, and on `Order`:
`invoiceNumber` (unique), `placeOfSupply`, `taxBreakup`. Plus `InvoiceCounter`,
one row per financial year.

### The tax split

`lib/tax/gst.ts` is pure and fully tested. Intra-state (buyer state == seller
state) splits CGST + SGST at half the rate each; inter-state charges IGST at the
full rate. Derived from the shipping address at order creation and **frozen into
the order** — rates and the seller's registered state can both change, and a
reprinted invoice must show what was actually charged.

Details that matter:

- **Tax is computed per line and summed**, not by applying a rate to the order
  total. Lines can carry different HSN codes, and the HSN summary a GST invoice
  must show is only derivable line by line.
- **CGST is rounded and SGST takes the remainder**, so the two always add up to
  the line's tax exactly. Rounding half the tax twice can differ from rounding
  the whole by a paisa, which is the kind of thing that gets an invoice queried.
- **The full GST state code table is included.** A partial list would silently
  misclassify sales to whichever state was left out.
- Addresses are free text, so state resolution accepts the code or the name, and
  the spellings shoppers actually type (`New Delhi`, `Orissa`, `Pondicherry`).
  An unresolvable state returns null rather than guessing.
- When the shipping state cannot be resolved the sale is treated as intra-state.
  That is the conservative direction: it files tax to the wrong government, which
  is a correction, rather than under-collecting.

### Invoice numbering

Sequential and gap-free per financial year, `MJ/2026-27/0001`. The prefix is
derived from the brand name, so a redeployment for another jeweller gets its own
series.

Two design points:

- **Allocated when the sale completes, not at checkout.** An abandoned payment
  would otherwise burn a number and leave a gap in a series GST requires to be
  gap-free.
- **`INSERT … ON CONFLICT DO UPDATE … RETURNING`**, called inside the order
  transaction. That takes a row lock, so a second checkout blocks until the first
  commits. Counting orders, or reading the maximum and adding one, both hand two
  concurrent checkouts the same number. `Order.invoiceNumber` also carries a
  unique index as a backstop.

The financial year is computed in **IST**: an order at 02:00 IST on 1 April is in
the new year even though it is still 31 March in UTC.

### Invoice

Now shows HSN per line, taxable value, the tax split with rates, place of supply
and supply type, seller GSTIN and state, invoice number and date, and an HSN
summary table at the foot. Orders predating this change render the GST they
recorded rather than a split that was never charged.

### Admin

HSN on the product editor (defaulted, with a note on when to change it) and the
GST state code in Settings, validated against the real code list.

### Verified

`tsc` clean · `next build` clean · **182 tests** (25 new).

Generated both invoices end to end through the authenticated route against a
running production build:

- Delhi → Delhi: `CGST @ 1.50% ₹1,500.00` + `SGST @ 1.50% ₹1,500.00`, place of
  supply `Delhi (07)`, `MJ/2026-27/0001`
- Delhi → Karnataka: `IGST @ 3.00% ₹3,000.00`, place of supply `Karnataka (29)`,
  `MJ/2026-27/0002`
- Both with HSN `7113` per line and in the summary; the summary reconciles to the
  footer total.

Concurrency: 20 simultaneous allocations produced 20 distinct numbers, 1..20 with
no gaps. That test needs a real database — it talks to Postgres when one is
reachable and skips cleanly when it is not, so `npm test` stays runnable without.

### Operator note

**Set the GST state code in Settings before the next order.** Without it no tax
split can be derived and the invoice falls back to showing the recorded GST
total. `07` for Delhi.

## Marketing tags, dynamic CSP and consent · 2026-08-21

The owner pastes tracking IDs into the admin and they work — no code edit, no
redeploy.

### No raw script paste, ever

There is no "paste your snippet here" box, no custom `<head>` field, nothing that
injects operator-supplied markup. A free-form script field in an e-commerce admin
is a card-skimming vector: any staff account, or one stolen session, could inject
a script that reads the checkout form and posts card details elsewhere, and the
site would keep working normally so nobody would notice.

Instead: **one typed, format-validated field per provider**, with every script
generated by our own code from the ID. Anything exotic goes inside GTM.

- `lib/marketing/tags.ts` — strict pattern per provider, enforced server-side and
  shown to the operator as the hint, so the format they see is the one checked.
  A bad value is **rejected with a message**, never silently stripped — quietly
  removing characters leaves a field that looks configured and does nothing.
  Empty saves as `NULL` (tag off), never as an empty string that would render a
  broken tag.
- Values are **re-validated on read**. The database is not the same trust
  boundary as the form: a value could arrive from an older build, a manual SQL
  edit or a restored backup, and anything that fails its pattern is dropped
  rather than rendered.
- `metaCapiToken` is structurally absent from `PublicTagConfig` — not merely
  omitted at one call site — so no future edit can leak it by forgetting to strip
  a field. Masked as `••••1234` in the admin, and re-entry is required to change
  it; submitting the form with the mask untouched never overwrites the real value.

### Dynamic CSP — the step that would otherwise break everything silently

The old policy allowed only `'self'` and Razorpay, so a correctly pasted GA4 ID
would have produced a page that looked perfect and tracked nothing: the browser
blocks the script without disturbing the layout.

- The CSP **moved out of `next.config.mjs` entirely** into `middleware.ts`.
  Headers declared in the config are fixed at server start *and* override what
  middleware sets, so leaving it there would have meant two policies fighting with
  the static one silently winning. One owner now; the baseline is in
  `lib/security/csp.ts`.
- `lib/marketing/csp.ts` holds the host table and the composition, pure and
  tested. It only ever **appends**, and only to a directive the base policy
  already declares — so a configuration change can widen the policy as far as the
  enabled tags' own hosts and no further. `script-src` is never widened to
  `https:`; that would remove the protection entirely and reinstate the
  raw-paste vector through the back door.
- The policy mirrors the rendering rule: under GTM the direct tags do not load,
  so their hosts are not granted either.
- Middleware runs on Edge and cannot reach Prisma, so the host list comes from
  `/api/internal/tag-csp` and is memoised per isolate for 30s. That endpoint
  returns hostnames only — no IDs, no token.

### Rendering

- `next/script` with `afterInteractive` throughout. This is a jewellery
  storefront where large images already dominate LCP; analytics must not compete
  with first paint.
- **GTM supersedes GA4 / Ads / Meta**, with a warning in the admin naming exactly
  which tags are saved but not loaded. Firing the same purchase from GTM *and* a
  direct tag doubles every conversion, which silently corrupts the ROAS the client
  uses to set ad spend.
- `googleSiteVerification` renders as a `<meta>` via Next's metadata API — never
  a script.
- Meta CAPI is server-side only. The token is read straight from the database at
  send time and used to call Meta directly.

### Events and the once-per-order guarantee

`view_item` · `add_to_cart` · `begin_checkout` · `purchase`, with real INR values.

`purchase` is claimed by a single conditional `UPDATE` on a new
`Order.purchaseTrackedAt` column — the same idempotency shape as the existing
`WebhookEvent` handling. The claim is taken *before* the event is emitted, so the
failure mode is an under-count rather than a double-count. An unpaid order never
claims: reporting a `PENDING_PAYMENT` order would count a conversion the client
never earned. The browser Pixel and the server CAPI call share the order number
as the event ID, so Meta deduplicates the pair.

### Consent

`REQUIRED` by default — India's DPDP Act requires consent for this kind of
tracking, and a Meta Pixel without it is a live risk for any EU visitor. Google
Consent Mode v2 signals denied-first, updated on accept. Brand-styled banner,
Accept / Decline only, six-month first-party cookie, re-openable from the footer.

### Verified against a running production build

- `tsc --noEmit` clean · `next build` clean · **157 tests** (36 new).
- **All tags empty → the CSP is byte-identical** to the previous header.
- Setting GA4 + Meta added exactly their hosts to the live `script-src` and
  `connect-src`, with no rebuild.
- **Zero tag network requests before Accept** under `REQUIRED`; both loaded after;
  cookie set for 6 months; banner does not return once answered.
- The CAPI token appears **nowhere** in page source, the RSC payload, or the
  internal endpoint, across four routes.
- **Five concurrent purchase claims → exactly one won**; later refreshes won
  none; a `PENDING_PAYMENT` order claimed nothing.
- `/admin/marketing/tags` → 307 when unauthenticated.

### Notes for the operator

- A saved change reaches the CSP within ~30 seconds (the middleware memo), not
  instantly. The admin screen says so.
- The tag config is cached and invalidated on save via `revalidateTag`. That is
  correct on a single container; running several would need a shared invalidation
  signal, the same caveat that already applies to the in-memory rate limiter.
- `INTERNAL_BASE_URL` can point the middleware's lookup at the container's own
  loopback address instead of back out through the proxy.

## CMS design controls + managed navigation · 2026-08-21

### Block design controls

- **`lib/cms/style.ts`** — a constrained presentation vocabulary (`background`,
  `spacing`, `align`, `width`, `mediaSide`, `columns`) stored under a `style` key
  inside the existing `CmsBlock.data` JSON. No migration.
  - **Fixed choices only.** No colour picker, no CSS field, no free spacing input.
    Every option maps to a complete literal Tailwind class — nothing is ever
    interpolated into a class string, because Tailwind's scanner cannot see
    `bg-${x}` and it would be an injection surface besides.
  - **Per-type capability map** decides which controls a block offers, so a FAQ
    never shows an image-side control. Adding a block type later is one row.
  - **A velvet background switches text to light automatically.** Headings carry
    an explicit `color: var(--ink)` from globals.css, so inheriting is not enough;
    the override is applied deliberately. Dark text on dark green is the obvious
    failure and staff would not catch it in an editor that shows blocks on white.
  - **Backwards compatible by construction.** Each type's defaults reproduce its
    original markup, seeded from the legacy content fields where one already
    existed (`RICH_TEXT.align`, `IMAGE_TEXT.imagePosition`, `BANNER.tone`), which
    `syncLegacyFields` keeps in step on save. Those three duplicate controls were
    removed from the content form rather than left to fight the new ones.
- `BlockRenderer` consumes the resolved classes for all ten types; `BlockEditor`
  gains a Design panel driven by the capability map plus a *View on storefront*
  link. `ProductRow` takes an optional `sectionClassName` so a CMS block can set
  its own rhythm without affecting the homepage.

### Managed header and footer

- **Schema**: new `NavMenu` addressed by a stable `key`; `NavItem` gains `menuId`.
  The migration adds the column **nullable, backfills existing rows to the header
  menu, then sets NOT NULL** — `prisma migrate deploy` runs against live data at
  container start, and the table already held 13 rows.
- **`lib/navigation.ts`** serves menus by key through `unstable_cache`, tagged and
  invalidated on save. Header and footer render on every page, so an uncached
  query per request was a real cost. Errors propagate out of the cached function
  on purpose: `unstable_cache` does not store a rejection, so a database blip
  cannot pin the fallback in cache.
- **Fallback**: an empty or failing menu falls back to the built-in arrays.
  Verified by emptying the header menu — the storefront still rendered all 13
  links rather than an empty bar.
- Header renders one level of dropdown, opened by hover **or keyboard focus**
  (`focus-within`), with no client component. Mobile drawer shows children inline.
- **`/admin/navigation`** behind `settings.manage`: menu picker, add/edit/delete,
  up-down reorder, link picker (published pages, categories, collections, or a
  custom URL), and *Reset to defaults*. Every mutation re-checks the permission
  server-side and writes an audit entry. Hrefs are restricted to a site-relative
  path or `https://` — `javascript:` and protocol-relative URLs are refused.
- **Broken-link warnings**: links pointing at a `/pages/<slug>` that is missing or
  unpublished are flagged per item and summarised at the top. This is the exact
  failure that was already live — the footer shipped linking to seven pages that
  had never been created.

### The seven missing pages

- `shipping-returns`, `jewellery-care`, `contact`, `hallmark`, `certifications`,
  `privacy`, `terms` created as **DRAFT** with placeholder guidance blocks.
  Publishing legal text the jeweller has not read would be a commitment made on
  their behalf — worse than a 404. The admin flags them as unpublished until
  someone fills them in.
- **`prisma/bootstrap.ts`** holds the menu and page definitions and is idempotent:
  it creates what is missing and touches nothing that exists, so it is safe to run
  against a live store (`npm run db:bootstrap`) without the destructive `seed.ts`.
  Verified by running it twice — the second run created nothing.

### Verified

- `tsc --noEmit` clean · `next build` clean · **121 tests** (14 new, covering the
  backwards-compatibility guarantee and the class-mapping rules).
- `/pages/about` still emits its original classes after the change: `bg-paper-2`,
  `py-14 lg:py-20`, `grid-cols-2 lg:grid-cols-4`, `bg-velvet`, `py-14`.
- Styling a block to velvet/roomy/centre produced `bg-velvet text-paper` with
  `py-20 lg:py-24` and light body text on the live page.
- Migration verified against the populated table: 13 rows adopted, 0 orphans.
- No horizontal overflow at 360/390/768/1280 across four pages.
- `/admin/navigation` returns 307 to the login when unauthenticated.

### Found, not fixed — pre-existing soft 404

`/pages/<unknown-slug>` returns **HTTP 200** carrying the 404 page body, instead
of a real 404. Same for `/p/<unknown-product>`. This predates these changes
(present since the Phase 6 CMS commit) and affects any `force-dynamic` route
calling `notFound()`.

No content leaks — draft pages correctly render the not-found page, and the
sitemap already excludes them. But search engines treat a 200 as a real page, so
the seven new DRAFT policy URLs would be indexable as soft 404s until published.
Left alone because the fix touches caching behaviour on product and category
routes too, which deserves its own decision.

## Deployment — Coolify + Vercel · 2026-08-19

Deployment readiness pass. No product behaviour changed; the pricing engine,
order pipeline and security model are untouched.

**Added**
- **`GET /api/health`** — readiness probe. `200 {"status":"ok","database":"up"}`
  when Postgres answers, `503 {"status":"degraded"}` when it does not. Deliberately
  reports nothing else: an unauthenticated endpoint must not become a
  reconnaissance surface, and the error text goes to the logs, never the response.
  Wired into Coolify's health check *and* a Dockerfile `HEALTHCHECK`, so a failed
  deploy rolls back instead of serving a broken site.
- **`docs/VERCEL.md`** — the serverless path, including the four things that
  actually differ there (pooled database URL, shared rate-limit store, `vercel.json`
  cron, 60s function cap) and a trade-off table against the Docker/Coolify target.
- **`vercel.json`** — cron schedule (UTC) for the four scheduled jobs.
- Optional **Upstash Redis** backend for `lib/rate-limit.ts`, over the REST API so
  it adds no dependency. Required on serverless, where in-memory counters are
  per-isolate and an attacker gets a free attempt per cold start. It **fails open**
  to the in-memory counter if Redis is unreachable — a rate limiter must never take
  checkout down with it. `checkLimit` is now async; the four call sites await it.

**Changed**
- `docs/DEPLOYMENT.md` — the Coolify section is now a real runbook: VPS
  prerequisites, database-first ordering, build-pack settings, required env vars,
  migrations as a pre-deployment command, domain/TLS/health, scheduled tasks,
  post-deploy verification and webhook wiring.
- Cron routes export **both `GET` and `POST`** (Vercel Cron sends GET with a bearer
  token; Coolify/cURL send POST). Same secret-checked handler either way, plus
  explicit `runtime = 'nodejs'` and `maxDuration = 60`.
- `next.config.mjs` — `output: 'standalone'` is now skipped on Vercel (which builds
  its own output) and kept everywhere else, so the Docker image is unaffected.
  `images.remotePatterns` is derived from `R2_PUBLIC_URL` / `R2_ENDPOINT` /
  `IMAGE_HOSTS` instead of a blanket `https://**` — on a metered host a wildcard
  turns the image optimizer into an open proxy anyone can bill to your account.
- `package.json` — `postinstall: prisma generate` so a cached `node_modules` can
  never ship a stale client.

**Verified**
- `tsc --noEmit` clean · `next build` clean · **107/107 tests** (4 new, covering the
  rate-limiter fallback and fail-open paths).
- Build succeeds with an **unreachable database** — every data-backed route is
  dynamic, so the Docker build needs no DB at image-build time.
- Standalone server booted and probed: `/api/health` → 200 with Postgres up,
  **503 with Postgres stopped**, back to 200 on recovery. Security headers present
  on the response.

**Not done**
- Nothing is deployed. This prepares the repository; provisioning the VPS, Coolify,
  the database and DNS is a manual step (`docs/DEPLOYMENT.md`).
- Automating `prisma migrate deploy` inside a Vercel build would need a `directUrl`
  in the `datasource` block. That is a Prisma schema change, so per **RULE 3** it
  was not made — documented in `docs/VERCEL.md` instead.

## Phase 7 — Production Polish · 2026-08-19

**Features added**
- **SEO**: `app/sitemap.ts` (live products, categories, collections, published CMS
  pages and blog posts — 43 URLs on seed data) and `app/robots.ts` excluding
  admin/API/transactional routes. Site-wide **Organization + WebSite JSON-LD**
  with a `SearchAction`, joining the existing Product, Breadcrumb and Article
  structured data.
- **Audit log UI** (`/admin/audit`): filterable by action and entity, showing who,
  what, before/after, IP and timestamp. **Read-only by design** — no edit or delete
  action exists, so the record stays append-only (brief §44).
- **Store settings** (`/admin/settings`): the white-label configuration surface —
  brand, contact, address/GST, and every commerce rule (free-shipping threshold,
  COD limit and token, verification-call and PAN thresholds, rate-lock minutes),
  social links and policies. Changes are audited.
- **Staff & roles** (`/admin/staff`, SUPER_ADMIN only): create accounts, change
  roles, enable/disable, reset passwords. Guards against removing the **last active
  super admin**; passwords are never written to the audit log.
- **Rate limiting** (`lib/rate-limit.ts`): fixed-window limiter applied to OTP send
  (per IP *and* per phone), OTP verify, appointment booking and review submission.
- **Security headers**: a real **Content-Security-Policy** (Razorpay + Google Fonts
  are the only third parties), HSTS, `Permissions-Policy`, plus `no-store` on
  admin/cart/checkout/account/order routes.
- **Structured logging** (`lib/logger.ts`): single-line JSON with **secret
  redaction** — passwords, OTPs, tokens, signatures, PAN and card fields can never
  reach the logs.
- **Accessibility**: skip-link as the first tab stop, `<main>` landmark, and a
  labelled pincode input (the one gap the audit found).
- **Docs**: backup/restore procedure, cron schedule table, monitoring and alerting
  guidance, and the security posture — all in `docs/DEPLOYMENT.md`.

**Tests** (Vitest, 103 total; +11)
- Rate limiter: allows to the limit then blocks, resets after the window, keys are
  independent (one caller cannot block another), buckets are pruned, and the OTP
  presets are asserted strict.
- Log redaction: secret keys redacted by substring, nested objects and arrays
  covered, PAN redacted, errors flattened without stack traces, deep-nesting guard.

**Verification**
- `tsc --noEmit` ✓ · `next build` ✓ (**60 routes**) · `vitest` ✓ (103/103).
- **Mobile QA sweep** at 360 / 390 / 768 / 1280 across ten pages (home, category,
  product, cart, search, appointments, blog, CMS page, track, collections):
  **zero horizontal overflow at every width**.
- **Production build console audit**: **0 CSP violations, 0 JavaScript errors**
  across seven pages. (The `unsafe-eval` violation seen under `next dev` is Next's
  hot-reloader and does not occur in the built app — checked against the real
  standalone server.)
- **Accessibility audit** (automated, all storefront pages): no missing alt text,
  no unnamed buttons/links, no unlabelled inputs, `<main>` present, exactly one
  `h1`. Skip link confirmed as the first tab stop.
- **SEO**: `robots.txt` and `sitemap.xml` verified live; Organization/WebSite
  JSON-LD present on the homepage.
- **Security**: CSP/HSTS/Permissions-Policy headers verified on responses;
  `/admin` → 307; all four cron endpoints → 401 without the secret; **ADMIN is
  redirected away from `/admin/staff`** with no staff UI leaked (SUPER_ADMIN only).
- **Image fallback**: production build renders **0 broken images** — the monogram
  placeholder replaces the seed's fictional image paths.

**Known limitations / recommended before go-live**
- **One index recommendation, not applied**: `/admin/audit` filters by `action`,
  which has no index, and AuditLog grows unboundedly. Adding
  `@@index([action, createdAt])` to `AuditLog` would keep it fast. This is a Prisma
  schema change, so per RULE 3 it awaits your approval rather than being applied.
- The rate limiter is in-memory and therefore per container — correct for a single
  instance; swap the store for Redis before scaling horizontally.
- Product imagery is placeholder (monogram fallback) until real photography is
  uploaded to R2.
- Live Razorpay / Shiprocket / SMTP / R2 credentials must be set, and
  `AUTH_SECRET` + `CRON_SECRET` rotated, before go-live.

---

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
