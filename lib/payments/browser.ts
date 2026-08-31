/**
 * Razorpay's browser checkout script.
 *
 * Client-side only, and deliberately not under `server-only`: both the checkout
 * form and the "complete payment" button on an unpaid order open the same
 * widget, and a second copy of this loader is a second chance for the two to
 * drift apart.
 */

declare global {
  interface Window {
    Razorpay?: new (opts: unknown) => { open: () => void };
  }
}

export type RazorpayHandlerResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

/** Inject the checkout script once, resolving either way so the caller can decide. */
export async function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return;
  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    // Resolves rather than rejects: the caller checks `window.Razorpay` and
    // shows a payment error, which is a better failure than an unhandled
    // rejection on a page the customer is trying to pay from.
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}
