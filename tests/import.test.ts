import { describe, it, expect } from 'vitest';
import { validateCsvAgainst, type Lookups } from '@/lib/import-core';

const look: Lookups = {
  categorySlugs: new Map([['rings', 'cat-rings'], ['gifting', 'cat-gift']]),
  metalByType: new Map([['GOLD', 'metal-gold'], ['SILVER', 'metal-silver']]),
  purityByKey: new Map([['metal-gold|22k', 'pur-22k'], ['metal-silver|925 silver', 'pur-925']]),
  existingSkus: new Set(['existing-sku']),
  existingSlugs: new Set(['existing-slug']),
};

const HEADER = 'name,slug,sku,categorySlug,pricingMode,metalType,purityName,netWeight,fixedPrice,stockQty';

describe('CSV import validation (dry run)', () => {
  it('accepts a valid weight-based row', () => {
    const csv = `${HEADER}\nGold Ring,gold-ring,RG-1,rings,WEIGHT_BASED,GOLD,22K,3.5,,5`;
    const { report, resolved } = validateCsvAgainst(csv, look);
    expect(report.valid).toBe(1);
    expect(report.invalid).toBe(0);
    expect(resolved[0]?.metalId).toBe('metal-gold');
    expect(resolved[0]?.purityId).toBe('pur-22k');
    expect(resolved[0]?.stockQty).toBe(5);
  });

  it('accepts a valid fixed-price row without metal/purity', () => {
    const csv = `${HEADER}\nGift,gift-pendant,PN-1,gifting,FIXED,,,,999,10`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.valid).toBe(1);
  });

  it('reports missing required columns as header errors', () => {
    const csv = `name,slug\nX,y`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.headerErrors.length).toBeGreaterThan(0);
    expect(report.rows.length).toBe(0);
  });

  it('flags an unknown category', () => {
    const csv = `${HEADER}\nRing,r1,RG-2,unknowncat,WEIGHT_BASED,GOLD,22K,3.5,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.invalid).toBe(1);
    expect(report.rows[0]?.errors.join()).toContain('categorySlug');
  });

  it('flags an unknown purity for the metal', () => {
    const csv = `${HEADER}\nRing,r3,RG-3,rings,WEIGHT_BASED,GOLD,18K,3.5,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.rows[0]?.errors.join()).toContain('purityName');
  });

  it('requires fixedPrice for FIXED and rejects zero', () => {
    const csv = `${HEADER}\nGift,g2,PN-2,gifting,FIXED,,,,0,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.invalid).toBe(1);
    expect(report.rows[0]?.errors.join()).toContain('fixedPrice');
  });

  it('detects duplicate SKUs within the file', () => {
    const csv = `${HEADER}\nA,slug-a,DUP,rings,WEIGHT_BASED,GOLD,22K,3,,1\nB,slug-b,DUP,rings,WEIGHT_BASED,GOLD,22K,3,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.duplicates).toBe(1); // the second occurrence
  });

  it('detects duplicates against existing database rows', () => {
    const csv = `${HEADER}\nA,existing-slug,NEW-SKU,rings,WEIGHT_BASED,GOLD,22K,3,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.duplicates).toBe(1);
    expect(report.rows[0]?.errors.join()).toContain('duplicate slug');
  });

  it('warns on component pricing without components', () => {
    const csv = `${HEADER}\nRing,cr,RG-C,rings,COMPONENT_BASED,GOLD,22K,3.5,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.warnings).toBe(1);
    expect(report.valid).toBe(1); // still importable
  });

  it('requires a positive net weight for weight-based pricing', () => {
    const csv = `${HEADER}\nRing,rw,RG-W,rings,WEIGHT_BASED,GOLD,22K,0,,1`;
    const { report } = validateCsvAgainst(csv, look);
    expect(report.rows[0]?.errors.join()).toContain('netWeight');
  });
});
