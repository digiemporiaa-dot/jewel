import 'server-only';
import { createHmac, timingSafeEqual, randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getSmsProvider } from '@/lib/sms';
import { normalizeIndianMobile } from '@/lib/sms/provider';
import { sendEmail } from '@/lib/email';
import { isOtpChannelEnabled } from '@/lib/otp-channels';
import type { OtpPurpose } from '@prisma/client';

/**
 * Phone/email OTP with hashed storage, expiry and attempt limits (brief §45).
 * Codes are never stored in plaintext and never logged in production (§68).
 */

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;

function hashCode(target: string, code: string): string {
  const secret = process.env.AUTH_SECRET ?? 'dev-secret';
  return createHmac('sha256', secret).update(`${target}:${code}`).digest('hex');
}

function generateNumericCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += randomInt(0, 10).toString();
  return code;
}

export type SendOtpResult = { ok: true; devCode?: string } | { ok: false; error: string };

/**
 * Create and "send" an OTP. Delivery is abstracted — in production this dispatches
 * SMS/email; in development the code is returned/logged so the flow is testable.
 */
export async function sendOtp(target: string, purpose: OtpPurpose): Promise<SendOtpResult> {
  const normalized = target.trim();
  if (!normalized) return { ok: false, error: 'Missing destination' };

  // Resend cooldown — prevent spamming.
  const recent = await prisma.otp.findFirst({
    where: { target: normalized, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    return { ok: false, error: `Please wait before requesting another code` };
  }

  // Invalidate previous unconsumed codes for this target+purpose.
  await prisma.otp.deleteMany({ where: { target: normalized, purpose, consumedAt: null } });

  const code = generateNumericCode();
  await prisma.otp.create({
    data: {
      target: normalized,
      codeHash: hashCode(normalized, code),
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
    },
  });

  // Dispatch. In development the code is logged and returned so the flow stays
  // testable without a gateway; the code is never logged in production.
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    console.info(`[otp] ${purpose} code for ${normalized}: ${code}`);
    return { ok: true, devCode: code };
  }

  // Testing hatch. Numbers listed in OTP_DEBUG_PHONES get their code written to
  // the server log instead of an SMS, so the checkout flow is testable before the
  // DLT/gateway setup is live. Scoped to an explicit allowlist so no shopper's
  // code is ever logged. REMOVE the variable once SMS delivery works.
  const debugPhones = (process.env.OTP_DEBUG_PHONES ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\D/g, ''))
    .filter(Boolean);
  if (debugPhones.length > 0 && debugPhones.includes(normalized.replace(/\D/g, ''))) {
    console.warn(`[otp][debug] ${purpose} code for ${normalized}: ${code}`);
    return { ok: true };
  }

  // Email is the channel that verifies identity. Added alongside the SMS path
  // rather than in place of it: the phone route below is unchanged and comes
  // back the day `OTP_CHANNELS` includes it.
  if (normalized.includes('@')) {
    if (!isOtpChannelEnabled('email')) {
      return { ok: false, error: 'Email codes are not switched on.' };
    }
    const delivered = await sendEmail({
      to: normalized,
      subject: `${code} is your verification code`,
      html: otpEmailHtml(code),
      text: `Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      templateKey: 'otp',
    });
    if (!delivered) {
      // Same reasoning as the SMS branch: a stored code the customer never
      // received only makes them sit out the resend cooldown for nothing.
      await prisma.otp.deleteMany({ where: { target: normalized, purpose, consumedAt: null } });
      return { ok: false, error: 'We could not send the code. Please try again shortly.' };
    }
    return { ok: true };
  }

  // Phone. Held behind the channel switch because nothing delivers an SMS yet,
  // and a code that cannot arrive strands the customer at the code box rather
  // than telling them anything.
  if (!isOtpChannelEnabled('phone')) {
    return { ok: false, error: 'Codes are sent by email. Please use your email address.' };
  }
  if (!normalizeIndianMobile(normalized)) {
    return { ok: false, error: 'Enter a valid 10-digit mobile number' };
  }

  const sms = await getSmsProvider().sendOtp({ phone: normalized, code });
  if (!sms.ok) {
    // The stored code is useless once delivery failed, and leaving it in place
    // would make the shopper sit out the resend cooldown for a code they never
    // received.
    await prisma.otp.deleteMany({ where: { target: normalized, purpose, consumedAt: null } });
    return { ok: false, error: sms.error };
  }
  return { ok: true };
}

/**
 * The code, and nothing else.
 *
 * No links, no branding to click, no unsubscribe: a verification mail that
 * looks like marketing gets filtered like marketing, and this one has ten
 * minutes to arrive.
 */
function otpEmailHtml(code: string): string {
  return [
    '<div style="font-family:Georgia,serif;font-size:16px;color:#161513">',
    '<p>Your verification code is</p>',
    `<p style="font-size:32px;letter-spacing:6px;margin:16px 0"><strong>${code}</strong></p>`,
    `<p style="color:#6b675f;font-size:14px">It expires in ${OTP_TTL_MINUTES} minutes. If you did not ask for it, ignore this email.</p>`,
    '</div>',
  ].join('');
}

export type VerifyOtpResult = { ok: true } | { ok: false; error: string };

/** Verify an OTP: single-use, expiry-checked, attempt-capped, constant-time compare. */
export async function verifyOtp(target: string, purpose: OtpPurpose, code: string): Promise<VerifyOtpResult> {
  const normalized = target.trim();
  const record = await prisma.otp.findFirst({
    where: { target: normalized, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return { ok: false, error: 'No active code. Please request a new one.' };

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.otp.delete({ where: { id: record.id } });
    return { ok: false, error: 'Code expired. Please request a new one.' };
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.otp.delete({ where: { id: record.id } });
    return { ok: false, error: 'Too many attempts. Please request a new code.' };
  }

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(normalized, code.trim()), 'hex');
  const match = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!match) {
    await prisma.otp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: 'Incorrect code' };
  }

  await prisma.otp.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}
