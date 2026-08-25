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
 * The phone number is not taken from the submitted form. It comes from the
 * verified session the caller established, because the whole point of the OTP
 * step is that the identity key is proven rather than typed — accepting it from
 * the request body would let anyone claim any number's account.
 */

export type SaveProfileResult =
  | { ok: true; customerId: string; marketingGranted: boolean; refusedBecause: 'minor' | null }
  | { ok: false; error: string; field?: 'email' | 'dob' | 'anniversary' | 'gender' };

/** Postgres unique-violation, as Prisma reports it. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Is this email already spoken for by somebody else?
 *
 * Checked without a `deletedAt` filter on purpose. The unique index covers every
 * row including soft-deleted ones, so filtering here would let the check pass and
 * the insert fail — trading a clear message for a 500.
 */
async function emailTaken(email: string, exceptCustomerId: string): Promise<boolean> {
  const existing = await prisma.customer.findFirst({
    where: { email, id: { not: exceptCustomerId } },
    select: { id: true },
  });
  return existing !== null;
}

const EMAIL_TAKEN_MESSAGE =
  'That email address is already registered to another account. Sign in with the mobile ' +
  'number you used before, or use a different email.';

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
  if (await emailTaken(input.email, params.customerId)) {
    return { ok: false, error: EMAIL_TAKEN_MESSAGE, field: 'email' };
  }

  try {
    await prisma.customer.update({
      where: { id: params.customerId },
      data: {
        name: input.name,
        email: input.email,
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
      return { ok: false, error: EMAIL_TAKEN_MESSAGE, field: 'email' };
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
