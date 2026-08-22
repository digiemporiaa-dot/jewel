import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import CartItemRow from './CartItemRow';
import EmiNote from '@/components/storefront/EmiNote';
import { emiFor } from '@/lib/emi-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Bag',
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  const token = await getSessionToken();
  const [cart, store] = await Promise.all([getCart(token), getStoreSettings()]);
  const emi = await emiFor(cart.grandTotal);

  if (cart.lines.length === 0) {
    return (
      <div className="shell py-20 text-center">
        <p className="eyebrow">Your Bag</p>
        <h1 className="mt-3 text-3xl">Your bag is empty</h1>
        <p className="mt-2 text-ink-soft">Discover pieces crafted to be treasured.</p>
        <Link href="/c/new-arrivals" className="btn-primary mt-8 inline-flex">Shop New Arrivals</Link>
      </div>
    );
  }

  const freeAbove = store.freeShippingAbove ? store.freeShippingAbove.toString() : null;

  return (
    <div className="shell py-8 sm:py-12">
      <h1 className="text-3xl mb-6">Your Bag <span className="text-ink-soft text-lg">({cart.itemCount})</span></h1>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-10">
        {/* Lines */}
        <div>
          {cart.lines.map((line) => <CartItemRow key={line.itemId} line={line} />)}
          <Link href="/c/new-arrivals" className="inline-block mt-6 text-sm underline underline-offset-4 hover:text-brass">Continue shopping</Link>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-6 self-start border border-line bg-paper p-6 h-fit">
          <h2 className="font-heading text-xl">Order Summary</h2>

          {freeAbove && !cart.freeShippingEligible && (
            <p className="mt-3 text-xs text-ink-soft border border-line-strong bg-paper-2 px-3 py-2">
              Add {formatCurrency(freeAbove)}+ worth to unlock free shipping.
            </p>
          )}

          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Metal + wastage" value={formatCurrency(cart.metalTotal)} />
            {Number(cart.stoneTotal) > 0 && <Row label="Diamonds / stones" value={formatCurrency(cart.stoneTotal)} />}
            <Row label="Making charges" value={formatCurrency(cart.makingTotal)} />
            <Row label="GST" value={formatCurrency(cart.gstTotal)} />
            <Row label="Shipping" value={Number(cart.shipping) === 0 ? 'Free' : formatCurrency(cart.shipping)} />
            <div className="border-t border-line pt-3 flex justify-between font-medium text-base">
              <dt>Total</dt>
              <dd>{formatCurrency(cart.grandTotal)}</dd>
            </div>
          </dl>
          <EmiNote best={emi.best} options={emi.options} className="mt-3" />

          <p className="mt-2 text-xs text-ink-soft">Prices calculated on today’s live metal rate. Inclusive of GST.</p>

          <Link href="/checkout" className="btn-primary w-full mt-5">Proceed to Checkout</Link>
          <p className="mt-3 text-center text-xs text-ink-soft">Secure checkout · Easy returns per store policy</p>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-soft">
      <dt>{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
