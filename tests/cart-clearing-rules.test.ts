import { describe, it, expect } from 'vitest';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { awaitsGatewayPayment, orderIsPlaced, canCompletePayment } from '@/lib/checkout/cart-clearing';

/**
 * The rule that decides when a bag is emptied.
 *
 * It used to be "as soon as the order row exists", which threw away the bag
 * while the order was still PENDING_PAYMENT — so a dismissed payment window
 * cost the shop the whole basket. These are the cases that rule has to get
 * right, stated once, where the checkout, the webhook, the confirmation page,
 * the account's order list and the abandoned-cart job all read them from.
 */

describe('does creating this order hand the shopper to a payment window?', () => {
  it('says yes for an online card / UPI order — so its bag survives checkout', () => {
    expect(awaitsGatewayPayment({ paymentMethod: PaymentMethod.RAZORPAY, codTokenRequired: false })).toBe(true);
  });

  it('says yes for cash on delivery when a token is collected first', () => {
    expect(awaitsGatewayPayment({ paymentMethod: PaymentMethod.COD, codTokenRequired: true })).toBe(true);
  });

  it('says no for plain cash on delivery — that order is confirmed outright', () => {
    expect(awaitsGatewayPayment({ paymentMethod: PaymentMethod.COD, codTokenRequired: false })).toBe(false);
  });

  it('says no for a bank transfer: the money arrives off-site and nothing opens', () => {
    expect(awaitsGatewayPayment({ paymentMethod: PaymentMethod.BANK_TRANSFER, codTokenRequired: true })).toBe(false);
  });
});

describe('is this order real yet?', () => {
  it('is not, while it waits for a payment that has not happened', () => {
    expect(orderIsPlaced({ status: OrderStatus.PENDING_PAYMENT, paymentStatus: PaymentStatus.PENDING })).toBe(false);
  });

  it('is not, when the payment failed — the shopper still has a bag to retry from', () => {
    expect(orderIsPlaced({ status: OrderStatus.PENDING_PAYMENT, paymentStatus: PaymentStatus.FAILED })).toBe(false);
  });

  it('is, once the payment is captured', () => {
    expect(orderIsPlaced({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.CAPTURED })).toBe(true);
  });

  it('is, on a made-to-order advance that leaves a balance owing', () => {
    // AUTHORIZED, not CAPTURED: money has been taken and the piece is being
    // made. The balance is owed on an order, not on a bag to buy again.
    expect(orderIsPlaced({ status: OrderStatus.IN_MAKING, paymentStatus: PaymentStatus.AUTHORIZED })).toBe(true);
  });

  it('is, for a confirmed cash-on-delivery order with nothing paid', () => {
    expect(orderIsPlaced({ status: OrderStatus.CONFIRMED, paymentStatus: PaymentStatus.PENDING })).toBe(true);
  });

  it('is, for a high-value order held for a verification call', () => {
    expect(orderIsPlaced({ status: OrderStatus.VERIFICATION_HOLD, paymentStatus: PaymentStatus.PENDING })).toBe(true);
  });

  it('is not, for a cancelled order — it never became anything', () => {
    expect(orderIsPlaced({ status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.PENDING })).toBe(false);
  });
});

describe('can the shopper still finish paying?', () => {
  const unpaidOnline = { status: OrderStatus.PENDING_PAYMENT, paymentMethod: PaymentMethod.RAZORPAY, amountPaid: 0 };

  it('yes — an online order left unpaid is exactly what the button is for', () => {
    expect(canCompletePayment(unpaidOnline)).toBe(true);
  });

  it('no, once the order has moved on', () => {
    expect(canCompletePayment({ ...unpaidOnline, status: OrderStatus.CONFIRMED })).toBe(false);
    expect(canCompletePayment({ ...unpaidOnline, status: OrderStatus.CANCELLED })).toBe(false);
  });

  it('no for a bank transfer: there is no window to reopen', () => {
    expect(canCompletePayment({ ...unpaidOnline, paymentMethod: PaymentMethod.BANK_TRANSFER })).toBe(false);
  });

  it('no once anything has been paid — a part-paid order is the shop to reconcile', () => {
    expect(canCompletePayment({ ...unpaidOnline, amountPaid: 5000 })).toBe(false);
  });
});
