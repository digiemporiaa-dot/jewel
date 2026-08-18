import 'server-only';
import { prisma } from '@/lib/prisma';
import { validateCsvAgainst, type Lookups, type ImportReport, type ResolvedRow } from '@/lib/import-core';

export { IMPORT_HEADERS } from '@/lib/import-core';
export type { ImportReport, RowReport } from '@/lib/import-core';

async function loadLookups(): Promise<Lookups> {
  const [categories, metals, purities, products] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.metal.findMany({ select: { id: true, type: true } }),
    prisma.purity.findMany({ select: { id: true, name: true, metalId: true } }),
    prisma.product.findMany({ select: { sku: true, slug: true } }),
  ]);
  return {
    categorySlugs: new Map(categories.map((c) => [c.slug.toLowerCase(), c.id])),
    metalByType: new Map(metals.map((m) => [m.type, m.id])),
    purityByKey: new Map(purities.map((p) => [`${p.metalId}|${p.name.toLowerCase()}`, p.id])),
    existingSkus: new Set(products.map((p) => p.sku.toLowerCase())),
    existingSlugs: new Set(products.map((p) => p.slug.toLowerCase())),
  };
}

/** Parse + validate a CSV (dry run). Never writes anything. */
export async function validateImport(csv: string): Promise<{ report: ImportReport; resolved: ResolvedRow[] }> {
  const look = await loadLookups();
  return validateCsvAgainst(csv, look);
}

/**
 * Import: re-validates server-side (never trusts the client) then creates the
 * valid products with a default variant + inventory. Returns the imported count.
 */
export async function runImport(csv: string): Promise<{ imported: number; skipped: number }> {
  const { resolved, report } = await validateImport(csv);
  const importedIds: string[] = [];

  for (const r of resolved) {
    const isFixed = r.pricingMode === 'FIXED';
    const product = await prisma.product.create({
      data: {
        name: r.name, slug: r.slug, sku: r.sku, shortDescription: r.shortDescription,
        category: { connect: { id: r.categoryId } },
        pricingMode: r.pricingMode,
        metal: !isFixed && r.metalId ? { connect: { id: r.metalId } } : undefined,
        purity: !isFixed && r.purityId ? { connect: { id: r.purityId } } : undefined,
        metalColor: r.metalColor,
        netWeight: r.netWeight, wastagePct: r.wastagePct,
        fixedPrice: isFixed ? r.fixedPrice : null,
        gstPercent: r.gstPercent, fulfilmentType: r.fulfilmentType, leadTimeDays: r.leadTimeDays,
        tags: r.tags ? r.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
        occasion: r.occasion ? r.occasion.split(',').map((s) => s.trim()).filter(Boolean) : [],
        isActive: true, publishedAt: new Date(),
        variants: { create: { sku: `${r.sku}-V1`, label: 'Default', inventory: { create: { stockQty: r.stockQty, lowStockThreshold: 2 } } } },
      },
    });
    importedIds.push(product.id);
  }

  if (importedIds.length) {
    const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
    await recomputeProductPrices(importedIds);
  }
  return { imported: importedIds.length, skipped: report.processed - importedIds.length };
}
