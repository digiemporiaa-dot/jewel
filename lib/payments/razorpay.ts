import 'server-only';
import { randomUUID } from 'node:crypto';
import { verifyPaymentSignature, verifyWebhookSignature } from '@/lib/payments/razorpay-verify';

/**
 * Razorpay API client. Orders are created SERVER-SIDE only, with the amount taken
 * from the server-computed order total — never from the browser (brief §18, RULE 1).
 * When keys are absent (local/dev), runs in a simulated mode so the full checkout
 * flow is testable without live credentials.
 */

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function isDevMode(): boolean {
  return !isRazorpayConfigured();
}

export type RazorpayOrder = { id: string; amount: number; currency: string; dev: boolean };

/** Create a Razorpay order. `amount` is in the major unit (₹); converted to paise. */
export async function createRazorpayOrder(params: {
  amount: string | number; // rupees
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const currency = params.currency ?? 'INR';
  const amountPaise = Math.round(Number(params.amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error('Invalid payment amount');
  }

  if (isDevMode()) {
    // Simulated order for local development / automated tests.
    return { id: `order_dev_${randomUUID().replace(/-/g, '').slice(0, 14)}`, amount: amountPaise, currency, dev: true };
  }

  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency, receipt: params.receipt, notes: params.notes ?? {} }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order creation failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: string; amount: number; currency: string };
  return { id: data.id, amount: data.amount, currency: data.currency, dev: false };
}

/** Verify the browser-returned payment signature against the secret. */
export function verifyRazorpayPayment(orderId: string, paymentId: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET ?? '';
  if (isDevMode()) {
    // In dev mode we accept the simulated confirmation token shape only.
    return paymentId.startsWith('pay_dev_') && signature === 'dev_signature';
  }
  return verifyPaymentSignature(orderId, paymentId, signature, secret);
}

export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  return verifyWebhookSignature(rawBody, signature, secret);
}

export function publicKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}
