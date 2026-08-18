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

## Shipping — Shiprocket (Phase 5)
- Accessed through `lib/shipping/provider.ts` (interface) so the courier
  aggregator can be replaced.
- Serviceability, shipment creation, AWB, pickup, label, manifest, tracking, NDR,
  RTO, COD reconciliation. Pincode serviceability cached 24h
  (`PincodeServiceability`).
- Env: `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_TOKEN`.

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
