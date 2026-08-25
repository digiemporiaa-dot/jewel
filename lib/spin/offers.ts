import 'server-only';
import { prisma } from '@/lib/prisma';
import { describePrize } from '@/lib/spin/segments';

/**
 * The prizes a customer is still holding.
 *
 * The wheel shows a won code once, in a modal, and a modal is a bad place to
 * keep the only copy of something worth money. This puts it somewhere durable:
 * the customer can close the popup, lose the tab or come back next week and
 * still find it.
 *
 * Redeemed and expired codes are left out rather than shown greyed out — an
 * account page listing offers that no longer work is worse than one that lists
 * none.
 */

export type LiveOffer = {
  code: string;
  label: string;
  terms: string;
  expiresAt: Date | null;
};

export async function liveOffersFor(customerId: string, now = new Date()): Promise<LiveOffer[]> {
  const results = await prisma.spinResult.findMany({
    where: {
      customerId,
      coupon: {
        isActive: true,
        // Not yet used. `usageLimit` is 1 on every spin prize, so any use at all
        // means it is spent.
        usageCount: 0,
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      segmentLabel: true,
      coupon: {
        select: { code: true, type: true, value: true, maxDiscount: true, minOrder: true, appliesTo: true, endsAt: true },
      },
    },
  });

  return results.flatMap<LiveOffer>((r) => {
    const c = r.coupon;
    if (!c) return [];
    // `describePrize` is what the wheel showed at the moment of winning, so the
    // wording here matches what the customer remembers reading.
    const daysLeft = c.endsAt
      ? Math.max(0, Math.ceil((c.endsAt.getTime() - now.getTime()) / 86_400_000))
      : 0;
    return [{
      code: c.code,
      label: r.segmentLabel,
      terms: describePrize(
        {
          kind: 'COUPON',
          type: c.type === 'FLAT' ? 'FLAT' : 'PERCENTAGE',
          appliesTo: c.appliesTo === 'STONE_VALUE' ? 'STONE_VALUE' : 'MAKING_CHARGES',
          value: Number(c.value),
          maxDiscount: c.maxDiscount !== null ? Number(c.maxDiscount) : null,
          minOrder: c.minOrder !== null ? Number(c.minOrder) : null,
        },
        daysLeft
      ),
      expiresAt: c.endsAt,
    }];
  });
}
