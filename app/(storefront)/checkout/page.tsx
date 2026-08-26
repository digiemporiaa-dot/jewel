import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Decimal from 'decimal.js';
import { getSessionToken } from '@/lib/session';
import { getCart } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { getCurrentCustomer } from '@/lib/customer-session';
import { listAddresses } from '@/lib/addresses';
import CheckoutClient from './CheckoutClient';
import { privateMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = privateMetadata('Checkout');

export default async function CheckoutPage() {
  const token = await getSessionToken();
  const [cart, store, customer] = await Promise.all([getCart(token), getStoreSettings(), getCurrentCustomer()]);
  // Only a signed-in customer has an address book; a guest sees the blank form.
  const savedAddresses = customer ? await listAddresses(customer.id) : [];

  if (cart.lines.length === 0) redirect('/cart');

  const grand = new Decimal(cart.grandTotal);
  const codAllowed = store.codMaxOrderValue != null && grand.lte(new Decimal(store.codMaxOrderValue.toString()));
  const panRequired = store.panThreshold != null && grand.gt(new Decimal(store.panThreshold.toString()));

  return (
    <div className="shell py-8 sm:py-12">
      <h1 className="text-3xl mb-6">Checkout</h1>
      {/*
        `customerEmail` and `verifiedEmail` answer different questions, which is
        why both are here.

        `customerEmail` is the address on the record — what the field should be
        pre-filled with. It was never passed, so the field started blank for
        everybody; and once email became required, a signed-in customer could
        not place an order at all, because the empty string reached Razorpay's
        prefill and came back as "Enter a valid email".

        `verifiedEmail` is whether an OTP has actually proven it. Only that
        locks the field: an address sitting unverified on a record is a starting
        point, not a fact.
      */}
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
        savedAddresses={savedAddresses.map((a) => ({
          id: a.id, label: a.label, name: a.name, phone: a.phone,
          line1: a.line1, line2: a.line2, city: a.city, state: a.state,
          pincode: a.pincode, isDefault: a.isDefault,
        }))}
        customerName={customer?.name ?? null}
        customerEmail={customer?.email ?? null}
        verifiedEmail={customer?.emailVerified ? customer.email : null}
        panRequired={panRequired}
        codAllowed={codAllowed}
        brandName={store.brandName}
      />
    </div>
  );
}
