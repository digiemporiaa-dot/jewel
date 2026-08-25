import { z } from 'zod';

/**
 * Signing up as a customer, and the consent rules that go with it.
 *
 * Pure and free of `server-only` so the rules are directly testable — the two
 * that matter most are date-of-birth handling and who may be sent marketing, and
 * both are the kind of thing that silently goes wrong in production if the only
 * proof they work is a page rendering.
 *
 * Three obligations from the DPDP Act shape this file rather than the UI:
 *
 *  - **Consent must be free, specific and informed.** Marketing is its own
 *    unticked box, never bundled into "create account". `marketingOptIn` is
 *    therefore `.default(false)` and an absent field means no.
 *  - **Purpose limitation.** Date of birth is collected for one stated reason,
 *    written next to the field, and `DOB_PURPOSE` is that sentence — shared by
 *    the form and the tests so the promise and the code cannot drift.
 *  - **Children.** Processing a child's data for marketing needs verifiable
 *    parental consent, which a checkbox is not. Under-18 accounts are allowed;
 *    their marketing consent is refused.
 */

/** Shown beside the date-of-birth field. Purpose limitation, in one sentence. */
export const DOB_PURPOSE = 'So we can send you a birthday offer. Nothing else.';

/** DPDP treats anyone under this age as a child. */
export const ADULT_AGE = 18;

/**
 * Parse a browser `<input type="date">` value into the Date the birthday
 * campaign will compare against.
 *
 * **UTC midnight, deliberately.** `lib/campaigns` matches a birthday with
 * `dob.getMonth()` and `dob.getDate()`, so how this value is anchored decides
 * whether the email lands on the right day. `new Date('1990-05-14')` is already
 * UTC midnight; `new Date('1990-05-14T00:00:00+05:30')` is the 13th in UTC and
 * would send every Indian customer their birthday offer a day early.
 *
 * Returns null for anything that is not a real calendar date, including the
 * shapes `Date` accepts and then quietly rolls over (2025-02-30 → 2 March).
 */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February rather than accepting the 3rd of March in its place.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Whole years elapsed, counted on the calendar rather than in milliseconds. */
export function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

export function isMinor(dob: Date, now: Date): boolean {
  return ageOn(dob, now) < ADULT_AGE;
}

export type ConsentDecision = {
  granted: boolean;
  /** Why consent was not granted, when it was asked for and refused. */
  refusedBecause: 'minor' | null;
};

/**
 * Decide whether marketing consent actually takes effect.
 *
 * Asking is not the same as being allowed to say yes. A minor who ticks the box
 * still gets an account — refusing the account would be a worse outcome than
 * refusing the emails — but the consent does not stand, and the caller tells
 * them so rather than storing a `false` they think is a `true`.
 */
export function resolveMarketingConsent(input: {
  requested: boolean;
  dob: Date;
  now: Date;
}): ConsentDecision {
  if (!input.requested) return { granted: false, refusedBecause: null };
  if (isMinor(input.dob, input.now)) return { granted: false, refusedBecause: 'minor' };
  return { granted: true, refusedBecause: null };
}

export const MINOR_CONSENT_NOTICE =
  'Your account is ready. We have not switched on marketing emails: the law requires a ' +
  'parent or guardian to agree to those for anyone under 18.';

/** A date of birth has to be in the past and plausibly a person's. */
const MAX_AGE = 120;

const dateOnly = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => parseDateOnly(v) !== null, `Enter ${label.toLowerCase()} as a real date`);

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  // The identity key. `Customer.phone` is unique and every order, OTP and spin
  // hangs off it, so it is validated to exactly the shape the SMS provider takes.
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  // Required here, unlike at checkout: without it there is nothing to send a
  // birthday offer, an order confirmation or a password-free sign-in link to.
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(160),
  dob: dateOnly('Date of birth'),
  anniversary: z.string().trim().optional().or(z.literal('')).refine(
    (v) => !v || parseDateOnly(v) !== null,
    'Enter the anniversary as a real date'
  ),
  // Absent means no. A checkbox that is not ticked sends no value at all, and
  // that must read as a refusal rather than as a missing field.
  marketingOptIn: z.boolean().default(false),
});

export type SignupInput = z.infer<typeof signupSchema>;

export type DateFieldProblem = 'future' | 'implausible' | null;

/** Sanity checks a regex cannot make: a birthday next year, or 150 years ago. */
export function checkBirthDate(dob: Date, now: Date): DateFieldProblem {
  if (dob.getTime() > now.getTime()) return 'future';
  if (ageOn(dob, now) > MAX_AGE) return 'implausible';
  return null;
}

export const DATE_PROBLEM_MESSAGES: Record<Exclude<DateFieldProblem, null>, string> = {
  future: 'That date is in the future',
  implausible: 'Please check that date',
};

/**
 * What a customer still has to fill in.
 *
 * Drives the prompt on the account page. Phone is never listed: a customer only
 * has a record at all because a phone number was verified, so it cannot be
 * missing and offering to "complete" it would be nonsense.
 */
export type ProfileGap = 'name' | 'email' | 'dob';

export function profileGaps(customer: {
  name: string | null;
  email: string | null;
  dob: Date | null;
}): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (!customer.name?.trim()) gaps.push('name');
  if (!customer.email?.trim()) gaps.push('email');
  if (!customer.dob) gaps.push('dob');
  return gaps;
}

export const GAP_LABELS: Record<ProfileGap, string> = {
  name: 'your name',
  email: 'your email address',
  dob: 'your date of birth',
};
