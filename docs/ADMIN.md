# Admin Console & Roles

The admin lives at `/admin` (sign in at `/admin/login`). It is dense and
productivity-first — deliberately not the luxury storefront aesthetic.

## Roles & permissions

Authorization is a central capability matrix in `lib/auth/rbac.ts`. Every admin
route and server action re-checks permission server-side via `requirePermission()`
/ `assertPermission()`. **Hiding a menu item is not authorization.**

| Capability | SUPER_ADMIN | ADMIN | CATALOG_MANAGER | SALES_EXECUTIVE | DISPATCH |
| --- | :-: | :-: | :-: | :-: | :-: |
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Products / Categories / Collections / Inventory | ✓ | ✓ | ✓ | | |
| Metal Rates / Making Charges | ✓ | ✓ | ✓ | | |
| CMS / Blog | ✓ | ✓ | ✓ | | |
| Orders (view) | ✓ | ✓ | | ✓ | ✓ |
| Orders (manage) / Finance | ✓ | ✓ | | | |
| Shipments | ✓ | ✓ | | | ✓ |
| Coupons | ✓ | ✓ | | ✓ | |
| Customers / CRM / Appointments / Reviews | ✓ | ✓ | | ✓* | |
| Settings | ✓ | ✓ | | | |
| Staff & Roles | ✓ | | | | |
| Audit Log | ✓ | ✓ | | | |

\* Sales gets CRM, leads, orders (view), customers, coupons, appointments — but
**cannot** modify rates, settings, staff or financial configuration.

- **SUPER_ADMIN** — everything, including staff/role management.
- **ADMIN** — everything except the super-admin-only destructive action
  (staff & role management).
- **CATALOG_MANAGER** — catalogue, rates, making charges, CMS/blog.
- **SALES_EXECUTIVE** — CRM/sales operations only.
- **DISPATCH** — dispatch operations (orders view, shipments).

The sidebar (`lib/admin/nav.ts`) is filtered per role by the same matrix.

## Dashboard

Reads live counts: orders today, sales today, pending payments, pending dispatch,
new customers, new leads, upcoming appointments, low stock, abandoned carts. All
queries are defensive (fall back to zero) so the panel always renders.

## CRM, CMS & campaigns (Phase 6)

- **CRM** (`/admin/crm`) — lead pipeline, assignment, follow-ups, call logs.
  **Sales executives are scoped server-side to their own leads**; a direct URL to
  someone else's lead returns not-found. Managers (`orders.manage`) see all leads.
- **Customers** (`/admin/customers`) — lifetime value, orders, addresses,
  appointments and linked leads.
- **Appointments** (`/admin/appointments`) — status and staff assignment.
  Bookings from `/appointments` auto-raise a CRM lead.
- **Reviews** (`/admin/reviews`) — moderation queue. Customers may only review
  products they actually purchased (re-verified server-side), and nothing appears
  on the storefront until approved.
- **CMS** (`/admin/cms`) — block-based pages. Twelve fixed block types, each with
  its own schema; **no free-form HTML editor**, so content can never inject markup.
- **The homepage is one of those pages.** It is the CMS page with the reserved
  slug `home`, served at `/` — hero image (desktop and mobile), headline,
  subheading, both buttons, the category band, the three product rows, the
  editorial band and the trust row, all editable. Notes:
  - If the row does not exist yet, `/admin/cms` offers **Set up homepage**.
    Clicking it changes nothing a customer sees: it copies the built-in default
    layout into editable blocks, exactly as rendered.
  - Its address is fixed. The slug field is read-only and the page cannot be
    deleted. To go back to the built-in default, set its status to **Draft** —
    `/` falls back to it rather than 404ing.
  - `/pages/home` permanently redirects to `/`, and the sitemap lists `/` only.
- **Blog** (`/admin/blog`) — posts with SEO fields and Article structured data.
- **Campaigns** (`/admin/campaigns`) — the seven emails the shop sends on its own.
  Each card says when it fires, what drives it, and links straight to the wording
  it sends. Switching one off stops it. Configurable abandoned-cart delays
  (abandon-after, three stages, minimum gap). Scheduled ones run via
  `POST /api/cron/abandoned-cart`, `POST /api/cron/campaigns` and
  `POST /api/cron/recompute-prices` with the `CRON_SECRET` bearer token; the rest
  send immediately. **Nothing sends at all without SMTP** — the page says so at
  the top when it is unconfigured.

## Phase 3 additions

### Compliance and money

- **GST invoices** — HSN per line, place of supply, CGST/SGST vs IGST derived from
  the shipping state, and an HSN summary. The breakup is frozen onto the order:
  rates and the seller's state can change, and a reprinted invoice must show what
  was actually charged. Invoice numbers are sequential per financial year and
  allocated inside the order transaction, so two concurrent orders cannot share one.
- **Coupons** (`/admin/coupons`) — scoped to a price *component*, defaulting to
  **making charges**. A flat percentage off a ₹4,00,000 necklace gives away money
  from gold sold at cost. Scope by category, collection, metal, purity and weight;
  redemption count increments inside the order transaction.
- **EMI** — enabled in Razorpay checkout and shown from a tenure table in Settings,
  labelled indicative because the bank sets the real rate.

### Marketing and content

- **Templates** (`/admin/marketing/templates`) — every customer email: order
  placed, payment, shipped, delivered, abandoned cart, back in stock, price drop,
  welcome, birthday, anniversary, appointment. Subject and body are editable with a
  live preview and a test send. Variables come from a fixed per-template list and
  are substituted literally — there is no expression language. Bodies are sanitised
  on save. A missing or inactive template falls back to the built-in copy, so an
  order confirmation can never silently not send.
- **SEO** (`/admin/seo`) — site defaults, indexing switch, robots rules, local
  business data, and a report of pages missing a title, description or social image.
  Every product, category, collection, page and post also has its own
  **Search & social** panel: title, description, social image, canonical override
  and hide-from-search, with warnings for a long title, an off-site canonical, a
  social image below 1200×630, and a live page hidden from search.
- **Redirects** (`/admin/redirects`) — list, search, hit counts and CSV import.
  A 301 is created **automatically whenever a slug changes** on a product,
  category, collection, page or post; loops and chains are rejected on save.
- **Enquiries** — the WhatsApp button logs a lead before opening WhatsApp,
  deduplicated per shopper per day. Abandoned carts raise a lead with their value.

### Merchandising

- **Video** — a YouTube or Vimeo **address**, never embed code, on products, in a
  Video block, and on its own line inside a blog post or rich text. Nothing loads
  until the visitor presses play.
- **Images** — one upload field everywhere (products, CMS, blog, categories,
  collections, social images, logo and favicon), with progress and alt text.
- **Rate ticker** (`/admin/rates`) — the scrolling strip at the top of the site.
  On/off, which purities and in what order, speed, background and an optional
  message. It has no rate field: it shows the same rates the shop prices from.
- **Trust signals** — the hallmark and certificate on a product page, with a
  verification link where the issuer publishes one, plus a ring and bangle size
  guide beside the size selector.

### Working with lists

- **Date filters** on orders and CRM — presets and a custom range, counted in
  **IST** so the last day of a range includes the whole day. Count and value for
  the range, filters kept across pagination, and CSV export of exactly what is
  on screen.
- **Removal** — products and customers are soft-deleted, orders are archived, and
  only a lead is really deleted. Each needs its SKU, phone number or name typed to
  confirm, and each writes an audit entry. Archive views restore. A customer's
  personal details can be erased for a data request while their orders and
  invoices remain.

## Roadmap (by phase)

- **Phase 2** — Products/variants/images CRUD, CSV import (dry-run), inventory,
  rate management with impact preview, making-charge rules.
- **Phase 4** — Orders lifecycle, verification hold, refunds, coupons.
- **Phase 5** — Shipments (Shiprocket), AWB, tracking.
- **Phase 6** — CRM, CMS, blog, reviews, appointments, campaigns.
- **Phase 7** — Audit log UI, observability.
- **Phase 3 (this round)** — GST invoicing, coupons, EMI, email templates,
  enquiry capture, SEO control, redirects, video, uploads, rate ticker, trust
  signals, date filters, soft delete.

## Before a shop goes live

Two things are configuration, not code, and nothing works without them:

1. **A scheduler must call the cron endpoints** with `Authorization: Bearer
   $CRON_SECRET`. Nothing calls them by itself. Until one does, the shop keeps
   pricing from whatever metal rate was last entered by hand, and abandoned-cart,
   birthday, back-in-stock and price-drop mail is never sent. See `.env.example`
   for the four endpoints and suggested intervals.
2. **SMTP must be configured**, or no email leaves the system — including order
   confirmations. Templates can be written and previewed either way.
