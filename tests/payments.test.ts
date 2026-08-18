import { describe, it, expect } from 'vitest';
import {
  computePaymentSignature, verifyPaymentSignature,
  computeWebhookSignature, verifyWebhookSignature,
} from '@/lib/payments/razorpay-verify';

const SECRET = 'test_secret_key';

describe('Razorpay payment signature (browser callback)', () => {
  it('verifies a correctly computed signature', () => {
    const orderId = 'order_ABC';
    const paymentId = 'pay_XYZ';
    const sig = computePaymentSignature(orderId, paymentId, SECRET);
    expect(verifyPaymentSignature(orderId, paymentId, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered signature (payment id swapped)', () => {
    const sig = computePaymentSignature('order_ABC', 'pay_XYZ', SECRET);
    expect(verifyPaymentSignature('order_ABC', 'pay_EVIL', sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const sig = computePaymentSignature('order_ABC', 'pay_XYZ', 'other_secret');
    expect(verifyPaymentSignature('order_ABC', 'pay_XYZ', sig, SECRET)).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(verifyPaymentSignature('', 'pay', 'sig', SECRET)).toBe(false);
    expect(verifyPaymentSignature('order', 'pay', '', SECRET)).toBe(false);
  });
});

describe('Razorpay webhook signature', () => {
  it('verifies the raw body HMAC', () => {
    const body = JSON.stringify({ event: 'payment.captured', foo: 'bar' });
    const sig = computeWebhookSignature(body, SECRET);
    expect(verifyWebhookSignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects a modified body', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const sig = computeWebhookSignature(body, SECRET);
    expect(verifyWebhookSignature(body + 'x', sig, SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyWebhookSignature('{}', '', SECRET)).toBe(false);
  });
});
