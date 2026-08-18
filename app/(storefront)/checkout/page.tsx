import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { getCurrentCustomer } from '@/lib/customer-session';
import CheckoutClient from './CheckoutClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

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
        summary={{ itemCount: cart.itemCount, makingTotal: cart.makingTotal, gstTotal: cart.gstTotal, shipping: cart.shipping, grandTotal: cart.grandTotal }}
        verifiedPhone={customer?.phoneVerified ? customer.phone : null}
        panRequired={panRequired}
        codAllowed={codAllowed}
        brandName={store.brandName}
      />
    </div>
  );
}
