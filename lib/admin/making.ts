import 'server-only';
import { prisma } from '@/lib/prisma';
import { calculatePrice } from '@/lib/pricing';
import type { MakingChargeType } from '@prisma/client';

export async function getMakingRules() {
  const [rules, metals, categories, purities] = await Promise.all([
    prisma.makingChargeRule.findMany({
      orderBy: [{ scope: 'asc' }, { priority: 'desc' }],
      include: {
        metal: { select: { name: true } },
        category: { select: { name: true } },
        purity: { select: { name: true } },
      },
    }),
    prisma.metal.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.purity.findMany({ where: { isActive: true }, include: { metal: { select: { name: true } } }, orderBy: { order: 'asc' } }),
  ]);

  return {
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      scope: r.scope,
      type: r.type,
      value: r.value.toString(),
      minCharge: r.minCharge ? r.minCharge.toString() : null,
      priority: r.priority,
      isActive: r.isActive,
      metalName: r.metal?.name ?? null,
      categoryName: r.category?.name ?? null,
      purityName: r.purity?.name ?? null,
    })),
    metals,
    categories,
    purities: purities.map((p) => ({ id: p.id, name: `${p.metal.name} ${p.name}` })),
  };
}

/**
 * Live sample-product preview (brief §32): show the making charge and resulting
 * total for a sample piece, computed by the pricing engine.
 */
export function previewMakingSample(params: {
  type: MakingChargeType;
  value: string;
  minCharge: string | null;
  sampleRatePerGram: string;
  sampleWeight: string;
  gstPercent?: string;
}) {
  const breakup = calculatePrice({
    mode: 'WEIGHT_BASED',
    ratePerGram: params.sampleRatePerGram,
    netWeight: params.sampleWeight,
    gstPercent: params.gstPercent ?? '3',
    making: { type: params.type, value: params.value, minCharge: params.minCharge },
  });
  return {
    metalValue: breakup.metalValue,
    making: breakup.making,
    gst: breakup.gst,
    total: breakup.total,
  };
}
