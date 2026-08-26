# Integrations

All third-party providers are abstracted behind interfaces so they can be swapped
per brand (white-label) and so failures degrade gracefully. Implemented in the
phases noted below; the data model and env contract exist now.

## Payments — Razorpay (Phase 4)
- Razorpay orders are created **server-side only**. `amount`, `discount`, `total`
  and payment status are never trusted from the browser.
- Methods: UPI, cards, net-banking, wallets, plus COD and bank transfer.
- Webhooks (`payment.captured`, `order.paid`, `payment.failed`, `refund.processed`)
  are **signature-verified, idempotent, logged and reprocessable** — a
  `WebhookEvent` row (unique `(provider, eventId)`) is created *before* processing.
- Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

## Shipping — Shiprocket (implemented, Phase 5)
- **Provider interface**: `lib/shipping/provider.ts` defines `ShippingProvider`
  (serviceability, createShipment, assignAwb, schedulePickup, label, manifest,
  track, cancel). `getShippingProvider()` returns the configured implementation,
  so the aggregator can be swapped without touching callers.
- **Implementation**: `lib/shipping/shiprocket.ts` (token auth with hourly refresh,
  REST calls). With no credentials it runs in **simulated dev mode** returning
  deterministic AWBs/tracking, so the full lifecycle is exercisable locally.
- **Status mapping**: `lib/shipping/status.ts` is pure and unit-tested. It maps a
  courier status to our `ShipmentStatus` and the `OrderStatus` it should drive.
  ⚠️ The NDR rule deliberately precedes DELIVERED — `"UNDELIVERED"` contains the
  substring `"DELIVERED"`, and mis-mapping would wrongly commit stock and capture
  COD. `\bDELIVERED\b` guards it a second time.
- **Shipment service**: `lib/shipping/shipments.ts` creates shipments, assigns
  AWBs, schedules pickups, generates labels/manifests, refreshes tracking, and
  applies status changes with side effects — commit stock + capture COD on
  delivery (recording a `BALANCE` payment row), release stock on RTO.
- **Webhook**: `POST /api/webhooks/logistics` — shared-token authenticated
  (`x-api-key`), recorded as an idempotent `WebhookEvent`, reprocessable on failure.
  Also served at `POST /api/webhooks/shiprocket`, the original path: one handler,
  re-exported, so the two cannot drift. Register `/logistics` in their dashboard —
  it refuses any URL containing "shiprocket", "sr" or "kr". Idempotency is shared
  across both paths (same `provider` + `eventId`), so a retry that arrives on the
  other path is still recognised as a duplicate.
- **Reconciliation cron**: `POST /api/cron/shipment-reconciliation` (CRON_SECRET)
  polls non-terminal shipments in case webhooks are late or missed.
- **Customer tracking**: `/track` (order number + phone, ownership-checked) and a
  tracking block on the order page.
- Pincode serviceability cached 24h (`PincodeServiceability`).
- **Login handling**: the token is cached at module scope until its own `exp`
  claim runs out, and one login at a time is attempted however many callers are
  waiting. After two consecutive 401/403 refusals a breaker opens for 15
  minutes; a 403 whose body says the account is *blocked* opens it for an hour,
  on the first sighting. During a cooldown nothing is sent to Shiprocket at all
  — the request itself is the damage, because enough failed logins locks the API
  user and only their support can unlock it. A cooldown clears on the next
  successful login, or on redeploy.
- **What staff see**: a locked account, a wrong password and a Shiprocket outage
  produce three different sentences, each naming who can fix it. Wrong password
  names `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD`; a lockout says only
  Shiprocket support can clear it. The provider's raw body is logged, never shown.
- Env: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`,
  `SHIPROCKET_PICKUP_PINCODE`, `SHIPROCKET_PICKUP_LOCATION`.

## Media — Cloudflare R2 / S3 (Phase 2)
- Images are **never** stored in Postgres. Flow: admin requests an upload URL →
  server validates MIME/size/extension/dimensions → presigned URL → direct upload
  → metadata saved. WebP/AVIF generated where practical.
- Env: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_PUBLIC_URL`.

## Email — SMTP / Resend (Phase 4)
- Transactional templates (OTP, order/payment/shipment/refund/appointment,
  made-to-order status). Order creation must succeed even if email temporarily
  fails (queue + retry).
- Env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

## Cron (Phase 2+)
- Protected endpoints (`CRON_SECRET`) for rate-driven catalogue price refresh,
  abandoned-cart reminders, birthday/anniversary campaigns, expired rate locks,
  pending-payment reminders and shipment reconciliation.

## Analytics (Phase 3+)
- Provider-agnostic event queue (`AnalyticsEvent`) — `page_view`, `view_item`,
  `add_to_cart`, `begin_checkout`, `purchase`, `whatsapp_click`, etc. GA4 can be
  wired later without touching call sites. Never blocks rendering.
