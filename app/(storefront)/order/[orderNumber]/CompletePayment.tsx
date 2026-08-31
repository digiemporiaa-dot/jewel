'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resumePaymentAction, confirmCheckoutPayment } from '../../checkout/actions';
import { loadRazorpay, type RazorpayHandlerResponse } from '@/lib/payments/browser';

/**
 * Finish paying an order that was left in PENDING_PAYMENT.
 *
 * Reopens the gateway for **this** order. It deliberately does not go back to
 * the bag and check out again: that is what shoppers were forced to do when the
 * bag was emptied at order creation, and it produced two orders and two stock
 * reservations for one basket. The server hands back the payment that already
 * exists on this order, so however many times the window is dismissed and
 * reopened there is still exactly one order.
 */
export default function CompletePayment({ orderId, brandName }: { orderId: string; brandName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pay() {
    setError(null);
    start(async () => {
      const res = await resumePaymentAction(orderId);
      if (!res.ok) { setError(res.error); return; }

      if (res.razorpay.dev) {
        // Simulated gateway (no live keys), same as checkout.
        const payId = `pay_dev_${Math.random().toString(36).slice(2, 12)}`;
        const confirm = await confirmCheckoutPayment({ orderId: res.orderId, razorpayPaymentId: payId, razorpayOrderId: res.razorpay.orderId, signature: 'dev_signature' });
        if (confirm.ok) router.refresh();
        else setError(confirm.error ?? 'Payment failed');
        return;
      }

      await loadRazorpay();
      if (!window.Razorpay || !res.razorpay.keyId) { setError('Payment unavailable — please try again'); return; }
      const rzp = new window.Razorpay({
        key: res.razorpay.keyId,
        amount: res.razorpay.amount,
        currency: 'INR',
        name: brandName,
        order_id: res.razorpay.orderId,
        prefill: { name: res.prefill.name, email: res.prefill.email, contact: res.prefill.phone },
        method: { emi: true, cardless_emi: true },
        handler: async (r: RazorpayHandlerResponse) => {
          const confirm = await confirmCheckoutPayment({ orderId: res.orderId, razorpayPaymentId: r.razorpay_payment_id, razorpayOrderId: r.razorpay_order_id, signature: r.razorpay_signature });
          // Straight back to this page: the status, the timeline and the amount
          // paid all change, and the customer is already looking at them.
          if (confirm.ok) router.refresh();
          else setError(confirm.error ?? 'Payment could not be verified');
        },
      });
      // Dismissing the window is not a failure any more. The order stays
      // PENDING_PAYMENT, the bag is untouched, and this button is still here.
      rzp.open();
    });
  }

  return (
    <div className="mt-6 border border-line-strong bg-paper-2 p-5 text-center">
      <p className="font-medium">Your payment was not completed</p>
      <p className="mt-1 text-sm text-ink-soft">
        Your items are still reserved and your bag is untouched. Pick up where you left off — this
        finishes the order below rather than creating a new one.
      </p>
      <button onClick={pay} disabled={pending} className="btn-primary mt-4 inline-flex text-sm">
        {pending ? 'Opening payment…' : 'Complete payment'}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
