import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * When the bag survives checkout, and when it goes with the order.
 *
 * Pure, and kept apart from the code that does the deleting, because this is
 * the rule that was wrong: the bag used to be emptied the moment the order row
 * existed, which is *before* the shopper has paid for anything. A dismissed
 * payment window, a failed card or a dropped connection then returned them to
 * an empty bag — and a ₹70,000 basket does not get rebuilt from memory. Every
 * screen and job that has to answer "is this order real yet?" answers it from
 * here, so they cannot drift apart.
 */

/**
 * Is a gateway payment about to be attempted for this order?
 *
 * The two cases are Razorpay and a COD token: both hand the shopper to a
 * payment window they can dismiss, so both must leave the bag alone. A bank
 * transfer is not one of them — the money arrives off-site, nothing opens, and
 * the order is placed the moment the customer is shown the account details.
 * Plain COD is not one either; it is confirmed outright.
 */
export function awaitsGatewayPayment(params: { paymentMethod: PaymentMethod; codTokenRequired: boolean }): boolean {
  return (
    params.paymentMethod === PaymentMethod.RAZORPAY ||
    (params.paymentMethod === PaymentMethod.COD && params.codTokenRequired)
  );
}

/**
 * Has this order become real, so that the bag it came from should be gone?
 *
 * Paid answers it outright — including a made-to-order advance, which leaves a
 * balance owed on an order that is already being made. A COD order is confirmed
 * with nothing paid at all, so the status carries the answer there. An order
 * still waiting for its gateway keeps its bag, which is the entire point; a
 * cancelled one never became real.
 */
export function orderIsPlaced(order: { status: OrderStatus; paymentStatus: PaymentStatus }): boolean {
  if (order.paymentStatus === PaymentStatus.CAPTURED || order.paymentStatus === PaymentStatus.AUTHORIZED) {
    return true;
  }
  return order.status !== OrderStatus.PENDING_PAYMENT && order.status !== OrderStatus.CANCELLED;
}

/**
 * Can the shopper still finish paying this order themselves?
 *
 * What makes this worth asking: the answer is a button that reopens the gateway
 * for *this* order. Without it the only way back to an unpaid order is to
 * rebuild the bag and check out again, which is one basket becoming two orders
 * and two stock reservations. A bank transfer is settled off-site and has no
 * window to reopen, and anything already part-paid is the shop's to reconcile,
 * not the shopper's to pay again.
 */
export function canCompletePayment(order: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  amountPaid: number;
}): boolean {
  return (
    order.status === OrderStatus.PENDING_PAYMENT &&
    order.paymentMethod !== PaymentMethod.BANK_TRANSFER &&
    order.amountPaid === 0
  );
}
