import { z } from 'zod';
import { phoneField } from '@/lib/validations/phone';

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

/**
 * Why each field is being asked for, shown beside it.
 *
 * Purpose limitation is a DPDP obligation, and these strings are what the form
 * actually renders — shared with the tests so the promise and the field cannot
 * drift apart. They also raise completion: an unexplained date-of-birth box
 * reads as a data grab, and an explained one reads as an offer.
 */
export const DOB_PURPOSE = 'So we can send you a birthday offer. Nothing else.';
export const ANNIVERSARY_PURPOSE = 'Optional. If you tell us, we will send an anniversary offer too.';
export const GENDER_PURPOSE = 'So we can show you pieces that are more likely to be relevant.';

/** The four the form offers. A free-text box produces data nothing can segment. */
export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

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
  /**
   * Required, stored, and — for now — never verified.
   *
   * The OTP proves the email; nothing proves this. That is precisely why it goes
   * through `phoneField` rather than a regex: a shape check would accept
   * 9999999999 and a courier would eventually dial it. See lib/validations/phone.ts.
   */
  phone: phoneField,
  /**
   * The login identifier, and the one thing an OTP actually proves.
   *
   * Required here and at checkout: without an address there is no way to sign
   * somebody back in, no order confirmation, and no birthday offer.
   */
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(160),
  dob: dateOnly('Date of birth'),
  /**
   * Required by the form, nullable in the database — see the note on
   * `Customer.gender`. A record predating this form has no answer, and
   * inventing one would put a claim on somebody's record they never made.
   */
  gender: z.enum(GENDERS, {
    errorMap: () => ({ message: 'Please choose an option' }),
  }),
  anniversary: z.string().trim().optional().or(z.literal('')).refine(
    (v) => !v || parseDateOnly(v) !== null,
    'Enter the anniversary as a real date'
  ),
  /**
   * Agreeing to the terms. Required, and enforced here rather than only by the
   * browser's `required` attribute — a form post can skip the browser entirely.
   *
   * Kept separate from `marketingOptIn` on purpose. A required box cannot carry
   * marketing consent: the DPDP Act wants that consent free and specific, and
   * consent nobody could refuse without losing the account is neither. Bundling
   * them would also quietly empty the birthday campaign's audience, since it
   * only ever writes to customers who opted in.
   */
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Please accept the terms and conditions to continue' }),
  }),

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
 * Drives the prompt on the account page, and the chase list in the admin.
 *
 * Phone is listed now. It used to be excluded on the grounds that a record only
 * existed because a number had been verified — which stopped being true the
 * moment email became the identifier. A customer who signs up by email today,
 * and every customer created by the old checkout who never gave one, can be
 * missing either side of the pair.
 */
export type ProfileGap = 'name' | 'email' | 'phone' | 'dob' | 'gender';

export function profileGaps(customer: {
  name: string | null;
  email: string | null;
  phone?: string | null;
  dob: Date | null;
  gender: string | null;
}): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  // `phone` is optional on the parameter so callers that genuinely do not
  // select the column are not forced to claim it is missing.
  if (customer.phone !== undefined && !customer.phone) gaps.push('phone');
  if (!customer.name?.trim()) gaps.push('name');
  if (!customer.email?.trim()) gaps.push('email');
  if (!customer.dob) gaps.push('dob');
  if (!customer.gender) gaps.push('gender');
  return gaps;
}

export const GAP_LABELS: Record<ProfileGap, string> = {
  name: 'your name',
  email: 'your email address',
  phone: 'your mobile number',
  dob: 'your date of birth',
  gender: 'how you would like to be addressed',
};
