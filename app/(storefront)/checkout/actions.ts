'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getSessionToken } from '@/lib/session';
import { getCustomerId, setCustomerSession } from '@/lib/customer-session';
import { sendOtp, verifyOtp } from '@/lib/otp';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';
import { phoneSchema, placeOrderSchema } from '@/lib/validations/checkout';
import { createOrder, confirmPayment, markPaymentFailed, CheckoutError } from '@/lib/orders';
import { createRazorpayOrder, verifyRazorpayPayment, publicKeyId } from '@/lib/payments/razorpay';
import { sendOrderConfirmation, sendPaymentConfirmation } from '@/lib/email/notifications';

// ── OTP ──────────────────────────────────────────────────────────────────────

export async function sendCheckoutOtp(phone: string): Promise<{ ok: boolean; error?: string; devCode?: string }> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid phone' };

  // Rate limit per IP and per destination — OTP is the most abusable surface.
  const ip = await getClientIp();
  for (const key of [`otp:send:ip:${ip}`, `otp:send:phone:${parsed.data}`]) {
    const rl = checkLimit(key, LIMITS.otpSend);
    if (!rl.allowed) {
      return { ok: false, error: `Too many code requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` };
    }
  }

  const res = await sendOtp(parsed.data, 'CHECKOUT');
  return res.ok ? { ok: true, devCode: res.devCode } : { ok: false, error: res.error };
}

export async function verifyCheckoutOtp(phone: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, error: 'Invalid phone' };
  const codeParsed = z.string().trim().regex(/^\d{6}$/).safeParse(code);
  if (!codeParsed.success) return { ok: false, error: 'Enter the 6-digit code' };

  // Throttle verification attempts to blunt brute-force guessing.
  const ip = await getClientIp();
  const rl = checkLimit(`otp:verify:${ip}:${parsed.data}`, LIMITS.otpVerify);
  if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please request a new code shortly.' };

  const res = await verifyOtp(parsed.data, 'CHECKOUT', codeParsed.data);
  if (!res.ok) return { ok: false, error: res.error };

  // Create or link the customer, then start a session.
  const customer = await prisma.customer.upsert({
    where: { phone: parsed.data },
    create: { phone: parsed.data, phoneVerified: true },
    update: { phoneVerified: true },
  });
  await setCustomerSession(customer.id);
  return { ok: true };
}

// ── Place order ──────────────────────────────────────────────────────────────

type PlaceResult =
  | { stage: 'pay'; orderId: string; orderNumber: string; amountDue: string; razorpay: { orderId: string; amount: number; keyId: string | null; dev: boolean }; prefill: { name: string; email: string; phone: string } }
  | { stage: 'bank'; orderId: string; orderNumber: string; amountDue: string }
  | { stage: 'done'; orderId: string; orderNumber: string }
  | { stage: 'error'; error: string };

export async function placeOrder(input: unknown): Promise<PlaceResult> {
  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) return { stage: 'error', error: parsed.error.issues[0]?.message ?? 'Invalid details' };

  const sessionToken = await getSessionToken();
  if (!sessionToken) return { stage: 'error', error: 'Your bag session expired. Please re-add items.' };

  // Phone must be OTP-verified (a customer session was established).
  const customerId = await getCustomerId();
  if (!customerId) return { stage: 'error', error: 'Please verify your phone number first.' };

  const d = parsed.data;
  try {
    const result = await createOrder({
      sessionToken,
      customerId,
      contactName: d.contactName,
      contactPhone: d.contactPhone,
      contactEmail: d.contactEmail || undefined,
      pan: d.pan || undefined,
      shippingAddress: d.shippingAddress,
      paymentMethod: d.paymentMethod,
    });

    // Persist the contact/address on the customer for reuse (best-effort).
    prisma.customer.update({ where: { id: customerId }, data: { name: d.contactName, email: d.contactEmail || undefined } }).catch(() => {});

    if (result.paymentMethod === 'BANK_TRANSFER') {
      sendOrderConfirmation(result.orderId);
      return { stage: 'bank', orderId: result.orderId, orderNumber: result.orderNumber, amountDue: result.amountDue };
    }

    if (result.online) {
      // Create the gateway order for the amount due (advance / full / COD token).
      const rzp = await createRazorpayOrder({ amount: result.amountDue, receipt: result.orderNumber, notes: { orderId: result.orderId } });
      await prisma.payment.updateMany({ where: { orderId: result.orderId, status: 'PENDING' }, data: { providerOrderId: rzp.id } });
      return {
        stage: 'pay',
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        amountDue: result.amountDue,
        razorpay: { orderId: rzp.id, amount: rzp.amount, keyId: publicKeyId(), dev: rzp.dev },
        prefill: { name: d.contactName, email: d.contactEmail || '', phone: d.contactPhone },
      };
    }

    // Plain COD — confirmed at creation.
    sendOrderConfirmation(result.orderId);
    revalidatePath('/cart');
    return { stage: 'done', orderId: result.orderId, orderNumber: result.orderNumber };
  } catch (e) {
    return { stage: 'error', error: e instanceof CheckoutError ? e.message : 'Could not place your order. Please try again.' };
  }
}

// ── Confirm payment (browser callback) ───────────────────────────────────────

export async function confirmCheckoutPayment(params: {
  orderId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  signature: string;
}): Promise<{ ok: boolean; orderNumber?: string; error?: string }> {
  const customerId = await getCustomerId();
  const order = await prisma.order.findUnique({ where: { id: params.orderId }, select: { customerId: true, orderNumber: true } });
  if (!order) return { ok: false, error: 'Order not found' };
  if (customerId && order.customerId && order.customerId !== customerId) return { ok: false, error: 'Unauthorized' };

  // Verify the signature server-side before accepting the payment.
  if (!verifyRazorpayPayment(params.razorpayOrderId, params.razorpayPaymentId, params.signature)) {
    await markPaymentFailed(params.orderId, 'signature verification failed');
    return { ok: false, error: 'Payment could not be verified' };
  }

  try {
    await confirmPayment({ orderId: params.orderId, providerPaymentId: params.razorpayPaymentId, providerOrderId: params.razorpayOrderId, source: 'callback' });
    sendPaymentConfirmation(params.orderId);
    sendOrderConfirmation(params.orderId);
    return { ok: true, orderNumber: order.orderNumber };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Payment confirmation failed' };
  }
}

export async function abandonPayment(orderId: string): Promise<void> {
  await markPaymentFailed(orderId, 'abandoned by customer');
}
