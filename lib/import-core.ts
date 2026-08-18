import { parseCsvRecords } from '@/lib/csv';
import type { MetalType, PricingMode, FulfilmentType } from '@prisma/client';

/**
 * Pure CSV-import validation (no database, no server-only). The DB layer in
 * lib/admin/import.ts builds the Lookups from Prisma and calls in here, so the
 * validation rules are unit-testable in isolation.
 */

export const IMPORT_HEADERS = [
  'name', 'slug', 'sku', 'categorySlug', 'pricingMode', 'metalType', 'purityName',
  'metalColor', 'netWeight', 'wastagePct', 'gstPercent', 'fulfilmentType',
  'leadTimeDays', 'fixedPrice', 'stockQty', 'tags', 'occasion', 'shortDescription',
] as const;

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decimal = (v: string) => v === '' || /^\d+(\.\d{1,4})?$/.test(v);
const METAL_TYPES: MetalType[] = ['GOLD', 'SILVER', 'PLATINUM', 'GOLD_PLATED', 'IMITATION'];

export type Lookups = {
  categorySlugs: Map<string, string>;
  metalByType: Map<string, string>;
  purityByKey: Map<string, string>; // `${metalId}|${purityNameLower}` -> id
  existingSkus: Set<string>;
  existingSlugs: Set<string>;
};

export type RowReport = {
  rowNumber: number;
  sku: string;
  name: string;
  status: 'valid' | 'invalid' | 'duplicate';
  errors: string[];
  warnings: string[];
};

export type ImportReport = {
  headers: string[];
  headerErrors: string[];
  processed: number;
  valid: number;
  invalid: number;
  duplicates: number;
  warnings: number;
  rows: RowReport[];
};

export type ResolvedRow = {
  name: string; slug: string; sku: string; categoryId: string; pricingMode: PricingMode;
  metalId: string | null; purityId: string | null; metalColor: string | null;
  netWeight: string | null; wastagePct: string; gstPercent: string; fulfilmentType: FulfilmentType;
  leadTimeDays: number | null; fixedPrice: string | null; stockQty: number; tags: string; occasion: string;
  shortDescription: string | null;
};

export function validateRecord(
  rec: Record<string, string>,
  rowNumber: number,
  look: Lookups,
  seenSku: Set<string>,
  seenSlug: Set<string>
): { report: RowReport; resolved: ResolvedRow | null } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = rec.name ?? '';
  const slug = (rec.slug ?? '').toLowerCase();
  const sku = rec.sku ?? '';
  const mode = (rec.pricingMode ?? '') as PricingMode;
  const categorySlug = rec.categorySlug ?? '';
  const metalType = rec.metalType ?? '';
  const purityName = rec.purityName ?? '';
  const netWeight = rec.netWeight ?? '';
  const wastagePct = rec.wastagePct ?? '';
  const gstPercent = rec.gstPercent ?? '';
  const fixedPrice = rec.fixedPrice ?? '';
  const stockQty = rec.stockQty ?? '';
  const leadTimeDays = rec.leadTimeDays ?? '';

  if (!name || name.length < 2) errors.push('name is required');
  if (!slug) errors.push('slug is required');
  else if (!slugRegex.test(slug)) errors.push('slug must be lowercase-hyphenated');
  if (!sku) errors.push('sku is required');
  if (!['WEIGHT_BASED', 'COMPONENT_BASED', 'FIXED'].includes(mode)) errors.push('pricingMode must be WEIGHT_BASED, COMPONENT_BASED or FIXED');

  const categoryId = look.categorySlugs.get(categorySlug.toLowerCase());
  if (!categoryId) errors.push(`categorySlug "${categorySlug}" not found`);

  let metalId: string | null = null;
  let purityId: string | null = null;
  const isFixed = mode === 'FIXED';

  if (isFixed) {
    if (!fixedPrice || !decimal(fixedPrice) || Number(fixedPrice) <= 0) errors.push('fixedPrice is required and must be > 0 for FIXED');
  } else if (['WEIGHT_BASED', 'COMPONENT_BASED'].includes(mode)) {
    if (!METAL_TYPES.includes(metalType as MetalType)) errors.push(`metalType must be one of ${METAL_TYPES.join(', ')}`);
    else {
      metalId = look.metalByType.get(metalType) ?? null;
      if (!metalId) errors.push(`metalType "${metalType}" is not configured`);
    }
    if (!purityName) errors.push('purityName is required');
    else if (metalId) {
      purityId = look.purityByKey.get(`${metalId}|${purityName.toLowerCase()}`) ?? null;
      if (!purityId) errors.push(`purityName "${purityName}" not found for ${metalType}`);
    }
    if (!netWeight || !decimal(netWeight) || Number(netWeight) <= 0) errors.push('netWeight is required and must be > 0');
    if (wastagePct && !decimal(wastagePct)) errors.push('wastagePct must be a number');
    if (mode === 'COMPONENT_BASED') warnings.push('component pricing imported without diamonds/stones — add them in the product editor');
  }

  if (gstPercent && !decimal(gstPercent)) errors.push('gstPercent must be a number');
  if (stockQty && !/^\d+$/.test(stockQty)) errors.push('stockQty must be a whole number');
  const fulfilmentType = (rec.fulfilmentType || 'READY_TO_SHIP') as FulfilmentType;
  if (!['READY_TO_SHIP', 'MADE_TO_ORDER'].includes(fulfilmentType)) errors.push('fulfilmentType must be READY_TO_SHIP or MADE_TO_ORDER');
  if (fulfilmentType === 'MADE_TO_ORDER' && (!leadTimeDays || !/^\d+$/.test(leadTimeDays))) errors.push('leadTimeDays is required for MADE_TO_ORDER');

  // Duplicate detection (in-file and against the database snapshot).
  let duplicate = false;
  if (sku) {
    if (seenSku.has(sku.toLowerCase()) || look.existingSkus.has(sku.toLowerCase())) { duplicate = true; errors.push(`duplicate SKU "${sku}"`); }
    seenSku.add(sku.toLowerCase());
  }
  if (slug) {
    if (seenSlug.has(slug) || look.existingSlugs.has(slug)) { duplicate = true; errors.push(`duplicate slug "${slug}"`); }
    seenSlug.add(slug);
  }

  const status: RowReport['status'] = duplicate ? 'duplicate' : errors.length ? 'invalid' : 'valid';
  const report: RowReport = { rowNumber, sku, name, status, errors, warnings };

  const resolved: ResolvedRow | null =
    status === 'valid' && categoryId
      ? {
          name, slug, sku, categoryId, pricingMode: mode, metalId, purityId,
          metalColor: rec.metalColor || null,
          netWeight: netWeight || null,
          wastagePct: wastagePct || '0',
          gstPercent: gstPercent || '3',
          fulfilmentType,
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
          fixedPrice: fixedPrice || null,
          stockQty: stockQty ? Number(stockQty) : 0,
          tags: rec.tags || '',
          occasion: rec.occasion || '',
          shortDescription: rec.shortDescription || null,
        }
      : null;

  return { report, resolved };
}

/** Validate a whole CSV against pre-loaded lookups. Pure — writes nothing. */
export function validateCsvAgainst(csv: string, look: Lookups): { report: ImportReport; resolved: ResolvedRow[] } {
  const { headers, records } = parseCsvRecords(csv);
  const headerErrors: string[] = [];
  const required = ['name', 'slug', 'sku', 'categorySlug', 'pricingMode'];
  for (const h of required) if (!headers.includes(h)) headerErrors.push(`Missing required column: ${h}`);

  const seenSku = new Set<string>();
  const seenSlug = new Set<string>();
  const rows: RowReport[] = [];
  const resolved: ResolvedRow[] = [];

  if (headerErrors.length === 0) {
    records.forEach((rec, idx) => {
      const { report, resolved: r } = validateRecord(rec, idx + 2, look, seenSku, seenSlug);
      rows.push(report);
      if (r) resolved.push(r);
    });
  }

  const report: ImportReport = {
    headers,
    headerErrors,
    processed: records.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    invalid: rows.filter((r) => r.status === 'invalid').length,
    duplicates: rows.filter((r) => r.status === 'duplicate').length,
    warnings: rows.reduce((n, r) => n + r.warnings.length, 0),
    rows,
  };
  return { report, resolved };
}
