'use client';

import { useState, useTransition } from 'react';
import { createHomepageAction } from './actions';

/**
 * Offered until the shop has a homepage row of its own.
 *
 * The wording matters more than the button: staff need to know that `/` is
 * already live and already looks like this, and that clicking here changes
 * nothing a customer can see — it only hands them the controls.
 */
export default function HomepageSetup() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="border border-brass/40 bg-brass/5 p-4 mb-4">
      <p className="font-heading text-base">The homepage is not editable yet</p>
      <p className="mt-1 text-sm text-ink-soft max-w-2xl">
        Your storefront homepage is currently the built-in default layout. Set it
        up to turn it into editable blocks — the hero image, headline, buttons and
        every band below them. Nothing on the storefront changes when you do this:
        it starts as an exact copy of what is live now.
      </p>
      <button
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await createHomepageAction();
            if (res && !res.ok) setError(res.error ?? 'Could not set up the homepage');
          });
        }}
        className="btn-primary text-xs mt-3"
      >
        {pending ? 'Setting up…' : 'Set up homepage'}
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
