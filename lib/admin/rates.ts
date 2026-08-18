import 'server-only';
import { prisma } from '@/lib/prisma';
import { priceProduct } from '@/lib/pricing/resolve';
import type { MakingRuleCandidate } from '@/lib/pricing/making';
import type { Prisma } from '@prisma/client';

const productInclude = {
  category: { select: { id: true } },
  metal: { select: { id: true } },
  purity: { select: { id: true } },
  variants: { where: { isActive: true }, include: { diamonds: { include: { diamondRate: true } }, stones: true } },
  diamonds: { include: { diamondRate: true } },
  stones: true,
} satisfies Prisma.ProductInclude;

export type RateOverview = {
  current: Array<{
    purityId: string;
    metalName: string;
    purityName: string;
    ratePerGram: string;
    effectiveFrom: Date;
  }>;
  history: Array<{
    id: string;
    metalName: string;
    purityName: string;
    ratePerGram: string;
    previousRate: string | null;
    effectiveFrom: Date;
    changedBy: string | null;
  }>;
  diamondRates: Array<{ id: string; label: string; ratePerCarat: string; effectiveFrom: Date }>;
};

export async function getRatesOverview(): Promise<RateOverview> {
  const [current, history, diamondRates] = await Promise.all([
    prisma.metalRate.findMany({
      where: { isCurrent: true },
      include: { purity: { include: { metal: true } } },
      orderBy: [{ purity: { metal: { order: 'asc' } } }, { purity: { order: 'asc' } }],
    }),
    prisma.metalRate.findMany({
      include: { purity: { include: { metal: true } }, changedBy: { select: { name: true } } },
      orderBy: { effectiveFrom: 'desc' },
      take: 15,
    }),
    prisma.diamondRate.findMany({ where: { isCurrent: true }, orderBy: { label: 'asc' } }),
  ]);

  return {
    current: current.map((r) => ({
      purityId: r.purityId,
      metalName: r.purity.metal.name,
      purityName: r.purity.name,
      ratePerGram: r.ratePerGram.toString(),
      effectiveFrom: r.effectiveFrom,
    })),
    history: history.map((r) => ({
      id: r.id,
      metalName: r.purity.metal.name,
      purityName: r.purity.name,
      ratePerGram: r.ratePerGram.toString(),
      previousRate: r.previousRate ? r.previousRate.toString() : null,
      effectiveFrom: r.effectiveFrom,
      changedBy: r.changedBy?.name ?? null,
    })),
    diamondRates: diamondRates.map((d) => ({
      id: d.id,
      label: d.label,
      ratePerCarat: d.ratePerCarat.toString(),
      effectiveFrom: d.effectiveFrom,
    })),
  };
}

export type RateImpact = {
  purityId: string;
  purityLabel: string;
  currentRate: string | null;
  newRate: string;
  productsAffected: number;
  oldAvgPrice: string | null;
  newAvgPrice: string | null;
};

async function loadActiveMakingRules(): Promise<MakingRuleCandidate[]> {
  const rules = await prisma.makingChargeRule.findMany({ where: { isActive: true } });
  return rules.map((r) => ({
    id: r.id, scope: r.scope, type: r.type, value: r.value.toString(),
    minCharge: r.minCharge ? r.minCharge.toString() : null, priority: r.priority,
    isActive: r.isActive, metalId: r.metalId, purityId: r.purityId, categoryId: r.categoryId,
  }));
}

/**
 * Compute the catalogue impact of a hypothetical rate change WITHOUT persisting
 * (brief §31 — show products affected, old avg, new avg, require confirmation).
 */
export async function previewRateChange(purityId: string, newRate: string): Promise<RateImpact> {
  const purity = await prisma.purity.findUnique({
    where: { id: purityId },
    include: { metal: true, rates: { where: { isCurrent: true }, take: 1 } },
  });
  if (!purity) throw new Error('Purity not found');

  const products = await prisma.product.findMany({
    where: { purityId, isActive: true },
    include: productInclude,
  });
  const makingRules = await loadActiveMakingRules();

  const oldTotals: number[] = [];
  const newTotals: number[] = [];
  for (const p of products) {
    const oldPricing = priceProduct(p, purity.rates[0]?.ratePerGram.toString() ?? null, makingRules);
    const newPricing = priceProduct(p, newRate, makingRules);
    if (oldPricing.priceFrom) oldTotals.push(Number(oldPricing.priceFrom));
    if (newPricing.priceFrom) newTotals.push(Number(newPricing.priceFrom));
  }

  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);

  return {
    purityId,
    purityLabel: `${purity.metal.name} ${purity.name}`,
    currentRate: purity.rates[0]?.ratePerGram.toString() ?? null,
    newRate,
    productsAffected: products.length,
    oldAvgPrice: avg(oldTotals),
    newAvgPrice: avg(newTotals),
  };
}

/**
 * Apply a rate change atomically: retire the current rate, insert the new one,
 * recompute affected product prices, and return the affected product ids so the
 * caller can audit. Runs in a transaction.
 */
export async function applyRateChange(
  purityId: string,
  newRate: string,
  changedById: string,
  note?: string
): Promise<{ previousRate: string | null; affected: string[] }> {
  const result = await prisma.$transaction(async (tx) => {
    const currentRate = await tx.metalRate.findFirst({ where: { purityId, isCurrent: true } });
    const previousRate = currentRate?.ratePerGram.toString() ?? null;

    if (currentRate) {
      await tx.metalRate.update({ where: { id: currentRate.id }, data: { isCurrent: false } });
    }
    await tx.metalRate.create({
      data: {
        purityId,
        ratePerGram: newRate,
        previousRate: currentRate?.ratePerGram ?? null,
        isCurrent: true,
        changedById,
        note: note ?? null,
      },
    });

    const affectedProducts = await tx.product.findMany({ where: { purityId }, select: { id: true } });
    return { previousRate, affected: affectedProducts.map((p) => p.id) };
  });

  // Recompute cached prices for affected products (outside the transaction).
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices(result.affected);

  return result;
}

export async function applyDiamondRateChange(
  diamondRateId: string,
  newRate: string,
  changedById: string
): Promise<{ previousRate: string | null }> {
  const existing = await prisma.diamondRate.findUnique({ where: { id: diamondRateId } });
  if (!existing) throw new Error('Diamond rate not found');
  await prisma.diamondRate.update({
    where: { id: diamondRateId },
    data: { previousRate: existing.ratePerCarat, ratePerCarat: newRate },
  });
  // Recompute component-based products (rate is embedded via diamondRate link).
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  const affected = await prisma.product.findMany({
    where: { pricingMode: 'COMPONENT_BASED', diamonds: { some: { diamondRateId } } },
    select: { id: true },
  });
  await recomputeProductPrices(affected.map((p) => p.id));
  return { previousRate: existing.ratePerCarat.toString() };
}
