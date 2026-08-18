import { describe, it, expect } from 'vitest';
import { pickMakingRule, toMakingChargeInput, type MakingRuleCandidate } from '@/lib/pricing/making';

const base = { value: '10', minCharge: null, priority: 0, isActive: true };

const RULES: MakingRuleCandidate[] = [
  { id: 'global', scope: 'GLOBAL', type: 'PERCENTAGE', ...base, metalId: null, purityId: null, categoryId: null },
  { id: 'metal-gold', scope: 'METAL', type: 'PERCENTAGE', ...base, metalId: 'gold', purityId: null, categoryId: null },
  { id: 'cat-metal', scope: 'CATEGORY_METAL', type: 'PER_GRAM', ...base, metalId: 'gold', purityId: null, categoryId: 'rings' },
  { id: 'cat-metal-purity', scope: 'CATEGORY_METAL_PURITY', type: 'FLAT', ...base, metalId: 'gold', purityId: '22k', categoryId: 'rings' },
];

describe('making-charge resolution order', () => {
  it('picks the most specific rule (Category+Metal+Purity) when all match', () => {
    const r = pickMakingRule(RULES, { categoryId: 'rings', metalId: 'gold', purityId: '22k' });
    expect(r?.id).toBe('cat-metal-purity');
  });

  it('falls back to Category+Metal when purity does not match', () => {
    const r = pickMakingRule(RULES, { categoryId: 'rings', metalId: 'gold', purityId: '18k' });
    expect(r?.id).toBe('cat-metal');
  });

  it('falls back to Metal when category does not match', () => {
    const r = pickMakingRule(RULES, { categoryId: 'earrings', metalId: 'gold', purityId: '18k' });
    expect(r?.id).toBe('metal-gold');
  });

  it('falls back to Global for an unrelated metal', () => {
    const r = pickMakingRule(RULES, { categoryId: 'earrings', metalId: 'silver', purityId: '925' });
    expect(r?.id).toBe('global');
  });

  it('returns null when not even a global rule exists', () => {
    const noGlobal = RULES.filter((r) => r.scope !== 'GLOBAL');
    const r = pickMakingRule(noGlobal, { categoryId: 'x', metalId: 'silver', purityId: 'y' });
    expect(r).toBeNull();
    expect(toMakingChargeInput(r)).toBeNull();
  });

  it('breaks specificity ties by priority', () => {
    const tie: MakingRuleCandidate[] = [
      { id: 'low', scope: 'METAL', type: 'PERCENTAGE', value: '10', minCharge: null, priority: 1, isActive: true, metalId: 'gold', purityId: null, categoryId: null },
      { id: 'high', scope: 'METAL', type: 'PERCENTAGE', value: '14', minCharge: null, priority: 9, isActive: true, metalId: 'gold', purityId: null, categoryId: null },
    ];
    const r = pickMakingRule(tie, { categoryId: null, metalId: 'gold', purityId: null });
    expect(r?.id).toBe('high');
  });

  it('ignores inactive rules', () => {
    const rules: MakingRuleCandidate[] = [
      { id: 'inactive', scope: 'GLOBAL', type: 'PERCENTAGE', value: '10', minCharge: null, priority: 0, isActive: false, metalId: null, purityId: null, categoryId: null },
    ];
    expect(pickMakingRule(rules, { categoryId: 'x', metalId: 'y', purityId: 'z' })).toBeNull();
  });
});
