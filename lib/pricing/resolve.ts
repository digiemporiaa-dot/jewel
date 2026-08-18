import 'server-only';
import { prisma } from '@/lib/prisma';
import { calculatePrice, PricingError, type CalculatePriceInput, type PriceBreakup } from '@/lib/pricing';
import { pickMakingRule, toMakingChargeInput, type MakingRuleCandidate } from '@/lib/pricing/making';
import type { Prisma } from '@prisma/client';

/**
 * Server-side price resolution. Loads live rates, resolves the making charge and
 * gathers components from the database, then defers ALL arithmetic to the pure
 * engine in lib/pricing.ts. This is the trusted path used by catalog display,
 * cart and checkout — the browser is never trusted for price (RULE 1 & 2).
 */

const productInclude = {
  category: { select: { id: true } },
  metal: { select: { id: true } },
  purity: { select: { id: true } },
  variants: {
    where: { isActive: true },
    include: {
      diamonds: { include: { diamondRate: true } },
      stones: true,
    },
  },
  diamonds: { include: { diamondRate: true } },
  stones: true,
} satisfies Prisma.ProductInclude;

export type ProductWithPricing = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type Variant = ProductWithPricing['variants'][number];

/** Current ₹/g for a purity, or null if no live rate exists. */
async function getCurrentRatePerGram(purityId: string | null): Promise<string | null> {
  if (!purityId) return null;
  const rate = await prisma.metalRate.findFirst({
    where: { purityId, isCurrent: true },
    orderBy: { effectiveFrom: 'desc' },
    select: { ratePerGram: true },
  });
  return rate ? rate.ratePerGram.toString() : null;
}

async function loadActiveMakingRules(): Promise<MakingRuleCandidate[]> {
  const rules = await prisma.makingChargeRule.findMany({ where: { isActive: true } });
  return rules.map((r) => ({
    id: r.id,
    scope: r.scope,
    type: r.type,
    value: r.value.toString(),
    minCharge: r.minCharge ? r.minCharge.toString() : null,
    priority: r.priority,
    isActive: r.isActive,
    metalId: r.metalId,
    purityId: r.purityId,
    categoryId: r.categoryId,
  }));
}

function buildDiamondInputs(
  productDiamonds: ProductWithPricing['diamonds'],
  variantDiamonds: Variant['diamonds']
) {
  const all = [...productDiamonds, ...variantDiamonds];
  return all
    .map((dia) => {
      const rate = dia.ratePerCarat?.toString() ?? dia.diamondRate?.ratePerCarat.toString() ?? null;
      if (rate === null) return null;
      return { caratWeight: dia.caratWeight.toString(), pieces: dia.pieces, ratePerCarat: rate };
    })
    .filter((x): x is { caratWeight: string; pieces: number; ratePerCarat: string } => x !== null);
}

function buildStoneInputs(
  productStones: ProductWithPricing['stones'],
  variantStones: Variant['stones']
) {
  const all = [...productStones, ...variantStones];
  return all.map((s) => ({
    value: s.value ? s.value.toString() : null,
    ratePerUnit: s.ratePerUnit ? s.ratePerUnit.toString() : null,
    pieces: s.pieces,
  }));
}

export interface VariantPrice {
  variantId: string;
  sku: string;
  label: string | null;
  breakup: PriceBreakup | null;
  error: string | null;
}

export interface ProductPricing {
  productId: string;
  priceFrom: string | null;
  priceTo: string | null;
  variants: VariantPrice[];
  rateUsed: string | null;
}

/**
 * Compute the price breakup for every active variant of a product.
 * Pass `makingRules` when computing in bulk to avoid re-querying.
 */
export function priceProduct(
  product: ProductWithPricing,
  ratePerGram: string | null,
  makingRules: MakingRuleCandidate[]
): ProductPricing {
  const ctx = {
    categoryId: product.category?.id ?? null,
    metalId: product.metal?.id ?? null,
    purityId: product.purity?.id ?? null,
  };
  const contextMakingRule = toMakingChargeInput(pickMakingRule(makingRules, ctx));

  const variants: VariantPrice[] = product.variants.map((variant) => {
    // Explicit variant/product making-rule assignment overrides context resolution.
    const explicitRuleId = variant.makingChargeRuleId ?? product.makingChargeRuleId;
    let making = contextMakingRule;
    if (explicitRuleId) {
      const explicit = makingRules.find((r) => r.id === explicitRuleId);
      if (explicit) making = toMakingChargeInput(explicit);
    }

    const input: CalculatePriceInput = {
      mode: product.pricingMode,
      ratePerGram,
      netWeight: variant.netWeight?.toString() ?? product.netWeight?.toString() ?? null,
      wastagePct: variant.wastagePct?.toString() ?? product.wastagePct.toString(),
      making,
      diamonds: product.pricingMode === 'COMPONENT_BASED' ? buildDiamondInputs(product.diamonds, variant.diamonds) : [],
      stones: product.pricingMode === 'COMPONENT_BASED' ? buildStoneInputs(product.stones, variant.stones) : [],
      fixedPrice: variant.fixedPrice?.toString() ?? product.fixedPrice?.toString() ?? null,
      gstPercent: product.gstPercent.toString(),
      gstInclusive: product.gstInclusive,
    };

    try {
      return { variantId: variant.id, sku: variant.sku, label: variant.label, breakup: calculatePrice(input), error: null };
    } catch (e) {
      const message = e instanceof PricingError ? e.message : 'Unable to calculate price';
      // Observability: log pricing failures (never sensitive data).
      console.error(`[pricing] product=${product.id} variant=${variant.id}: ${message}`);
      return { variantId: variant.id, sku: variant.sku, label: variant.label, breakup: null, error: message };
    }
  });

  const totals = variants
    .map((v) => v.breakup?.unitTotal)
    .filter((t): t is string => !!t)
    .map((t) => Number(t));

  return {
    productId: product.id,
    priceFrom: totals.length ? Math.min(...totals).toFixed(2) : null,
    priceTo: totals.length ? Math.max(...totals).toFixed(2) : null,
    variants,
    rateUsed: ratePerGram,
  };
}

/** Load one product (by id or slug) and compute its full pricing. */
export async function getProductPricing(where: { id?: string; slug?: string }): Promise<ProductPricing | null> {
  const product = await prisma.product.findFirst({
    where: where.id ? { id: where.id } : { slug: where.slug },
    include: productInclude,
  });
  if (!product) return null;
  const [ratePerGram, makingRules] = await Promise.all([
    getCurrentRatePerGram(product.purityId),
    loadActiveMakingRules(),
  ]);
  return priceProduct(product, ratePerGram, makingRules);
}

/**
 * Recompute cached `priceFrom` / `priceTo` for products (all, or a subset).
 * Called after a metal-rate change and by the pricing cron (brief §56).
 * Returns the number of products updated.
 */
export async function recomputeProductPrices(productIds?: string[]): Promise<number> {
  const products = await prisma.product.findMany({
    where: productIds ? { id: { in: productIds } } : {},
    include: productInclude,
  });
  const makingRules = await loadActiveMakingRules();

  // Cache current rates per purity to avoid repeat queries.
  const rateCache = new Map<string, string | null>();
  async function rateFor(purityId: string | null): Promise<string | null> {
    if (!purityId) return null;
    if (rateCache.has(purityId)) return rateCache.get(purityId)!;
    const rate = await getCurrentRatePerGram(purityId);
    rateCache.set(purityId, rate);
    return rate;
  }

  let updated = 0;
  for (const product of products) {
    const rate = await rateFor(product.purityId);
    const pricing = priceProduct(product, rate, makingRules);
    await prisma.product.update({
      where: { id: product.id },
      data: { priceFrom: pricing.priceFrom, priceTo: pricing.priceTo },
    });
    updated += 1;
  }
  return updated;
}

/** Products affected by a change to a given purity's rate (for impact preview). */
export async function productsUsingPurity(purityId: string) {
  return prisma.product.findMany({
    where: { purityId, isActive: true },
    select: { id: true, name: true, sku: true, priceFrom: true, priceTo: true },
  });
}
