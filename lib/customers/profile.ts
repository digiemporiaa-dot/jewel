import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  resolveMarketingConsent, parseDateOnly, checkBirthDate, DATE_PROBLEM_MESSAGES,
  type SignupInput,
} from '@/lib/validations/signup';

/**
 * Writing a customer's profile.
 *
 * The **email** is not taken from the submitted form. It comes from the verified
 * session the caller established, because the whole point of the OTP step is
 * that the identity is proven rather than typed — accepting it from the request
 * body would let anyone claim any address's account.
 *
 * The phone is taken from the form, and is the one field here that nothing
 * proves. It is still unique, so it still has to be checked against the records
 * that already hold it.
 */

export type SaveProfileResult =
  | { ok: true; customerId: string; marketingGranted: boolean; refusedBecause: 'minor' | null }
  | { ok: false; error: string; field?: 'email' | 'phone' | 'dob' | 'anniversary' | 'gender' };

/** Postgres unique-violation, as Prisma reports it. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Is this value already spoken for by somebody else?
 *
 * Checked without a `deletedAt` filter on purpose. The unique index covers every
 * row including soft-deleted ones, so filtering here would let the check pass and
 * the insert fail — trading a clear message for a 500.
 */
async function takenByAnother(
  field: 'email' | 'phone',
  value: string,
  exceptCustomerId: string
): Promise<boolean> {
  const existing = await prisma.customer.findFirst({
    where: { [field]: value, id: { not: exceptCustomerId } },
    select: { id: true },
  });
  return existing !== null;
}

const EMAIL_TAKEN_MESSAGE =
  'That email address is already registered to another account. Sign in with it instead, ' +
  'or use a different address.';

/**
 * The message for a number that belongs to an older record.
 *
 * This is the collision that email-as-identifier creates: somebody who ordered
 * through the old phone-only checkout has a record keyed on their number and no
 * address on it. When they later sign up by email, a second record is made, and
 * their number is already taken by the first.
 *
 * Refused rather than merged, deliberately. Merging two customers means moving
 * orders, carts, wishlists, reviews and won coupons between them, and getting
 * that wrong loses somebody's purchase history. A message that puts a person in
 * front of it is the safe answer until a reviewed merge exists.
 */
const PHONE_TAKEN_MESSAGE =
  'That mobile number is already on another account here — most likely one created when you ' +
  'ordered before. Please contact us and we will join the two together.';

/**
 * Save a verified customer's profile.
 *
 * Marketing consent is resolved rather than stored as submitted: a minor's
 * request is refused and reported back, so the caller can say why instead of
 * silently writing `false`.
 */
export async function saveCustomerProfile(params: {
  customerId: string;
  input: SignupInput;
  now?: Date;
}): Promise<SaveProfileResult> {
  const now = params.now ?? new Date();
  const { input } = params;

  const dob = parseDateOnly(input.dob);
  if (!dob) return { ok: false, error: 'Enter a valid date of birth', field: 'dob' };
  const dobProblem = checkBirthDate(dob, now);
  if (dobProblem) return { ok: false, error: DATE_PROBLEM_MESSAGES[dobProblem], field: 'dob' };

  const anniversary = input.anniversary ? parseDateOnly(input.anniversary) : null;
  if (input.anniversary && !anniversary) {
    return { ok: false, error: 'Enter a valid anniversary date', field: 'anniversary' };
  }
  if (anniversary && anniversary.getTime() > now.getTime()) {
    return { ok: false, error: DATE_PROBLEM_MESSAGES.future, field: 'anniversary' };
  }

  const consent = resolveMarketingConsent({ requested: input.marketingOptIn, dob, now });

  // Checked first for a message worth reading, then caught below for the race
  // between the check and the write. Both paths, because neither alone is
  // enough: the check alone loses to a concurrent signup, the catch alone turns
  // the common case into a stack trace.
  if (await takenByAnother('email', input.email, params.customerId)) {
    return { ok: false, error: EMAIL_TAKEN_MESSAGE, field: 'email' };
  }
  if (await takenByAnother('phone', input.phone, params.customerId)) {
    return { ok: false, error: PHONE_TAKEN_MESSAGE, field: 'phone' };
  }

  try {
    await prisma.customer.update({
      where: { id: params.customerId },
      data: {
        name: input.name,
        email: input.email,
        // Already normalised to ten digits by `phoneField`; stored that way so
        // every existing lookup keyed on ten digits keeps finding this row.
        phone: input.phone,
        dob,
        anniversary,
        // The schema admits only the three enum members, so this is safe to
        // pass straight through to a column typed the same way.
        gender: input.gender,
        marketingOptIn: consent.granted,
        // Stamped on acceptance. `input.acceptTerms` is `true` by the time it
        // gets here — the schema admits nothing else — so this records when,
        // which is the part that is useful later.
        termsAcceptedAt: now,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION) {
      // Which column lost the race. Prisma names it on the error, and saying
      // "email is taken" about a phone collision sends the customer to change
      // the wrong field.
      const target = e.meta?.target;
      const onPhone = Array.isArray(target)
        ? target.includes('phone')
        : typeof target === 'string' && target.includes('phone');
      return onPhone
        ? { ok: false, error: PHONE_TAKEN_MESSAGE, field: 'phone' }
        : { ok: false, error: EMAIL_TAKEN_MESSAGE, field: 'email' };
    }
    throw e;
  }

  return {
    ok: true,
    customerId: params.customerId,
    marketingGranted: consent.granted,
    refusedBecause: consent.refusedBecause,
  };
}
