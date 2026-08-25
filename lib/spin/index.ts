import 'server-only';
import { createHmac, randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { CouponType, CouponScope, Prisma } from '@prisma/client';
import {
  parseSegments, pickSegment, totalWeight, describePrize,
  type SpinSegment, type CouponPrize,
} from '@/lib/spin/segments';

/**
 * Running a spin.
 *
 * The two things that must not move:
 *
 *  1. **The server picks the prize.** The client is told what it won and animates
 *     to that segment. A browser-chosen outcome is both a fairness problem and a
 *     straightforward way to mint yourself a coupon.
 *  2. **A prize is a real Coupon row.** Everything goes through the existing
 *     coupon engine — same validation at checkout, same redemption counting,
 *     same audit trail. A second discount path would be a second place for a
 *     ₹40,000 mistake to live.
 */

/** How many spins one hashed IP may make in a day, whatever numbers it uses. */
const IP_SPINS_PER_DAY = 8;

/**
 * Hash the caller's IP with the app secret.
 *
 * An IP address is personal data under DPDP and nothing here needs the address
 * itself — only whether the same source is spinning repeatedly. The salt is the
 * app secret so the values are not reversible with a rainbow table of the v4
 * space, which an unsalted SHA-256 of an IP very much is.
 */
export function hashIp(ip: string): string {
  const secret = process.env.AUTH_SECRET ?? 'dev-secret';
  return createHmac('sha256', secret).update(`spin-ip:${ip}`).digest('hex');
}

export type ActiveCampaign = {
  id: string;
  name: string;
  segments: SpinSegment[];
  perPhoneLimit: number;
  couponValidityDays: number;
};

/**
 * The one campaign currently running, or null.
 *
 * Malformed segments make a campaign inactive rather than throwing. A prize
 * table edited into an invalid shape directly in the database should take the
 * wheel off the site quietly, not 500 the storefront.
 */
export async function activeCampaign(now = new Date()): Promise<ActiveCampaign | null> {
  const row = await prisma.spinCampaign.findFirst({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  const parsed = parseSegments(row.segments);
  if (!parsed.ok) {
    console.error('[spin] campaign has invalid segments, treating as off', row.id, parsed.error);
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    segments: parsed.segments,
    perPhoneLimit: row.perPhoneLimit,
    couponValidityDays: row.couponValidityDays,
  };
}

/** What the customer is shown before spinning: the prizes and their real odds. */
export type PublicSegment = { label: string; odds: number; terms: string };

export function publicSegments(campaign: ActiveCampaign): PublicSegment[] {
  const total = totalWeight(campaign.segments);
  return campaign.segments.map((s) => ({
    label: s.label,
    // The advertised odds are computed from the same weights the draw uses, so
    // the disclosure cannot drift away from what actually happens.
    odds: Math.round((s.weight / total) * 1000) / 10,
    terms: describePrize(s.prize, campaign.couponValidityDays),
  }));
}

export type SpinOutcome =
  | { ok: true; label: string; won: false }
  | { ok: true; label: string; won: true; code: string; terms: string; expiresAt: string }
  | { ok: false; error: string; alreadySpun?: boolean };

/** Human-readable, unambiguous: no O/0 or I/1 to mistype off a phone screen. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCodeSuffix(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}

async function uniqueCode(): Promise<string> {
  // `code` is unique in the database, so this is a courtesy retry rather than
  // the guarantee — the constraint is.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `SPIN${generateCodeSuffix()}`;
    const clash = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  return `SPIN${generateCodeSuffix(10)}`;
}

const SCOPE_MAP: Record<CouponPrize['appliesTo'], CouponScope> = {
  MAKING_CHARGES: CouponScope.MAKING_CHARGES,
  STONE_VALUE: CouponScope.STONE_VALUE,
};

/**
 * Spin once.
 *
 * `customerId` comes from the caller's session or from a record keyed on the
 * phone they gave. The phone is *not* verified at this point and deliberately
 * so: sending an OTP to open a popup costs the shop money on every bounce. The
 * code is bound to the number instead and checked at checkout, where the number
 * has been through OTP anyway.
 */
export async function spin(params: {
  campaign: ActiveCampaign;
  customerId: string;
  phone: string;
  ip: string;
  now?: Date;
}): Promise<SpinOutcome> {
  const now = params.now ?? new Date();
  const ipHash = hashIp(params.ip);

  // Per phone, via the customer record the phone owns — not per browser session.
  // A cookie is cleared in two clicks; the point of this limit is that it is not.
  const spinsForPhone = await prisma.spinResult.count({
    where: { campaignId: params.campaign.id, customerId: params.customerId },
  });
  if (spinsForPhone >= params.campaign.perPhoneLimit) {
    return { ok: false, error: 'This number has already had its spin.', alreadySpun: true };
  }

  // Second line, not the first. Households and offices share an address, so this
  // is set well above one spin and exists to stop scripted farming rather than
  // to stop a family.
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const spinsFromIp = await prisma.spinResult.count({
    where: { ipHash, createdAt: { gte: dayAgo } },
  });
  if (spinsFromIp >= IP_SPINS_PER_DAY) {
    return { ok: false, error: 'Too many spins from this connection today. Try again tomorrow.' };
  }

  // The draw. `randomInt` is crypto-grade and, taking an integer bound, uniform
  // over [0, total) with no modulo bias.
  const total = totalWeight(params.campaign.segments);
  const segment = pickSegment(params.campaign.segments, randomInt(0, total));
  if (!segment) return { ok: false, error: 'This wheel is not set up correctly.' };

  if (segment.prize.kind === 'NONE') {
    // Recorded anyway. Without losing spins the results screen would report a
    // 100% win rate and the delivered odds could never be checked against the
    // advertised ones.
    await prisma.spinResult.create({
      data: { campaignId: params.campaign.id, customerId: params.customerId, segmentLabel: segment.label, ipHash },
    });
    return { ok: true, label: segment.label, won: false };
  }

  const prize = segment.prize;
  const expiresAt = new Date(now.getTime() + params.campaign.couponValidityDays * 24 * 60 * 60 * 1000);
  const code = await uniqueCode();

  // One transaction: a coupon created without its result row could be won twice,
  // and a result row without its coupon is a prize the customer cannot claim.
  const created = await prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({
      data: {
        code,
        description: `Spin prize — ${segment.label}`,
        type: prize.type === 'PERCENTAGE' ? CouponType.PERCENTAGE : CouponType.FLAT,
        value: new Prisma.Decimal(prize.value),
        // The cap. A percentage without one is unbounded on a jewellery cart.
        maxDiscount: prize.maxDiscount !== null ? new Prisma.Decimal(prize.maxDiscount) : null,
        minOrder: prize.minOrder !== null ? new Prisma.Decimal(prize.minOrder) : null,
        appliesTo: SCOPE_MAP[prize.appliesTo],
        usageLimit: 1,
        perUserLimit: 1,
        startsAt: now,
        endsAt: expiresAt,
        isActive: true,
        // Not stackable: a won code plus a running sale is a discount the shop
        // never agreed to give.
        stackable: false,
        boundPhone: params.phone,
      },
    });
    await tx.spinResult.create({
      data: {
        campaignId: params.campaign.id,
        customerId: params.customerId,
        segmentLabel: segment.label,
        couponId: coupon.id,
        ipHash,
      },
    });
    return coupon;
  });

  return {
    ok: true,
    label: segment.label,
    won: true,
    code: created.code,
    terms: describePrize(prize, params.campaign.couponValidityDays),
    expiresAt: expiresAt.toISOString(),
  };
}
