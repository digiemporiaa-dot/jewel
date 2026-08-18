import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { formatCurrency } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

// Placeholder ahead of Phase 4 (payments/OTP/rate-lock). Shows the server-computed
// order total so the flow is coherent; the full checkout is built next.
export default async function CheckoutPage() {
  const cart = await getCart(await getSessionToken());

  return (
    <div className="shell py-16 max-w-lg mx-auto text-center">
      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 text-3xl">Secure checkout is on the way</h1>
      {cart.lines.length > 0 ? (
        <>
          <p className="mt-3 text-ink-soft">
            Your bag total is <strong className="text-ink">{formatCurrency(cart.grandTotal)}</strong> ({cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}).
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            OTP login, address, rate-lock, Razorpay, COD and invoicing arrive in the next phase.
          </p>
          <Link href="/cart" className="btn-outline mt-8 inline-flex">Back to bag</Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">Your bag is empty.</p>
          <Link href="/c/new-arrivals" className="btn-primary mt-8 inline-flex">Shop New Arrivals</Link>
        </>
      )}
    </div>
  );
}
