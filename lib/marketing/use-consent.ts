'use client';

import { useSyncExternalStore } from 'react';
import { CONSENT_COOKIE, readConsentCookie, type ConsentChoice } from '@/lib/marketing/consent';

/**
 * The visitor's consent choice, read from the cookie.
 *
 * `useSyncExternalStore` rather than an effect. Both the banner and the tag
 * loader used to read the cookie inside `useEffect` and call `setState`, which
 * React 19 flags: a synchronous `setState` in an effect renders twice, and on
 * something that gates whether third-party scripts load, the first of those
 * renders is the one where they have not loaded yet.
 *
 * The server snapshot is `null` — a server cannot read `document.cookie`, and
 * saying so explicitly is what keeps hydration honest instead of guessing.
 */

function subscribe(onChange: () => void): () => void {
  // The banner writes the cookie and dispatches this event; the tag loader
  // listens. Re-reading beats lifting state, so the two stay independent.
  const event = `${CONSENT_COOKIE}:change`;
  window.addEventListener(event, onChange);
  return () => window.removeEventListener(event, onChange);
}

export function useConsentChoice(): ConsentChoice | null {
  return useSyncExternalStore(subscribe, readConsentCookie, () => null);
}

/**
 * Whether we are past hydration.
 *
 * Neither the banner nor a tracking script may render on the server: one would
 * flash for a visitor who already decided, and the other would load a
 * third-party script before consent was known.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
