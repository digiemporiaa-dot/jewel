# Database

PostgreSQL via Prisma. `prisma/schema.prisma` is the **source of truth** and must
not be modified without approval. All money/weights use `Decimal` columns.

## Domains

### Store configuration
- **StoreSetting** — singleton (`id = "default"`). Brand, contact, GST, currency,
  `codMaxOrderValue`, `codTokenAmount`, `verificationCallAbove`, `panThreshold`,
  `rateLockMinutes`, social links. Everything store-specific lives here.
- **NavItem** — admin-controllable storefront navigation.

### Identity
- **User** — staff/admin with `Role` (SUPER_ADMIN, ADMIN, CATALOG_MANAGER,
  SALES_EXECUTIVE, DISPATCH), bcrypt `passwordHash`.
- **Customer** — phone-first (OTP login in Phase 4), optional email, DOB/anniversary
  for campaigns. **Otp** — hashed codes with expiry + attempt tracking.
- **Address** — customer addresses.

### Catalog
- **Category** (self-nesting), **Collection** (+ `ProductCollection` join).
- **Metal** / **Purity** — Gold (24K/22K/18K), Silver (925). `fineness` is Decimal.
- **MetalRate** / **DiamondRate** — rate history; `isCurrent` marks the live rate.
- **MakingChargeRule** — `scope` (VARIANT → CATEGORY_METAL_PURITY → CATEGORY_METAL →
  METAL → GLOBAL), `type` (PERCENTAGE / PER_GRAM / FLAT), `minCharge`, `priority`.
- **Product** — `pricingMode` (WEIGHT_BASED / COMPONENT_BASED / FIXED), metal/purity,
  weights, wastage, GST config, fulfilment (READY_TO_SHIP / MADE_TO_ORDER), lead time,
  cached `priceFrom`/`priceTo`, SEO, merchandising flags, `occasion`/`tags`.
- **ProductVariant** (+ overrides), **ProductImage**, **ProductDiamond**,
  **ProductStone**.
- **Inventory** (`stockQty`, `reservedQty`, `lowStockThreshold`) + **InventoryLedger**.

### Commerce
- **Cart** / **CartItem** (guest via `sessionToken`; abandoned-cart fields).
- **WishlistItem** (guest + customer; price-drop / back-in-stock flags).
- **Coupon**.
- **Order** / **OrderItem** — immutable product + price-breakup + `rateSnapshot`
  frozen at purchase; `OrderStatus` state machine; verification fields.
  **OrderEvent** (timeline), **OrderNote** (internal).
- **Payment** / **Refund** — Razorpay/COD/bank; `PaymentType` FULL/ADVANCE/BALANCE/
  COD_TOKEN.
- **WebhookEvent** — unique `(provider, eventId)`; idempotent, signature-verified,
  reprocessable.
- **Shipment**, **PincodeServiceability** (24h cache).

### Engagement & content
- **Review** (approval workflow, verified-purchase).
- **Appointment** / **AppointmentSlot**.
- **Lead** / **FollowUp** / **CallLog** (CRM).
- **CmsPage** / **CmsBlock** (fixed block types), **BlogPost**.
- **Campaign**, **MessageTemplate**, **Notification**.

### Analytics & audit
- **SearchLog**, **AnalyticsEvent** (provider-agnostic queue).
- **AuditLog** — append-only record of sensitive actions (`before`/`after`, IP).

## Indexing

Indexes are declared in-schema on slug, SKU, category, collection, pricing mode,
active status, `createdAt`, order/payment/shipment status, customer phone/email,
appointment date, lead status, and the webhook `(provider, eventId)` unique.

## Migrations

Baseline migration `prisma/migrations/0_init`. Production applies with
`prisma migrate deploy`; local dev may use `prisma db push`.
