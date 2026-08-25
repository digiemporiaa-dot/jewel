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
import { getCart } from '@/lib/cart';
import { evaluateCoupon, applyDiscountToTotals } from '@/lib/coupons/apply';
import { createRazorpayOrder, verifyRazorpayPayment, publicKeyId } from '@/lib/payments/razorpay';
import { sendOrderConfirmation, sendPaymentConfirmation } from '@/lib/email/notifications';
import { rememberAddress } from '@/lib/addresses';

// ── OTP ──────────────────────────────────────────────────────────────────────

export async function sendCheckoutOtp(phone: string): Promise<{ ok: boolean; error?: string; devCode?: string }> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid phone' };

  // Rate limit per IP and per destination — OTP is the most abusable surface.
  const ip = await getClientIp();
  for (const key of [`otp:send:ip:${ip}`, `otp:send:phone:${parsed.data}`]) {
    const rl = await checkLimit(key, LIMITS.otpSend);
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
  const rl = await checkLimit(`otp:verify:${ip}:${parsed.data}`, LIMITS.otpVerify);
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
      couponCode: d.couponCode || null,
    });

    // Persist the contact and the address on the customer for reuse
    // (best-effort — neither may fail a checkout). The comment here promised the
    // address too and only ever saved the name and email, which is why a
    // returning customer retyped their address on every order.
    prisma.customer.update({ where: { id: customerId }, data: { name: d.contactName, email: d.contactEmail || undefined } }).catch(() => {});
    void rememberAddress(customerId, {
      name: d.contactName,
      phone: d.contactPhone,
      line1: d.shippingAddress.line1,
      line2: d.shippingAddress.line2 ?? null,
      city: d.shippingAddress.city,
      state: d.shippingAddress.state,
      pincode: d.shippingAddress.pincode,
    });

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
  // Ownership first, and it fails closed.
  //
  // This used to read `if (customerId && order.customerId && ...)`, which let
  // the check pass whenever either side was null. That mattered because a failed
  // signature below calls `markPaymentFailed`, which releases the order's
  // reserved stock — so anyone holding an order id could send a junk signature
  // and kill a stranger's in-flight order. Every order created through checkout
  // has a `customerId` (see `placeOrder`), so demanding a match costs nothing.
  const customerId = await getCustomerId();
  if (!customerId) return { ok: false, error: 'Unauthorized' };

  const order = await prisma.order.findUnique({ where: { id: params.orderId }, select: { customerId: true, orderNumber: true } });
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.customerId !== customerId) return { ok: false, error: 'Unauthorized' };

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

/**
 * The shopper closed the payment window.
 *
 * Exported server actions are reachable endpoints whether or not anything calls
 * them, and this one releases reserved stock and fails the order. Unguarded, it
 * was a way for anyone with an order id to cancel a stranger's checkout — so it
 * proves ownership like every other order action, and says nothing about
 * orders that are not the caller's.
 */
export async function abandonPayment(orderId: string): Promise<void> {
  const customerId = await getCustomerId();
  if (!customerId) return;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
  if (!order || order.customerId !== customerId) return;

  await markPaymentFailed(orderId, 'abandoned by customer');
}


export type CouponPreview =
  | {
      ok: true; code: string; discount: string; freeShipping: boolean; appliesTo: string;
      // The recomputed taxable value, GST and shipping travel with the total.
      // Showing a pre-discount GST row beside a discounted total is the same
      // class of mistake as a button that disagrees with the Total: rows that
      // do not add up.
      taxableTotal: string; gstTotal: string; shipping: string; grandTotal: string;
    }
  | { ok: false; error: string };

/**
 * Check a code against the current bag and show what it would take off.
 *
 * Purely a preview: nothing is reserved and no usage is claimed. The
 * authoritative check runs again at order creation, because a cart can sit open
 * for hours and another shopper may take the last use in between.
 */
export async function previewCouponAction(code: string): Promise<CouponPreview> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) return { ok: false, error: 'Your bag session expired' };

  // Coupon codes are guessable, so an unlimited preview endpoint is a way to
  // enumerate them.
  const rl = await checkLimit(`coupon:${await getClientIp()}`, LIMITS.publicAction);
  if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please wait a moment.' };

  const [cart, customerId] = await Promise.all([getCart(sessionToken), getCustomerId()]);
  if (cart.lines.length === 0) return { ok: false, error: 'Your bag is empty' };

  const result = await evaluateCoupon({ code, cart, customerId });
  if (!result.ok) return { ok: false, error: result.error };

  const totals = applyDiscountToTotals(cart, result.calculation);
  return {
    ok: true,
    code: result.code,
    discount: totals.discountTotal,
    freeShipping: result.calculation.freeShipping,
    appliesTo: result.calculation.appliesTo,
    taxableTotal: totals.taxableTotal,
    gstTotal: totals.gstTotal,
    shipping: totals.shipping,
    grandTotal: totals.grandTotal,
  };
}
