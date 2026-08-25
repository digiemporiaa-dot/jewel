'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { checkLimit, LIMITS } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-id';
import { getCustomerId } from '@/lib/customer-session';
import { activeCampaign, publicSegments, spin, type SpinOutcome, type PublicSegment } from '@/lib/spin';
import { SPIN_COOKIE, cookieMaxAgeSeconds, isSuppressedPath, type SpinCookieState } from '@/lib/spin/display';

/**
 * The wheel's server side.
 *
 * The client asks what the prizes are, asks to spin, and is told what it won.
 * It never decides anything: `spin()` picks the segment and mints the coupon,
 * and the animation lands wherever the server said. Letting the browser choose
 * would be a fairness problem and a way to mint yourself a coupon, in that order
 * of how it would be discovered and the reverse order of how much it costs.
 */

const phoneSchema = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');

export type WheelOffer =
  | { available: false }
  | { available: true; name: string; segments: PublicSegment[]; validityDays: number };

/**
 * What to show before anyone spins.
 *
 * `pathname` is checked here as well as in the component: the component's check
 * stops the wheel rendering, this one stops the prize table being fetched at all
 * on a page it must never appear on.
 */
export async function getWheelOffer(pathname: string): Promise<WheelOffer> {
  if (isSuppressedPath(pathname)) return { available: false };

  const campaign = await activeCampaign();
  if (!campaign) return { available: false };

  return {
    available: true,
    name: campaign.name,
    segments: publicSegments(campaign),
    validityDays: campaign.couponValidityDays,
  };
}

export type SpinActionResult = SpinOutcome;

export async function spinAction(rawPhone: string): Promise<SpinActionResult> {
  const parsed = phoneSchema.safeParse(rawPhone);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid number' };
  const phone = parsed.data;

  const campaign = await activeCampaign();
  if (!campaign) return { ok: false, error: 'This offer has closed.' };

  // Cheap throttle before any write. The per-phone and per-IP limits inside
  // `spin` are the real controls; this one just keeps a script from hammering
  // the endpoint.
  const ip = await getClientIp();
  const rl = await checkLimit(`spin:${ip}`, LIMITS.publicAction);
  if (!rl.allowed) return { ok: false, error: 'Too many attempts. Please wait a moment.' };

  // Who is spinning?
  //
  // A signed-in customer spins as themselves. Anyone else gives a number that
  // has not been verified — deliberately, because sending an OTP to open a popup
  // is a bill on every bounce. The prize is locked to the number and checked
  // again at checkout, where it has been through OTP.
  const sessionCustomerId = await getCustomerId();
  const signedInAs = sessionCustomerId
    ? await prisma.customer.findFirst({ where: { id: sessionCustomerId, deletedAt: null }, select: { id: true, phone: true } })
    : null;

  // Checked first, before anything is read or written on the submitted number.
  if (signedInAs && signedInAs.phone !== phone) {
    return { ok: false, error: `You are signed in as ${signedInAs.phone}. Spin with that number, or sign out first.` };
  }

  // Looked up, never created here.
  //
  // The record is created only if the spin actually happens (inside `spin`), so
  // probing the endpoint with a thousand numbers no longer leaves a thousand
  // customer rows behind — the rate limit rejects them before any write.
  //
  // Soft-deleted rows are excluded rather than reused: someone who asked to be
  // erased must not be quietly reattached to the shop by a stranger typing their
  // old number into a popup.
  const existing = signedInAs
    ?? (await prisma.customer.findFirst({ where: { phone, deletedAt: null }, select: { id: true, phone: true, phoneVerified: true } }));

  // An established number is protected.
  //
  // Without this, anyone could type a real customer's number into the wheel and
  // burn the one spin that customer was entitled to — and mint a coupon in their
  // name that they never asked for. Once a number has been through OTP the
  // person holding it can prove it, so they are asked to, and the frictionless
  // path stays open for the new visitors it was designed for.
  if (!signedInAs && existing && 'phoneVerified' in existing && existing.phoneVerified) {
    return {
      ok: false,
      error: 'That number already has an account. Sign in and the wheel will be waiting.',
      needsSignIn: true,
    };
  }

  const outcome = await spin({ campaign, customerId: existing?.id ?? null, phone, ip });

  // Whatever happened, this browser is finished with the wheel — including a
  // loss. Re-offering it after "better luck next time" is the dark pattern the
  // losing segment exists to avoid.
  if (outcome.ok) await setSpinCookie('done');
  else if (outcome.alreadySpun) await setSpinCookie('done');

  return outcome;
}

/**
 * Record the customer's choice. First-party, and no third party is involved.
 *
 * Not exported: every export from a `'use server'` file is a reachable endpoint,
 * and there is no reason to let a caller set this to any value it likes.
 * `dismissWheel` is the one the browser is allowed to ask for.
 */
async function setSpinCookie(state: SpinCookieState): Promise<void> {
  const store = await cookies();
  store.set(SPIN_COOKIE, state, {
    httpOnly: false, // read by the component to decide whether to mount at all
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookieMaxAgeSeconds(state),
  });
}

export async function dismissWheel(): Promise<void> {
  await setSpinCookie('dismissed');
}
