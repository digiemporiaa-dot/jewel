import 'server-only';

/**
 * SMS delivery, kept behind an interface so a different gateway can be dropped in
 * per deployment without touching the OTP flow (same pattern as lib/shipping).
 */

export type SmsResult = { ok: true } | { ok: false; error: string };

export interface SmsProvider {
  readonly name: string;
  /** True when credentials are absent — caller decides how to degrade. */
  readonly dev: boolean;
  sendOtp(params: { phone: string; code: string }): Promise<SmsResult>;
}

/**
 * Indian mobile numbers reach the gateway as 91XXXXXXXXXX.
 *
 * Re-exported rather than defined here. The identical rule now has to run in a
 * browser as well — the signup form validates a phone before it is submitted,
 * and this module is `server-only` — so the implementation moved to
 * `lib/validations/phone.ts` and both sides import the one copy. The export
 * stays on this module because `lib/otp.ts` and the gateway clients import it
 * from here, and there was no reason to make them move too.
 */
export { normalizeIndianMobile } from '@/lib/validations/phone';
