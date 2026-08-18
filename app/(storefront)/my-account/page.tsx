import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/customer-session';
import AccountLogin from './AccountLogin';
import { logoutAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Account',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const customer = await getCurrentCustomer();

  if (!customer) {
    return (
      <div className="shell py-16">
        <AccountLogin />
      </div>
    );
  }

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

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        <Card href="/my-account/orders" title="Orders" desc="Track and view your orders" />
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
