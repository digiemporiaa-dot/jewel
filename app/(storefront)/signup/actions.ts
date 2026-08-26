'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendOtp, verifyOtp } from '@/lib/otp';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';
import { setCustomerSession, getCustomerId } from '@/lib/customer-session';
import { saveCustomerProfile, type SaveProfileResult } from '@/lib/customers/profile';
import { signupSchema } from '@/lib/validations/signup';
import { sendWelcome } from '@/lib/email/notifications';

/**
 * Signing up.
 *
 * Two steps, in this order and not the other one: verify the **email**, then
 * take the details. The address is the identity key — it is what signs a
 * customer back in — so it is proven before anything is attached to it, and a
 * shopper who abandons after the code leaves no unverified profile claiming an
 * address that is not theirs.
 *
 * The mobile number is required in step two and stored unverified. Nothing
 * confirms it until `OTP_CHANNELS` includes phone, which is why it is validated
 * hard on the way in — see lib/validations/phone.ts.
 */

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);
const codeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export type OtpResult = { ok: boolean; error?: string; devCode?: string };

export async function sendSignupOtp(email: string): Promise<OtpResult> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid email' };

  // Per-IP and per-destination, like every other OTP entry point. A code lands
  // in somebody's inbox, so an open endpoint is a way to harass a stranger and
  // a fast route to the sending domain's reputation.
  const ip = await getClientIp();
  for (const key of [`otp:send:ip:${ip}`, `otp:send:email:${parsed.data}`]) {
    const rl = await checkLimit(key, LIMITS.otpSend);
    if (!rl.allowed) {
      return { ok: false, error: `Too many code requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` };
    }
  }

  const res = await sendOtp(parsed.data, 'EMAIL_VERIFY');
  return res.ok ? { ok: true, devCode: res.devCode } : { ok: false, error: res.error };
}

export async function verifySignupOtp(email: string, code: string): Promise<OtpResult> {
  const parsedEmail = emailSchema.safeParse(email);
  if (!parsedEmail.success) return { ok: false, error: 'Invalid email' };
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success) return { ok: false, error: parsedCode.error.issues[0]?.message ?? 'Invalid code' };

  const ip = await getClientIp();
  const rl = await checkLimit(`otp:verify:${ip}:${parsedEmail.data}`, LIMITS.otpVerify);
  if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please request a new code shortly.' };

  const res = await verifyOtp(parsedEmail.data, 'EMAIL_VERIFY', parsedCode.data);
  if (!res.ok) return { ok: false, error: res.error };

  // An existing record is reused rather than refused. Someone who gave this
  // address at checkout already has a row; verifying it should sign them into
  // that row, not start a second history beside it.
  const customer = await prisma.customer.upsert({
    where: { email: parsedEmail.data },
    create: { email: parsedEmail.data, emailVerified: true },
    update: { emailVerified: true },
  });
  await setCustomerSession(customer.id);
  return { ok: true };
}

export type SignupResult = SaveProfileResult;

/**
 * Save the profile against the session established by the OTP step.
 *
 * The submitted form carries no phone number by design — see the note in
 * lib/customers/profile.ts.
 */
export async function completeSignup(raw: unknown): Promise<SignupResult> {
  const customerId = await getCustomerId();
  if (!customerId) {
    return { ok: false, error: 'Verify your mobile number first.' };
  }

  // Limited per session and per address.
  //
  // "That email is already registered" is a true and useful message, and it is
  // also an oracle: without a limit, one verified number could sit here and test
  // whether any address in a list belongs to a customer of this shop. Filling in
  // your own details takes a handful of attempts, so the ceiling costs an honest
  // customer nothing.
  const ip = await getClientIp();
  for (const key of [`signup:save:${customerId}`, `signup:save:ip:${ip}`]) {
    const rl = await checkLimit(key, LIMITS.publicAction);
    if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please wait a moment and try again.' };
  }

  // Email is omitted, not submitted: it is the verified identity on the session
  // and must not be re-read from a request body. The phone is the opposite —
  // required here, and the only field in the form nothing has proven.
  const parsed = signupSchema.omit({ email: true }).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? 'Please check the form',
      field:
        field === 'phone' || field === 'dob' || field === 'anniversary' || field === 'gender'
          ? field
          : undefined,
    };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { email: true },
  });
  if (!customer?.email) return { ok: false, error: 'Verify your email address first.' };

  const result = await saveCustomerProfile({
    customerId,
    input: { ...parsed.data, email: customer.email },
  });

  // Fire-and-forget: a welcome email that fails to send must not fail the
  // signup. It is also guarded by the NEW_CUSTOMER campaign switch and by
  // "no orders yet", both inside `sendWelcome`.
  if (result.ok) void sendWelcome(customerId).catch(() => {});
  return result;
}
