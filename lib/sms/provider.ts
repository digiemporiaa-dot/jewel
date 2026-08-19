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
 * Indian mobile numbers reach the gateway as 91XXXXXXXXXX. Input may arrive as
 * "9876543210", "+91 98765 43210" or "09876543210", so everything non-numeric is
 * stripped before the country code is applied.
 */
export function normalizeIndianMobile(input: string): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 10) return /^[6-9]/.test(digits) ? `91${digits}` : null;
  if (digits.length === 11 && digits.startsWith('0')) {
    const rest = digits.slice(1);
    return /^[6-9]/.test(rest) ? `91${rest}` : null;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const rest = digits.slice(2);
    return /^[6-9]/.test(rest) ? digits : null;
  }
  return null;
}
