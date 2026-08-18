import { cache } from 'react';
import { prisma } from '@/lib/prisma';

export type CurrentRate = {
  purityId: string;
  metalName: string;
  purityName: string;
  ratePerGram: string;
  effectiveFrom: Date;
};

/**
 * Current live metal rates (one per purity), for the storefront rate ticker.
 * Read-only, cached per request. Pricing itself lives in lib/pricing (Phase 2);
 * this is display-only.
 */
export const getCurrentRates = cache(async (): Promise<CurrentRate[]> => {
  try {
    const rates = await prisma.metalRate.findMany({
      where: { isCurrent: true, purity: { isActive: true } },
      include: { purity: { include: { metal: true } } },
      orderBy: [{ purity: { metal: { order: 'asc' } } }, { purity: { order: 'asc' } }],
    });

    return rates.map((r) => ({
      purityId: r.purityId,
      metalName: r.purity.metal.name,
      purityName: r.purity.name,
      ratePerGram: r.ratePerGram.toString(),
      effectiveFrom: r.effectiveFrom,
    }));
  } catch {
    return [];
  }
});
