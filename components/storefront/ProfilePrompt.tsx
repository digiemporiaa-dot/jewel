'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GAP_LABELS, type ProfileGap } from '@/lib/validations/signup';

/**
 * "Finish setting up your account", and a way to make it go away.
 *
 * Dismissible on purpose, and it never blocks anything. Most of these records
 * were created implicitly by an OTP at checkout — the customer never filled in a
 * form and never agreed to. A prompt they cannot close would be a nag on every
 * visit for information they have already declined to give once, and none of it
 * is needed to place an order.
 *
 * The dismissal lives in `sessionStorage`, not a cookie: hiding it for this visit
 * is the right scope. Somebody who comes back next week probably meant "not
 * now", not "never", and a stray `localStorage` entry would hide it for good on
 * a shared machine.
 */
export default function ProfilePrompt({ gaps }: { gaps: ProfileGap[] }) {
  const [dismissed, setDismissed] = useState(() => {
    // Read in the initialiser rather than an effect, so the prompt does not
    // flash for one paint before hiding itself.
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(KEY) === '1';
    } catch {
      // Private mode, or storage blocked. Showing the prompt is the safe
      // failure — worst case it appears once more.
      return false;
    }
  });

  if (dismissed || gaps.length === 0) return null;

  return (
    <div className="mt-6 border border-brass/40 bg-brass/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-base">Finish setting up your account</p>
          <p className="mt-1 text-sm text-ink-soft">
            We still need {listGaps(gaps.map((g) => GAP_LABELS[g]))}. Your date of birth is what
            lets us send you a birthday offer — nothing here is needed to place an order.
          </p>
        </div>
        <button
          onClick={() => {
            setDismissed(true);
            try {
              window.sessionStorage.setItem(KEY, '1');
            } catch {
              /* nothing to do — it simply shows again next visit */
            }
          }}
          aria-label="Dismiss"
          className="shrink-0 border border-line px-2 py-0.5 text-lg leading-none text-ink-soft hover:border-brass hover:text-brass"
        >
          ×
        </button>
      </div>
      <Link href="/signup" className="btn-outline text-xs mt-3 inline-flex">Complete my details</Link>
    </div>
  );
}

const KEY = 'maya_profile_prompt_dismissed';

/** "your name and your email address", not "your name, your email address". */
function listGaps(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
