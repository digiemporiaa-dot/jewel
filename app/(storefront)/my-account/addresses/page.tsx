import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/customer-session';
import { listAddresses } from '@/lib/addresses';
import { privateMetadata } from '@/lib/seo/metadata';
import AccountLogin from '../AccountLogin';
import AddressBook from './AddressBook';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = privateMetadata('Saved addresses');

export default async function AddressesPage() {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return <div className="shell py-16"><AccountLogin /></div>;
  }

  const addresses = await listAddresses(customer.id);

  return (
    <div className="shell py-10 max-w-2xl mx-auto">
      <Link href="/my-account" className="text-sm underline decoration-line-strong underline-offset-4 hover:text-brass">
        ← My account
      </Link>
      <h1 className="mt-4 text-3xl">Saved addresses</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Your default address is filled in at checkout, so you only type it once.
      </p>

      <div className="mt-8">
        <AddressBook addresses={addresses} />
      </div>
    </div>
  );
}
