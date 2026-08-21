import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getCapiCredentials } from '@/lib/marketing/config';
import type { EcommercePayload } from '@/lib/marketing/events';

/**
 * Conversion reporting for a completed order.
 *
 * A purchase must reach the ad platforms **exactly once**. A shopper refreshing
 * the confirmation page, opening it on a second device, or following the link in
 * their email must not each add a conversion — inflated conversion counts feed
 * straight into the client's ROAS and cost-per-acquisition figures, and they
 * make a campaign look profitable when it is not.
 *
 * The claim is a single conditional UPDATE, which Postgres executes atomically,
 * so two concurrent page loads cannot both win. It is the same idempotency shape
 * as the `WebhookEvent` handling elsewhere in this codebase.
 */

export type PurchasePayload = EcommercePayload & { transaction_id: string };

/**
 * Try to become the one render that reports this order.
 *
 * Returns the payload on success and `null` if the order was already reported,
 * is not payable yet, or does not exist.
 *
 * The claim is taken *before* the event is emitted, so the failure mode is an
 * under-count rather than a double-count: if the page then dies mid-render the
 * conversion is lost, which is the cheaper mistake by a wide margin.
 */
export async function claimPurchaseTracking(orderId: string): Promise<PurchasePayload | null> {
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      purchaseTrackedAt: null,
      // Nothing is reported until money has actually moved. An order sitting in
      // PENDING_PAYMENT may never be paid, and reporting it would count a
      // conversion the client never earned.
      status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] },
    },
    data: { purchaseTrackedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      grandTotal: true,
      currency: true,
      items: {
        select: {
          skuSnapshot: true,
          nameSnapshot: true,
          quantity: true,
          lineTotal: true,
          metalSnapshot: true,
        },
      },
    },
  });
  if (!order) return null;

  return {
    transaction_id: order.orderNumber,
    currency: order.currency,
    value: Number(order.grandTotal),
    items: order.items.map((item) => ({
      item_id: item.skuSnapshot,
      item_name: item.nameSnapshot,
      quantity: item.quantity,
      price: Number(item.lineTotal) / Math.max(item.quantity, 1),
      ...(item.metalSnapshot ? { item_category: item.metalSnapshot } : {}),
    })),
  };
}

/** Meta requires identifiers to be SHA-256 of the lowercased, trimmed value. */
function hashed(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalised = value.trim().toLowerCase();
  if (normalised === '') return undefined;
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Send the purchase to Meta's Conversions API from the server.
 *
 * Server-side only, and the access token never leaves this process: it is read
 * straight from the database here and used to call Meta directly. It is never
 * included in any payload rendered to the browser.
 *
 * `event_id` is the order number — the same value the browser Pixel sends — so
 * Meta deduplicates the pair into one conversion instead of counting both.
 *
 * Failures are logged and swallowed: an analytics outage must never surface on a
 * customer's order confirmation.
 */
export async function sendMetaCapiPurchase(
  payload: PurchasePayload,
  customer: { email?: string | null; phone?: string | null },
  sourceUrl: string
): Promise<void> {
  const creds = await getCapiCredentials();
  if (!creds) return;

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${creds.pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: creds.token,
        data: [
          {
            event_name: 'Purchase',
            event_time: Math.floor(Date.now() / 1000),
            event_id: payload.transaction_id,
            event_source_url: sourceUrl,
            action_source: 'website',
            user_data: {
              em: hashed(customer.email) ? [hashed(customer.email)] : undefined,
              ph: hashed(customer.phone) ? [hashed(customer.phone)] : undefined,
            },
            custom_data: {
              currency: payload.currency,
              value: payload.value,
              order_id: payload.transaction_id,
              contents: payload.items.map((i) => ({
                id: i.item_id,
                quantity: i.quantity,
                item_price: i.price,
              })),
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      // Deliberately does not log the response body: Meta echoes request context
      // on error, and the token is in the request.
      console.error('[marketing] Meta CAPI purchase rejected', { status: res.status });
    }
  } catch (e) {
    console.error('[marketing] Meta CAPI purchase failed', e instanceof Error ? e.message : e);
  }
}
