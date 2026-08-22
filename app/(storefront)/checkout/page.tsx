import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { getCurrentCustomer } from '@/lib/customer-session';
import CheckoutClient from './CheckoutClient';
import { privateMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = privateMetadata('Checkout');

export default async function CheckoutPage() {
  const token = await getSessionToken();
  const [cart, store, customer] = await Promise.all([getCart(token), getStoreSettings(), getCurrentCustomer()]);

  if (cart.lines.length === 0) redirect('/cart');

  const grand = new Decimal(cart.grandTotal);
  const codAllowed = store.codMaxOrderValue != null && grand.lte(new Decimal(store.codMaxOrderValue.toString()));
  const panRequired = store.panThreshold != null && grand.gt(new Decimal(store.panThreshold.toString()));

  return (
    <div className="shell py-8 sm:py-12">
      <h1 className="text-3xl mb-6">Checkout</h1>
      <CheckoutClient
        summary={{
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
        }}
        lines={cart.lines.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          variantLabel: l.variantLabel,
          image: l.image,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
        }))}
        analyticsItems={cart.lines.map((l) => ({
          item_id: l.variantId ?? l.productId,
          item_name: l.name,
          price: Number(l.unitPrice),
          quantity: l.quantity,
          ...(l.variantLabel ? { item_variant: l.variantLabel } : {}),
        }))}
        verifiedPhone={customer?.phoneVerified ? customer.phone : null}
        panRequired={panRequired}
        codAllowed={codAllowed}
        brandName={store.brandName}
      />
    </div>
  );
}
