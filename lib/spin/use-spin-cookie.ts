'use client';

import { useSyncExternalStore } from 'react';
import { readSpinCookie, SPIN_COOKIE_EVENT, type SpinCookieState } from '@/lib/spin/display';

/**
 * The wheel's cookie, read reactively.
 *
 * `useSyncExternalStore` rather than an effect, for the same reason the consent
 * banner uses one: React 19 flags a synchronous `setState` inside an effect, and
 * the extra render it causes is the one where the wheel has not yet noticed it
 * was dismissed — a flash of a popup somebody already closed.
 *
 * The server snapshot is `null`, because a server cannot read `document.cookie`
 * and pretending otherwise is how hydration mismatches start.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(SPIN_COOKIE_EVENT, onChange);
  return () => window.removeEventListener(SPIN_COOKIE_EVENT, onChange);
}

export function useSpinCookie(): SpinCookieState | null {
  return useSyncExternalStore(subscribe, readSpinCookie, () => null);
}
