import 'server-only';
import { createHmac, randomInt } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { CouponType, CouponScope, Prisma } from '@prisma/client';
import {
  parseSegments, pickSegmentIndex, totalWeight, describePrize, ALLOWED_SCOPES,
  resolvePresentation, colourFor, COLOUR_HEX,
  type SpinSegment, type CouponPrize, type ResolvedPresentation, type SegmentColour,
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
  presentation: ResolvedPresentation;
};

/**
 * The one campaign currently running, or null.
 *
 * Malformed segments make a campaign inactive rather than throwing. A prize
 * table edited into an invalid shape directly in the database should take the
 * wheel off the site quietly, not 500 the storefront.
 */
export const SPIN_CAMPAIGN_TAG = 'spin-campaign';

/**
 * The one campaign currently running, or null.
 *
 * Cached under a tag and busted when an admin saves, because the wheel is
 * mounted on every storefront page: without this it is a database query per page
 * view for every visitor who has not yet dismissed it, to answer a question
 * whose answer changes about once a month.
 *
 * The start/end window is applied *outside* the cache. Putting `now` inside a
 * cached function would freeze the comparison at whatever time the entry was
 * written, so a campaign would keep showing after its end date until somebody
 * happened to press save.
 *
 * Malformed segments make a campaign inactive rather than throwing. A prize
 * table edited into an invalid shape directly in the database should take the
 * wheel off the site quietly, not 500 the storefront.
 */
const loadCampaign = unstable_cache(
  async (): Promise<(ActiveCampaign & { startsAt: string | null; endsAt: string | null }) | null> => {
    const row = await prisma.spinCampaign.findFirst({
      where: { isActive: true },
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
      presentation: resolvePresentation(row.presentation),
      // ISO strings, because `unstable_cache` round-trips its result through
      // JSON and a `Date` would come back as a string that fails at `getTime`.
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
    };
  },
  ['spin-campaign'],
  { tags: [SPIN_CAMPAIGN_TAG] }
);

export async function activeCampaign(now = new Date()): Promise<ActiveCampaign | null> {
  const row = await loadCampaign();
  if (!row) return null;
  if (row.startsAt && now < new Date(row.startsAt)) return null;
  if (row.endsAt && now > new Date(row.endsAt)) return null;

  const { startsAt: _s, endsAt: _e, ...campaign } = row;
  return campaign;
}

/** What the customer is shown before spinning: the prizes and their real odds. */
export type PublicSegment = {
  label: string;
  odds: number;
  terms: string;
  /** Resolved to literal hex here so the client never builds a class name. */
  fill: string;
  text: string;
  colour: SegmentColour;
};

export function publicSegments(campaign: ActiveCampaign): PublicSegment[] {
  const total = totalWeight(campaign.segments);
  return campaign.segments.map((s, i) => {
    const colour = colourFor(s, i);
    return {
      label: s.label,
      // The advertised odds are computed from the same weights the draw uses, so
      // the disclosure cannot drift away from what actually happens.
      odds: Math.round((s.weight / total) * 1000) / 10,
      terms: describePrize(s.prize, campaign.couponValidityDays),
      fill: COLOUR_HEX[colour].fill,
      text: COLOUR_HEX[colour].text,
      colour,
    };
  });
}

/**
 * `segmentIndex` is the wheel's position in the campaign's ordered segment
 * list, and it is what the animation is driven from. `label` is for display
 * only: it is not a key, it is not unique, and the moment position was derived
 * from it the pointer could rest on a different prize than the one announced.
 */
export type SpinOutcome =
  | { ok: true; label: string; segmentIndex: number; won: false }
  | { ok: true; label: string; segmentIndex: number; won: true; code: string; terms: string; expiresAt: string }
  | { ok: false; error: string; alreadySpun?: boolean; needsSignIn?: boolean };

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

/**
 * Read a referenced coupon's terms.
 *
 * Returns null rather than throwing when the coupon cannot be used as a prize.
 * The scope is re-checked here, not only when the campaign was saved: a coupon
 * edited in the Coupons screen afterwards must not be able to smuggle an
 * order-total discount onto the wheel.
 */
async function resolveTemplate(couponId: string): Promise<CouponPrize | null> {
  const coupon = await prisma.coupon.findUnique({
    where: { id: couponId },
    select: { isActive: true, type: true, value: true, maxDiscount: true, minOrder: true, appliesTo: true },
  });
  if (!coupon || !coupon.isActive) return null;
  // FREE_SHIPPING has no meaning scoped to making charges.
  if (coupon.type !== 'PERCENTAGE' && coupon.type !== 'FLAT') return null;
  if (!ALLOWED_SCOPES.some((scope) => scope === coupon.appliesTo)) return null;

  const maxDiscount = coupon.maxDiscount !== null ? Number(coupon.maxDiscount) : null;
  // The same rule the inline form enforces: a percentage without a ceiling is
  // unbounded on a jewellery cart, whichever screen it was created on.
  if (coupon.type === 'PERCENTAGE' && maxDiscount === null) return null;

  return {
    kind: 'COUPON',
    type: coupon.type,
    appliesTo: coupon.appliesTo === 'STONE_VALUE' ? 'STONE_VALUE' : 'MAKING_CHARGES',
    value: Number(coupon.value),
    maxDiscount,
    minOrder: coupon.minOrder !== null ? Number(coupon.minOrder) : null,
  };
}

const SCOPE_MAP: Record<CouponPrize['appliesTo'], CouponScope> = {
  MAKING_CHARGES: CouponScope.MAKING_CHARGES,
  STONE_VALUE: CouponScope.STONE_VALUE,
};

/**
 * Spin once.
 *
 * `customerId` is null for a number the shop has never seen. The record is
 * created here, once every limit has passed, rather than by the caller — so
 * probing the endpoint with a thousand numbers leaves nothing behind.
 *
 * The phone is *not* verified at this point and deliberately so: sending an OTP
 * to open a popup costs the shop money on every bounce. The code is bound to the
 * number instead and checked at checkout, where it has been through OTP anyway.
 */
export async function spin(params: {
  campaign: ActiveCampaign;
  customerId: string | null;
  phone: string;
  ip: string;
  now?: Date;
}): Promise<SpinOutcome> {
  const now = params.now ?? new Date();
  const ipHash = hashIp(params.ip);

  // Per phone, via the customer record the phone owns — not per browser session.
  // A cookie is cleared in two clicks; the point of this limit is that it is not.
  // A number with no record has obviously never spun.
  const spinsForPhone = params.customerId
    ? await prisma.spinResult.count({
        where: { campaignId: params.campaign.id, customerId: params.customerId },
      })
    : 0;
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

  // Only now is a record created for a number the shop has never seen. Every
  // limit above has already passed, so this cannot be reached by probing.
  //
  // `upsert` rather than `create`: two spins racing on the same new number would
  // otherwise both insert and one would hit the unique constraint on `phone`.
  const customerId = params.customerId ?? (
    await prisma.customer.upsert({
      where: { phone: params.phone },
      create: { phone: params.phone },
      update: {},
      select: { id: true },
    })
  ).id;

  // The draw. `randomInt` is crypto-grade and, taking an integer bound, uniform
  // over [0, total) with no modulo bias.
  const total = totalWeight(params.campaign.segments);
  // The position, not the segment. It travels to the client as the answer to
  // "which wedge?", so nothing downstream has to work that out from a label.
  const segmentIndex = pickSegmentIndex(params.campaign.segments, randomInt(0, total));
  const segment = segmentIndex >= 0 ? params.campaign.segments[segmentIndex] : undefined;
  if (!segment) return { ok: false, error: 'This wheel is not set up correctly.' };

  if (segment.prize.kind === 'NONE') {
    // Recorded anyway. Without losing spins the results screen would report a
    // 100% win rate and the delivered odds could never be checked against the
    // advertised ones.
    await prisma.spinResult.create({
      data: { campaignId: params.campaign.id, customerId, segmentLabel: segment.label, ipHash },
    });
    return { ok: true, label: segment.label, segmentIndex, won: false };
  }

  // A template segment borrows its terms from a coupon the shop already made.
  // Resolved here, at win time, so editing that coupon changes what the wheel
  // gives out without anyone re-saving the campaign.
  const prize = segment.prize.kind === 'TEMPLATE'
    ? await resolveTemplate(segment.prize.couponId)
    : segment.prize;

  if (!prize) {
    // The referenced coupon was deleted, switched off, or is scoped somewhere a
    // spin prize may not reach. Recorded as a loss rather than crashing or
    // silently handing out something else: the customer has had their spin and
    // the results screen shows a shop exactly what happened.
    console.error('[spin] template coupon unusable, recording as no prize', segment.label);
    await prisma.spinResult.create({
      data: { campaignId: params.campaign.id, customerId, segmentLabel: segment.label, ipHash },
    });
    return { ok: true, label: segment.label, segmentIndex, won: false };
  }

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
        customerId,
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
    segmentIndex,
    won: true,
    code: created.code,
    terms: describePrize(prize, params.campaign.couponValidityDays),
    expiresAt: expiresAt.toISOString(),
  };
}
