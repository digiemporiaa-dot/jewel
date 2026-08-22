import { describe, it, expect } from 'vitest';
import {
  calculateCoupon, isLineEligible, scopeBaseFor, checkCouponWindow,
  type CouponLine, type CouponRules, type CouponWindow, type CouponContext,
} from '@/lib/coupons/calculate';

/**
 * A ₹4,00,000 gold necklace: ₹3,60,000 of metal at the live rate, ₹36,000 of
 * making charges, ₹4,000 of stones. The metal carries effectively no margin.
 */
const necklace: CouponLine = {
  itemId: 'line-necklace',
  quantity: 1,
  metalValue: '360000.00',
  makingValue: '36000.00',
  stoneValue: '4000.00',
  taxableValue: '400000.00',
  alreadyDiscounted: false,
  categoryIds: ['cat-necklaces'],
  collectionIds: ['col-bridal'],
  metalType: 'GOLD',
  purity: '22K',
  weightGrams: '45.000',
};

const silverRing: CouponLine = {
  itemId: 'line-ring',
  quantity: 2,
  metalValue: '1500.00',
  makingValue: '500.00',
  stoneValue: '0.00',
  taxableValue: '2000.00',
  alreadyDiscounted: false,
  categoryIds: ['cat-rings'],
  collectionIds: [],
  metalType: 'SILVER',
  purity: '925',
  weightGrams: '8.000',
};

function rules(overrides: Partial<CouponRules> = {}): CouponRules {
  return {
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: '10',
    appliesTo: 'MAKING_CHARGES',
    minOrder: null,
    maxDiscount: null,
    categoryIds: [],
    collectionIds: [],
    metalTypes: [],
    purities: [],
    minWeightGrams: null,
    maxWeightGrams: null,
    excludeDiscounted: false,
    ...overrides,
  };
}

describe('scope — the difference that costs real money', () => {
  it('10% on MAKING_CHARGES discounts the margin, not the gold', () => {
    const result = calculateCoupon([necklace], rules({ appliesTo: 'MAKING_CHARGES' }));
    // 10% of ₹36,000 of making charges.
    expect(result.discountTotal).toBe('3600.00');
    expect(result.eligibleBase).toBe('36000.00');
  });

  it('the same coupon on ORDER_TOTAL gives away eleven times as much', () => {
    const making = calculateCoupon([necklace], rules({ appliesTo: 'MAKING_CHARGES' }));
    const total = calculateCoupon([necklace], rules({ appliesTo: 'ORDER_TOTAL' }));

    expect(total.discountTotal).toBe('40000.00');
    // ₹40,000 against ₹3,600. The extra ₹36,400 comes almost entirely out of
    // gold sold at cost, on a single order. This is why MAKING_CHARGES is the
    // default and why the admin spells the trade-off out.
    const extra = Number(total.discountTotal) - Number(making.discountTotal);
    expect(extra).toBe(36400);
  });

  it('scopes to metal and stone value when asked', () => {
    expect(calculateCoupon([necklace], rules({ appliesTo: 'METAL_VALUE' })).discountTotal).toBe('36000.00');
    expect(calculateCoupon([necklace], rules({ appliesTo: 'STONE_VALUE' })).discountTotal).toBe('400.00');
  });

  it('multiplies the component by quantity', () => {
    // Two rings at ₹500 making each.
    expect(scopeBaseFor(silverRing, 'MAKING_CHARGES').toFixed(2)).toBe('1000.00');
    expect(calculateCoupon([silverRing], rules()).discountTotal).toBe('100.00');
  });
});

describe('eligibility filters narrow, never widen', () => {
  const cart = [necklace, silverRing];

  it('an empty filter set matches everything', () => {
    const r = calculateCoupon(cart, rules());
    expect(r.eligibleItemIds).toEqual(['line-necklace', 'line-ring']);
    // ₹3,600 + ₹100
    expect(r.discountTotal).toBe('3700.00');
  });

  it('category scoping excludes the rest of the bag', () => {
    const r = calculateCoupon(cart, rules({ categoryIds: ['cat-rings'] }));
    expect(r.eligibleItemIds).toEqual(['line-ring']);
    expect(r.discountTotal).toBe('100.00');
  });

  it('collection scoping works the same way', () => {
    const r = calculateCoupon(cart, rules({ collectionIds: ['col-bridal'] }));
    expect(r.eligibleItemIds).toEqual(['line-necklace']);
  });

  it('metal and purity scoping', () => {
    expect(calculateCoupon(cart, rules({ metalTypes: ['SILVER'] })).eligibleItemIds).toEqual(['line-ring']);
    expect(calculateCoupon(cart, rules({ purities: ['22K'] })).eligibleItemIds).toEqual(['line-necklace']);
  });

  it('requires a line to match every non-empty filter, not any of them', () => {
    // Gold AND rings — the necklace is gold but not a ring; the ring is not gold.
    const r = calculateCoupon(cart, rules({ metalTypes: ['GOLD'], categoryIds: ['cat-rings'] }));
    expect(r.eligibleItemIds).toEqual([]);
    expect(r.discountTotal).toBe('0.00');
  });

  it('bounds weight per unit, not per line', () => {
    // "Above 10g" means a 10g piece, not two 8g rings adding up to 16g.
    expect(isLineEligible(silverRing, rules({ minWeightGrams: '10' }))).toBe(false);
    expect(isLineEligible(necklace, rules({ minWeightGrams: '10' }))).toBe(true);
    expect(isLineEligible(necklace, rules({ maxWeightGrams: '20' }))).toBe(false);
    expect(isLineEligible(necklace, rules({ minWeightGrams: '40', maxWeightGrams: '50' }))).toBe(true);
  });

  it('excludes an unweighed piece from a weight-bounded coupon', () => {
    const noWeight = { ...silverRing, weightGrams: null };
    expect(isLineEligible(noWeight, rules({ minWeightGrams: '1' }))).toBe(false);
    // …but it is fine when the coupon has no weight rule at all.
    expect(isLineEligible(noWeight, rules())).toBe(true);
  });

  it('honours excludeDiscounted', () => {
    const onSale = { ...necklace, alreadyDiscounted: true };
    expect(isLineEligible(onSale, rules({ excludeDiscounted: true }))).toBe(false);
    expect(isLineEligible(onSale, rules({ excludeDiscounted: false }))).toBe(true);
  });
});

describe('flat coupons', () => {
  it('spreads across eligible lines in proportion to their base', () => {
    const r = calculateCoupon([necklace, silverRing], rules({ type: 'FLAT', value: '3700' }));
    expect(r.discountTotal).toBe('3700.00');
    // Parts must sum to the whole exactly.
    const summed = r.perLine.reduce((n, l) => n + Number(l.discount), 0);
    expect(summed.toFixed(2)).toBe('3700.00');
  });

  it('never discounts more than the eligible base', () => {
    // ₹5,000 off ₹1,000 of making charges would otherwise pay the shopper.
    const r = calculateCoupon([silverRing], rules({ type: 'FLAT', value: '5000' }));
    expect(r.discountTotal).toBe('1000.00');
    expect(Number(r.discountTotal)).toBeLessThanOrEqual(Number(r.eligibleBase));
  });
});

describe('maxDiscount cap', () => {
  it('caps the total and keeps the per-line parts summing to it', () => {
    const r = calculateCoupon([necklace, silverRing], rules({ value: '50', maxDiscount: '2000' }));
    expect(r.discountTotal).toBe('2000.00');
    const summed = r.perLine.reduce((n, l) => n + Number(l.discount), 0);
    expect(summed.toFixed(2)).toBe('2000.00');
  });

  it('leaves an uncapped coupon alone', () => {
    const r = calculateCoupon([necklace], rules({ maxDiscount: '999999' }));
    expect(r.discountTotal).toBe('3600.00');
  });
});

describe('nothing eligible', () => {
  it('returns zero rather than throwing', () => {
    const r = calculateCoupon([silverRing], rules({ categoryIds: ['cat-nothing'] }));
    expect(r.discountTotal).toBe('0.00');
    expect(r.perLine).toEqual([]);
  });

  it('returns zero when the scoped component is zero', () => {
    // A stone coupon against a piece with no stones.
    const r = calculateCoupon([silverRing], rules({ appliesTo: 'STONE_VALUE' }));
    expect(r.discountTotal).toBe('0.00');
  });

  it('handles an empty cart', () => {
    expect(calculateCoupon([], rules()).discountTotal).toBe('0.00');
  });
});

describe('free shipping', () => {
  it('sets the flag and takes nothing off the lines', () => {
    const r = calculateCoupon([necklace], rules({ type: 'FREE_SHIPPING', value: '0' }));
    expect(r.freeShipping).toBe(true);
    expect(r.discountTotal).toBe('0.00');
  });

  it('does not apply when nothing in the bag is eligible', () => {
    const r = calculateCoupon([silverRing], rules({ type: 'FREE_SHIPPING', categoryIds: ['cat-nothing'] }));
    expect(r.freeShipping).toBe(false);
  });
});

describe('validity window', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  function win(o: Partial<CouponWindow> = {}): CouponWindow {
    return {
      isActive: true, startsAt: null, endsAt: null, usageLimit: null,
      usageCount: 0, perUserLimit: null, firstOrderOnly: false, minOrder: null, ...o,
    };
  }
  function ctx(o: Partial<CouponContext> = {}): CouponContext {
    return { now, customerUses: 0, customerOrderCount: 0, cartValue: '400000.00', ...o };
  }

  it('accepts a live coupon', () => {
    expect(checkCouponWindow(win(), ctx())).toBeNull();
  });

  it('rejects inactive, unstarted and expired codes', () => {
    expect(checkCouponWindow(win({ isActive: false }), ctx())).toBe('INACTIVE');
    expect(checkCouponWindow(win({ startsAt: new Date('2026-07-01') }), ctx())).toBe('NOT_STARTED');
    expect(checkCouponWindow(win({ endsAt: new Date('2026-06-01') }), ctx())).toBe('EXPIRED');
  });

  it('rejects once the usage limit is reached', () => {
    expect(checkCouponWindow(win({ usageLimit: 100, usageCount: 99 }), ctx())).toBeNull();
    expect(checkCouponWindow(win({ usageLimit: 100, usageCount: 100 }), ctx())).toBe('USAGE_LIMIT_REACHED');
  });

  it('enforces the per-user limit', () => {
    expect(checkCouponWindow(win({ perUserLimit: 1 }), ctx({ customerUses: 1 }))).toBe('PER_USER_LIMIT_REACHED');
    expect(checkCouponWindow(win({ perUserLimit: 2 }), ctx({ customerUses: 1 }))).toBeNull();
  });

  it('enforces firstOrderOnly', () => {
    expect(checkCouponWindow(win({ firstOrderOnly: true }), ctx({ customerOrderCount: 1 }))).toBe('NOT_FIRST_ORDER');
    expect(checkCouponWindow(win({ firstOrderOnly: true }), ctx({ customerOrderCount: 0 }))).toBeNull();
  });

  it('enforces the minimum order value', () => {
    expect(checkCouponWindow(win({ minOrder: '500000' }), ctx())).toBe('BELOW_MIN_ORDER');
    expect(checkCouponWindow(win({ minOrder: '400000' }), ctx())).toBeNull();
  });
});
