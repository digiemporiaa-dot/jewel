import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentCustomer } from '@/lib/customer-session';
import { profileGaps } from '@/lib/validations/signup';
import { privateMetadata } from '@/lib/seo/metadata';
import CompleteProfilePanel from './CompleteProfilePanel';

export const dynamic = 'force-dynamic';

// Never indexed: it is a form behind an OTP, there is nothing here for a
// crawler, and a sign-up page in search results competes with the pages that
// should be there.
export const metadata: Metadata = privateMetadata('Complete your details');

/**
 * No longer a way *in*.
 *
 * Signing in and signing up are one screen now, on `/my-account`. A visitor who
 * arrives here without a session — from a bookmark, a stale link, or by typing
 * it — is sent there rather than shown a second front door, because two doors
 * are how a returning customer ends up with a second account.
 *
 * What survives is the case the route is genuinely still for: somebody already
 * signed in whose profile has gaps, following the prompt on their account page.
 * They have a verified session already; there is nothing to sign into.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ returning?: string }>;
}) {
  const [customer, sp] = await Promise.all([getCurrentCustomer(), searchParams]);

  if (!customer) redirect('/my-account');
  if (profileGaps(customer).length === 0) redirect('/my-account');

  return (
    <div className="shell py-12 max-w-md mx-auto">
      <CompleteProfilePanel
        // Set by the auth panel when somebody pressed "Create account" on an
        // address that already had one. Only ever reached after a code has been
        // entered, so it tells the inbox holder something useful rather than
        // telling a stranger whether this address shops here.
        returning={sp.returning === '1'}
        email={customer.email}
        initial={{
          name: customer.name ?? '',
          phone: customer.phone ?? '',
          dob: toDateInput(customer.dob),
          gender: customer.gender ?? '',
          anniversary: toDateInput(customer.anniversary),
          marketingOptIn: customer.marketingOptIn,
        }}
      />
    </div>
  );
}

/**
 * Dates are stored at UTC midnight (see lib/validations/signup.ts), so they are
 * read back the same way. Using the local getters here would show a customer
 * born on the 14th a form saying the 13th.
 */
function toDateInput(value: Date | null): string {
  if (!value) return '';
  return value.toISOString().slice(0, 10);
}
