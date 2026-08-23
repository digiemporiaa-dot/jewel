'use client';

import { useEffect, useState, useCallback } from 'react';
import type { PublicTagConfig } from '@/lib/marketing/tags';
import {
  CONSENT_COOKIE,
  DEFAULT_BANNER_TEXT,
  readConsentCookie,
  writeConsentCookie,
  shouldShowBanner,
  type ConsentChoice,
} from '@/lib/marketing/consent';
import { useConsentChoice, useHydrated } from '@/lib/marketing/use-consent';
import { updateGoogleConsent } from '@/lib/marketing/events';

/**
 * Cookie-consent banner, in the store's own type and colours rather than a
 * generic grey bar. Accept / Decline only — no "manage preferences" maze, which
 * exists mostly to wear people down into accepting.
 *
 * The choice is kept in a first-party cookie for six months and can be changed
 * again from the footer link, so a decline is never a one-way door.
 */
export default function ConsentBanner({ config }: { config: PublicTagConfig }) {
  // Read through a store rather than an effect: a synchronous `setState` in an
  // effect renders twice, and the first of those renders is the one where the
  // visitor's decision is not yet known.
  const choice = useConsentChoice();
  const ready = useHydrated();
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    const onReopen = () => setReopened(true);
    window.addEventListener(`${CONSENT_COOKIE}:reopen`, onReopen);
    return () => window.removeEventListener(`${CONSENT_COOKIE}:reopen`, onReopen);
  }, []);

  const decide = useCallback((next: ConsentChoice) => {
    // The write dispatches the change event, which the store is subscribed to,
    // so the new choice arrives the same way it would from another component.
    writeConsentCookie(next);
    setReopened(false);
    updateGoogleConsent(next === 'granted');
    // Tell TagScripts to re-read the cookie, so accepting takes effect on this
    // page rather than only on the next navigation.
    window.dispatchEvent(new Event(`${CONSENT_COOKIE}:change`));
  }, []);

  if (!ready) return null;
  if (config.consentMode === 'OFF') return null;
  if (!reopened && !shouldShowBanner(config.consentMode, choice)) return null;

  const implied = config.consentMode === 'IMPLIED';

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/98 backdrop-blur-sm"
    >
      <div className="shell py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <p className="text-sm text-ink-soft leading-relaxed flex-1">
          {config.consentBannerText ?? DEFAULT_BANNER_TEXT}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => decide('denied')} className="btn-outline text-xs px-4">
            {implied ? 'Opt out' : 'Decline'}
          </button>
          <button type="button" onClick={() => decide('granted')} className="btn-primary text-xs px-4">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Footer link that reopens the banner. Rendered only when a banner exists at
 * all — a link that opens nothing is worse than no link.
 */
export function ConsentReopenLink({ consentMode }: { consentMode: PublicTagConfig['consentMode'] }) {
  if (consentMode === 'OFF') return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(`${CONSENT_COOKIE}:reopen`))}
      className="hover:text-paper"
    >
      Cookie preferences
    </button>
  );
}
