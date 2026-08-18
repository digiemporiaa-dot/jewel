import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure Razorpay signature helpers (no I/O) so they can be unit-tested and reused
 * by the webhook route. Never trust the browser: payment success is only accepted
 * after the signature verifies server-side (brief §18, RULE 6).
 */

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Signature Razorpay returns to the browser after checkout: HMAC(order_id|payment_id). */
export function computePaymentSignature(orderId: string, paymentId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  if (!orderId || !paymentId || !signature || !secret) return false;
  return safeEqualHex(computePaymentSignature(orderId, paymentId, secret), signature);
}

/** Webhook signature: HMAC of the raw request body with the webhook secret. */
export function computeWebhookSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  return safeEqualHex(computeWebhookSignature(rawBody, secret), signature);
}
