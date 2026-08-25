import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/customer-session';
import AccountLogin from './AccountLogin';
import { logoutAction } from './actions';
import { privateMetadata } from '@/lib/seo/metadata';
import { profileGaps } from '@/lib/validations/signup';
import ProfilePrompt from '@/components/storefront/ProfilePrompt';
import { liveOffersFor } from '@/lib/spin/offers';
import { formatDate } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = privateMetadata('My Account');

export default async function AccountPage() {
  const customer = await getCurrentCustomer();

  if (!customer) {
    return (
      <div className="shell py-16">
        <AccountLogin />
      </div>
    );
  }

  const gaps = profileGaps(customer);
  const offers = await liveOffersFor(customer.id);

  return (
    <div className="shell py-10 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">My Account</p>
          <h1 className="mt-2 text-3xl">{customer.name ?? 'Welcome'}</h1>
          <p className="text-ink-soft text-sm">{customer.phone}{customer.email ? ` · ${customer.email}` : ''}</p>
        </div>
        <form action={logoutAction}>
          <button className="btn-outline text-xs">Sign out</button>
        </form>
      </div>

      {/* A won code, somewhere it cannot be lost.
          The wheel shows it once in a modal, which is a poor place to keep the
          only copy of something worth money. */}
      {offers.length > 0 && (
        <div className="mt-6 border border-brass bg-brass/5 p-4">
          <p className="font-heading text-base">{offers.length === 1 ? 'Your offer' : 'Your offers'}</p>
          <ul className="mt-3 space-y-3">
            {offers.map((offer) => (
              <li key={offer.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <code className="border border-brass bg-paper px-2.5 py-1 font-heading text-lg tracking-[0.12em]">
                  {offer.code}
                </code>
                <span className="text-sm text-ink-soft">
                  {offer.terms}
                  {offer.expiresAt && ` Expires ${formatDate(offer.expiresAt)}.`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-soft">Enter the code at checkout.</p>
        </div>
      )}

      {/* Only when something is actually missing, and closable. Most of these
          records were created implicitly by an OTP at checkout, and a banner
          that cannot be dismissed is a nag for information nobody needs to
          place an order. */}
      <ProfilePrompt gaps={gaps} />

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <Card href="/my-account/orders" title="Orders" desc="Track and view your orders" />
        <Card href="/my-account/addresses" title="Addresses" desc="Where your orders are delivered" />
        <Card href="/wishlist" title="Wishlist" desc="Your saved pieces" />
        <Card href="/appointments" title="Appointments" desc="Book a showroom visit" />
        <Card href="/c/new-arrivals" title="Continue shopping" desc="Explore new arrivals" />
      </div>
    </div>
  );
}

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="border border-line bg-white p-5 hover:border-brass transition-colors">
      <p className="font-heading text-lg">{title}</p>
      <p className="text-sm text-ink-soft mt-1">{desc}</p>
    </Link>
  );
}
