'use client';

import { useState } from 'react';
import Link from 'next/link';
import ProfileDetailsForm, { type ProfileInitial } from '@/components/auth/ProfileDetailsForm';

/**
 * Filling the gaps in an existing profile.
 *
 * The signed-in half of what `/signup` used to be. The other half — proving an
 * address — moved into the one auth panel on `/my-account`, so there is nothing
 * to verify here: this customer already has a session.
 */
export default function CompleteProfilePanel({
  email, initial, returning = false,
}: {
  email: string | null;
  initial: ProfileInitial;
  /** They pressed "Create account" and already had one. */
  returning?: boolean;
}) {
  const [done, setDone] = useState<{ notice: string | null } | null>(null);

  if (done) {
    return (
      <div className="border border-line bg-white p-6 text-center">
        <h1 className="font-heading text-2xl">You&apos;re all set</h1>
        {done.notice ? (
          <p className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{done.notice}</p>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Your details are saved.</p>
        )}
        {/* A link rather than a refresh: refreshing re-runs the page, which now
            sees a complete profile and redirects — taking this panel, and the
            notice explaining a refused marketing consent, off screen before it
            can be read. */}
        <Link href="/my-account" className="btn-primary mt-6 inline-flex w-full justify-center min-h-[48px]">
          Go to my account
        </Link>
      </div>
    );
  }

  return (
    <div className="border border-line bg-white p-6">
      <h1 className="font-heading text-2xl">{returning ? 'Welcome back' : 'Complete your details'}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {returning
          ? 'Looks like you already have an account — we have signed you in rather than starting a second one. Just a few details missing.'
          : 'Your email address is already verified. A few more details and you are done.'}
      </p>
      <ProfileDetailsForm
        email={email}
        initial={initial}
        onDone={setDone}
        submitLabel="Save my details"
      />
    </div>
  );
}
