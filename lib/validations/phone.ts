import { z } from 'zod';

/**
 * Indian mobile numbers: one parser, three renderings, and a junk filter.
 *
 * This matters more than ordinary field validation because **nothing verifies a
 * phone number any more.** Email is the OTP-verified identifier; the phone is
 * collected, stored and never confirmed until `OTP_CHANNELS` includes it. So
 * this file is the only thing standing between a typo and a courier ringing a
 * stranger about a jewellery delivery, or a shop trying to reach a customer
 * about a ₹70,000 order on a number that never existed.
 *
 * Pure and free of `server-only` on purpose: the signup form is a client
 * component and needs the same rules the server enforces. It is also why the
 * canonical `normalizeIndianMobile` lives here rather than in `lib/sms/` —
 * that module is server-only, and a second copy of a number parser is how the
 * two quietly start disagreeing about what a valid number is.
 */

/**
 * The gateway form: `91XXXXXXXXXX`.
 *
 * Input may arrive as "9876543210", "+91 98765 43210" or "09876543210", so
 * everything non-numeric is stripped before the country code is applied. The
 * first digit must be 6–9: that is the whole of the Indian mobile range, and
 * everything below it is a landline, a service code, or nothing.
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

/**
 * The stored form: ten digits, no country code.
 *
 * Derived from the same parser rather than parsed again — but deliberately not
 * the gateway's `91`-prefixed string. Every `Customer` row written since this
 * shop opened holds ten digits, and every `where: { phone }` lookup passes ten
 * digits. Switching storage to the gateway form would orphan every existing
 * customer behind a key nothing looks them up by.
 */
export function toStoredPhone(input: string): string | null {
  const gateway = normalizeIndianMobile(input);
  return gateway ? gateway.slice(2) : null;
}

/** `+91 98765 43210`. Display only — never write this back to the column. */
export function formatIndianMobile(stored: string | null | undefined): string {
  const ten = stored ? toStoredPhone(stored) : null;
  if (!ten) return stored?.trim() || '—';
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

/**
 * Numbers that parse but were never meant to reach anybody.
 *
 * Two shapes, both of which pass every structural check and neither of which is
 * a real subscriber:
 *
 *  - **One digit repeated** — `9999999999`. What somebody types to get past a
 *    required field.
 *  - **A run** — `9876543210` ascending or descending. This is *the* placeholder
 *    Indian mobile number; it appears in half the tutorials and most of the test
 *    data in the country, and it will otherwise arrive attached to real orders.
 *
 * Nothing else is guessed at. A filter that rejects numbers on a hunch turns a
 * real customer away at checkout, and that is a worse failure than a bad number
 * reaching the CRM.
 */
export function isJunkPhone(input: string): boolean {
  const ten = toStoredPhone(input);
  if (!ten) return false;

  if (/^(\d)\1{9}$/.test(ten)) return true;

  let ascending = true;
  let descending = true;
  for (let i = 1; i < ten.length; i += 1) {
    const step = Number(ten[i]) - Number(ten[i - 1]);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

export const PHONE_INVALID = 'Enter a 10-digit Indian mobile number';
export const PHONE_JUNK = 'That does not look like a real mobile number — please check it';

/**
 * The field, for every form and action that takes a phone.
 *
 * Transforms to the stored ten-digit form, so a caller cannot forget to
 * normalise and then write "+91 98765 43210" into a column everything else
 * queries with ten digits.
 */
export const phoneField = z
  .string()
  .trim()
  .min(1, PHONE_INVALID)
  .refine((v) => toStoredPhone(v) !== null, PHONE_INVALID)
  .refine((v) => !isJunkPhone(v), PHONE_JUNK)
  .transform((v) => toStoredPhone(v) as string);
