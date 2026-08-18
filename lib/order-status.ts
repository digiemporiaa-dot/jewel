import { OrderStatus } from '@prisma/client';

/**
 * Pure order-status state machine (no I/O) so transitions are unit-testable and
 * enforced consistently. Orders may only move along allowed edges (brief §36).
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: [OrderStatus.CONFIRMED, OrderStatus.VERIFICATION_HOLD, OrderStatus.CANCELLED],
  PAYMENT_CONFIRMED: [OrderStatus.CONFIRMED, OrderStatus.VERIFICATION_HOLD, OrderStatus.CANCELLED],
  VERIFICATION_HOLD: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.IN_MAKING, OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  IN_MAKING: [OrderStatus.READY_TO_SHIP, OrderStatus.CANCELLED],
  READY_TO_SHIP: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, OrderStatus.RTO],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.RTO],
  DELIVERED: [OrderStatus.REFUND_PENDING],
  CANCELLED: [OrderStatus.REFUND_PENDING],
  REFUND_PENDING: [OrderStatus.REFUNDED],
  REFUNDED: [],
  RTO: [OrderStatus.REFUND_PENDING],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
