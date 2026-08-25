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

  // A signed-in customer spins as themselves. Otherwise the number given is
  // looked up or created — unverified, which is why the prize is locked to it
  // and checked again at checkout rather than trusted now. Sending an OTP to
  // open a popup would cost the shop money on every bounce.
  const sessionCustomerId = await getCustomerId();
  const customer = sessionCustomerId
    ? await prisma.customer.findFirst({ where: { id: sessionCustomerId, deletedAt: null }, select: { id: true, phone: true } })
    : null;

  const target = customer
    ? customer
    : await prisma.customer.upsert({
        where: { phone },
        create: { phone },
        update: {},
        select: { id: true, phone: true },
      });

  // A signed-in customer cannot spin on somebody else's number.
  if (customer && customer.phone !== phone) {
    return { ok: false, error: `You are signed in as ${customer.phone}. Spin with that number, or sign out first.` };
  }

  const outcome = await spin({ campaign, customerId: target.id, phone: target.phone, ip });

  // Whatever happened, this browser is finished with the wheel — including a
  // loss. Re-offering it after "better luck next time" is the dark pattern the
  // losing segment exists to avoid.
  if (outcome.ok) await setSpinCookie('done');
  else if (outcome.alreadySpun) await setSpinCookie('done');

  return outcome;
}

/** Record the customer's choice. First-party, and no third party is involved. */
export async function setSpinCookie(state: SpinCookieState): Promise<void> {
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
