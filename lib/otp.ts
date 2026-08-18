import 'server-only';
import { createHmac, timingSafeEqual, randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
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

  // Dispatch (dev: log; prod: SMS/email provider — wired in Phase 6 campaigns).
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    console.info(`[otp] ${purpose} code for ${normalized}: ${code}`);
    return { ok: true, devCode: code };
  }
  // TODO(prod): integrate SMS gateway; never log the code.
  return { ok: true };
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
