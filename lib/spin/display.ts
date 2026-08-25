/**
 * When the wheel may appear.
 *
 * Pure, and separate from the component, because these rules are the difference
 * between a promotion and a penalty. Two of them are not preferences:
 *
 *  - **Never over a payment flow.** An interstitial on the cart or checkout costs
 *    more in abandoned baskets than any coupon it hands out earns back.
 *  - **Never on first paint on mobile.** Google demotes pages that cover the
 *    content with an interstitial as it loads, so the wheel waits for intent and
 *    arrives as a bottom sheet rather than a full-screen overlay.
 */

/**
 * Paths the wheel must never appear on.
 *
 * A prefix list, not exact matches: `/checkout/anything` is still checkout.
 * `/order` is here too — a confirmation page is the moment a customer is
 * deciding whether they trust the shop, and a popup over it is the wrong answer.
 */
export const SUPPRESSED_PREFIXES = ['/cart', '/checkout', '/order', '/track', '/admin', '/signup'] as const;

export function isSuppressedPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return SUPPRESSED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** First-party cookie. No third party is involved and none needs to be. */
export const SPIN_COOKIE = 'maya_spin';

/** What the cookie can say. */
export type SpinCookieState = 'dismissed' | 'done';

export const DISMISS_DAYS = 30;

/**
 * Dismissed is a pause; spun is permanent.
 *
 * Somebody who closed the wheel has said "not now", which is worth respecting
 * for a month. Somebody who has already spun has nothing left to win, and
 * showing it to them again is just a lie about what they can get.
 */
export function cookieMaxAgeSeconds(state: SpinCookieState): number {
  return state === 'done' ? 60 * 60 * 24 * 365 * 5 : 60 * 60 * 24 * DISMISS_DAYS;
}

export type TriggerReason = 'exit-intent' | 'dwell' | 'scroll';

export type DisplayDecision =
  | { show: false; because: 'suppressed-path' | 'cookie' | 'no-campaign' | 'not-triggered' }
  | { show: true; because: TriggerReason };

export type DisplayInput = {
  pathname: string;
  hasCampaign: boolean;
  cookie: SpinCookieState | null;
  /** Fired only on pointer-capable screens; see the note on `dwellMs`. */
  exitIntent: boolean;
  msOnPage: number;
  scrollFraction: number;
  isMobile: boolean;
};

/** Long enough to mean interest, short enough that most sessions reach it. */
export const DWELL_MS = 30_000;
export const SCROLL_FRACTION = 0.5;

/**
 * Should the wheel be showing right now?
 *
 * Evaluated in order of authority: a forbidden path beats everything, then the
 * customer's own choice in the cookie, then whether there is anything to show,
 * and only then the triggers.
 */
export function decideDisplay(input: DisplayInput): DisplayDecision {
  if (isSuppressedPath(input.pathname)) return { show: false, because: 'suppressed-path' };
  if (input.cookie) return { show: false, because: 'cookie' };
  if (!input.hasCampaign) return { show: false, because: 'no-campaign' };

  // Exit intent needs a cursor leaving the viewport, which a touchscreen has no
  // equivalent of. Faking one from a scroll-up gesture fires while somebody is
  // still reading, so mobile waits for dwell or depth instead.
  if (input.exitIntent && !input.isMobile) return { show: true, because: 'exit-intent' };
  if (input.msOnPage >= DWELL_MS) return { show: true, because: 'dwell' };
  if (input.scrollFraction >= SCROLL_FRACTION) return { show: true, because: 'scroll' };

  return { show: false, because: 'not-triggered' };
}

/** Event the wheel dispatches after writing the cookie, so readers re-read. */
export const SPIN_COOKIE_EVENT = 'maya_spin:change';

/**
 * Read the cookie from `document.cookie`.
 *
 * Lives here rather than in the component so the hook below and any future
 * reader share one parser — two of them would eventually disagree about what
 * counts as dismissed.
 */
export function readSpinCookie(): SpinCookieState | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SPIN_COOKIE}=([^;]*)`));
  const value = match?.[1];
  return value === 'dismissed' || value === 'done' ? value : null;
}
