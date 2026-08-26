import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentCustomer } from '@/lib/customer-session';
import { profileGaps } from '@/lib/validations/signup';
import { privateMetadata } from '@/lib/seo/metadata';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

// Never indexed: it is a form behind an OTP, there is nothing here for a
// crawler, and a sign-up page in search results competes with the pages that
// should be there.
export const metadata: Metadata = privateMetadata('Create your account');

export default async function SignupPage() {
  const customer = await getCurrentCustomer();

  // A signed-in customer with a complete profile has nothing to do here.
  // One with gaps stays and fills them in, with what is already known
  // pre-filled rather than retyped.
  if (customer && profileGaps(customer).length === 0) redirect('/my-account');

  return (
    <div className="shell py-12 max-w-md mx-auto">
      <SignupForm
        initial={
          customer
            ? {
                name: customer.name ?? '',
                phone: customer.phone ?? '',
                dob: toDateInput(customer.dob),
                gender: customer.gender ?? '',
                anniversary: toDateInput(customer.anniversary),
                marketingOptIn: customer.marketingOptIn,
              }
            : null
        }
        heading={customer ? 'Complete your details' : 'Create your account'}
        intro={
          customer
            ? 'Your email address is already verified. A few more details and you are done.'
            : 'One minute, and your orders, addresses and offers are all in one place.'
        }
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
