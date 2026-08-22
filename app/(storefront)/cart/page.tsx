import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import CartItemRow from './CartItemRow';
import EmiNote from '@/components/storefront/EmiNote';
import OrderSummary from '@/components/storefront/OrderSummary';
import { resolvePayable } from '@/lib/checkout/totals';
import { emiFor } from '@/lib/emi-settings';
import { privateMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = privateMetadata('Your Bag');

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

        {/* Summary — the same component checkout uses, so the two agree. A
            shopper who sees one breakdown here and another at checkout has been
            given a reason to abandon. */}
        <OrderSummary
          className="lg:sticky lg:top-6 self-start h-fit"
          lines={cart.lines.map((l) => ({
            itemId: l.itemId,
            name: l.name,
            variantLabel: l.variantLabel,
            image: l.image,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
          }))}
          totals={resolvePayable(
            {
              itemCount: cart.itemCount,
              metalTotal: cart.metalTotal,
              makingTotal: cart.makingTotal,
              stoneTotal: cart.stoneTotal,
              itemPriceTotal: cart.itemPriceTotal,
              productDiscountTotal: cart.productDiscountTotal,
              taxableTotal: cart.taxableTotal,
              gstTotal: cart.gstTotal,
              itemsTotal: cart.itemsTotal,
              shipping: cart.shipping,
              grandTotal: cart.grandTotal,
            },
            // No coupon in the bag — codes are entered at checkout, and showing
            // a discount here that checkout might refuse would be worse than
            // showing none.
            null
          )}
          itemsTotal={cart.itemsTotal}
          note={
            freeAbove && !cart.freeShippingEligible ? (
              <p className="mt-3 border border-line-strong bg-paper-2 px-3 py-2 text-xs text-ink-soft">
                Add {formatCurrency(freeAbove)}+ worth to unlock free shipping.
              </p>
            ) : null
          }
        >
          <EmiNote best={emi.best} options={emi.options} className="mt-3" />
          <p className="mt-2 text-xs text-ink-soft">Prices calculated on today&rsquo;s live metal rate.</p>
          <Link href="/checkout" className="btn-primary w-full mt-5">Proceed to Checkout</Link>
          <p className="mt-3 text-center text-xs text-ink-soft">Secure checkout · Easy returns per store policy</p>
        </OrderSummary>
      </div>
    </div>
  );
}
