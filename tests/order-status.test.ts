import { describe, it, expect } from 'vitest';
import { OrderStatus } from '@prisma/client';
import { canTransition, ALLOWED_TRANSITIONS } from '@/lib/order-status';
import { signValue, verifyValue } from '@/lib/sign';

describe('order status state machine', () => {
  it('allows valid forward transitions', () => {
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.IN_MAKING)).toBe(true);
    expect(canTransition(OrderStatus.READY_TO_SHIP, OrderStatus.SHIPPED)).toBe(true);
    expect(canTransition(OrderStatus.VERIFICATION_HOLD, OrderStatus.CONFIRMED)).toBe(true);
  });

  it('rejects invalid transitions (no skipping / no backwards)', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.SHIPPED)).toBe(false);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.CONFIRMED)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(false);
  });

  it('terminal states have no forward edges (except refund paths)', () => {
    expect(ALLOWED_TRANSITIONS.REFUNDED).toEqual([]);
    expect(canTransition(OrderStatus.DELIVERED, OrderStatus.REFUND_PENDING)).toBe(true);
  });
});

describe('signed customer session value', () => {
  const secret = 'session-secret';
  it('round-trips a value', () => {
    const signed = signValue(JSON.stringify({ id: 'cust_1' }), secret);
    expect(verifyValue(signed, secret)).toBe(JSON.stringify({ id: 'cust_1' }));
  });

  it('rejects a tampered payload', () => {
    const signed = signValue('cust_1', secret);
    const [, mac] = signed.split('.');
    const forged = `${Buffer.from('cust_2').toString('base64url')}.${mac}`;
    expect(verifyValue(forged, secret)).toBeNull();
  });

  it('rejects a value signed with a different secret', () => {
    const signed = signValue('cust_1', 'other');
    expect(verifyValue(signed, secret)).toBeNull();
  });
});
