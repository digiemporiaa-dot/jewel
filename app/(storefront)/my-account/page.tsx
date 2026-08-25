import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/customer-session';
import AccountLogin from './AccountLogin';
import { logoutAction } from './actions';
import { privateMetadata } from '@/lib/seo/metadata';
import { profileGaps, GAP_LABELS } from '@/lib/validations/signup';

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

      {/* Only when something is actually missing. A permanent "complete your
          profile" banner that never goes away trains people to ignore it, and
          most of these records were created implicitly at checkout with nothing
          but a phone number. */}
      {gaps.length > 0 && (
        <div className="mt-6 border border-brass/40 bg-brass/5 p-4">
          <p className="font-heading text-base">Finish setting up your account</p>
          <p className="mt-1 text-sm text-ink-soft">
            We still need {listGaps(gaps.map((g) => GAP_LABELS[g]))}. Your date of birth is
            what lets us send you a birthday offer.
          </p>
          <Link href="/signup" className="btn-outline text-xs mt-3 inline-flex">Complete my details</Link>
        </div>
      )}

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

/** "your name and your email address", not "your name, your email address". */
function listGaps(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function Card({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="border border-line bg-white p-5 hover:border-brass transition-colors">
      <p className="font-heading text-lg">{title}</p>
      <p className="text-sm text-ink-soft mt-1">{desc}</p>
    </Link>
  );
}
