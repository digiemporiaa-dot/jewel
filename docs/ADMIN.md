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
- **CMS** (`/admin/cms`) — block-based pages. Ten fixed block types, each with its
  own schema; **no free-form HTML editor**, so content can never inject markup.
- **Blog** (`/admin/blog`) — posts with SEO fields and Article structured data.
- **Campaigns** (`/admin/campaigns`) — automation toggles, configurable
  abandoned-cart delays (abandon-after, three stages, minimum gap) and editable
  message templates. Runs via `POST /api/cron/abandoned-cart` and
  `POST /api/cron/campaigns` with the `CRON_SECRET` bearer token.

## Roadmap (by phase)

- **Phase 2** — Products/variants/images CRUD, CSV import (dry-run), inventory,
  rate management with impact preview, making-charge rules.
- **Phase 4** — Orders lifecycle, verification hold, refunds, coupons.
- **Phase 5** — Shipments (Shiprocket), AWB, tracking.
- **Phase 6** — CRM, CMS, blog, reviews, appointments, campaigns.
- **Phase 7** — Audit log UI, observability.
