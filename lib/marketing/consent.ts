/**
 * Visitor consent for analytics and advertising tags.
 *
 * India's DPDP Act requires consent for this kind of tracking, and a Meta Pixel
 * firing without it is a live risk for any EU traffic. The default is therefore
 * `REQUIRED` — a store loosens it deliberately, never by accident.
 *
 * Client-safe: no imports, no secrets.
 */

export const CONSENT_COOKIE = 'maya_consent';

/** Six months, per the brief. Long enough not to nag, short enough to re-ask. */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

export type ConsentChoice = 'granted' | 'denied';

export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === 'granted' || value === 'denied';
}

/** Read the stored choice in the browser. Returns null when nothing is stored. */
export function readConsentCookie(): ConsentChoice | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`));
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return isConsentChoice(value) ? value : null;
}

/**
 * Persist the choice as a first-party cookie.
 *
 * Not `HttpOnly`: the banner and the tag loader both read it in the browser, and
 * it holds no secret — only whether this visitor agreed to be tracked. `SameSite=Lax`
 * so it survives normal navigation without riding along on cross-site requests.
 */
export function writeConsentCookie(choice: ConsentChoice): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${CONSENT_COOKIE}=${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Whether tags may load, given the store's mode and the visitor's choice.
 *
 * Pure, so the rule is testable and stated in exactly one place:
 *  - `REQUIRED` — nothing loads until the visitor accepts.
 *  - `IMPLIED`  — tags load immediately unless the visitor has actively declined.
 *  - `OFF`      — no banner; consent is assumed to be handled elsewhere.
 */
export function mayLoadTags(
  mode: 'REQUIRED' | 'IMPLIED' | 'OFF',
  choice: ConsentChoice | null
): boolean {
  if (mode === 'OFF') return true;
  if (mode === 'IMPLIED') return choice !== 'denied';
  return choice === 'granted';
}

/** Whether the banner should be shown at all. */
export function shouldShowBanner(
  mode: 'REQUIRED' | 'IMPLIED' | 'OFF',
  choice: ConsentChoice | null
): boolean {
  if (mode === 'OFF') return false;
  return choice === null;
}

export const DEFAULT_BANNER_TEXT =
  'We use cookies to understand how our jewellery is browsed and to measure our advertising. You can decline without affecting your shopping.';
