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
 * Two steps, in this order and not the other one: verify the phone, then take
 * the details. The number is the identity key for every order, coupon and spin
 * in the system, so it is proven before anything is attached to it — and a
 * shopper who abandons after the OTP has cost the shop one SMS rather than
 * leaving an unverified profile lying around claiming a number.
 */

const phoneSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const codeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');

export type OtpResult = { ok: boolean; error?: string; devCode?: string };

export async function sendSignupOtp(phone: string): Promise<OtpResult> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid phone' };

  // Per-IP and per-destination, like every other OTP entry point. Sending an SMS
  // costs money and lands on somebody's phone, so an open one is both a bill and
  // a way to harass a stranger.
  const ip = await getClientIp();
  for (const key of [`otp:send:ip:${ip}`, `otp:send:phone:${parsed.data}`]) {
    const rl = await checkLimit(key, LIMITS.otpSend);
    if (!rl.allowed) {
      return { ok: false, error: `Too many code requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` };
    }
  }

  const res = await sendOtp(parsed.data, 'PHONE_VERIFY');
  return res.ok ? { ok: true, devCode: res.devCode } : { ok: false, error: res.error };
}

export async function verifySignupOtp(phone: string, code: string): Promise<OtpResult> {
  const parsedPhone = phoneSchema.safeParse(phone);
  if (!parsedPhone.success) return { ok: false, error: 'Invalid phone' };
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedCode.success) return { ok: false, error: parsedCode.error.issues[0]?.message ?? 'Invalid code' };

  const ip = await getClientIp();
  const rl = await checkLimit(`otp:verify:${ip}:${parsedPhone.data}`, LIMITS.otpVerify);
  if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please request a new code shortly.' };

  const res = await verifyOtp(parsedPhone.data, 'PHONE_VERIFY', parsedCode.data);
  if (!res.ok) return { ok: false, error: res.error };

  // An existing record is reused rather than refused. Someone who has ordered as
  // a guest already has a row keyed on this number; signing up should fill that
  // row in, not collide with it or start a second history beside it.
  const customer = await prisma.customer.upsert({
    where: { phone: parsedPhone.data },
    create: { phone: parsedPhone.data, phoneVerified: true },
    update: { phoneVerified: true },
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

  const parsed = signupSchema.omit({ phone: true }).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? 'Please check the form',
      field: field === 'email' || field === 'dob' || field === 'anniversary' ? field : undefined,
    };
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { phone: true },
  });
  if (!customer) return { ok: false, error: 'Verify your mobile number first.' };

  const result = await saveCustomerProfile({
    customerId,
    input: { ...parsed.data, phone: customer.phone },
  });

  // Fire-and-forget: a welcome email that fails to send must not fail the
  // signup. It is also guarded by the NEW_CUSTOMER campaign switch and by
  // "no orders yet", both inside `sendWelcome`.
  if (result.ok) void sendWelcome(customerId).catch(() => {});
  return result;
}
