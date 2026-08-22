import { describe, it, expect } from 'vitest';
import {
  resolvePayable, reconciles, type SummaryTotals, type AppliedCoupon,
} from '@/lib/checkout/totals';

/**
 * The figures on the checkout screen.
 *
 * These numbers are the real ones from the bug report: a bag whose Total read
 * ₹2,285 while the pay button advertised ₹2,522.
 */
const SUMMARY: SummaryTotals = {
  itemCount: 1,
  metalTotal: '1650.00',
  makingTotal: '364.00',
  stoneTotal: '204.45',
  itemPriceTotal: '0.00',
  productDiscountTotal: '0.00',
  taxableTotal: '2218.45',
  gstTotal: '66.55',
  itemsTotal: '2285.00',
  shipping: '0.00',
  grandTotal: '2285.00',
};

/** ₹237 off the making charges, with GST recomputed on the reduced base. */
const COUPON: AppliedCoupon = {
  code: 'DIWALI10',
  discount: '237.00',
  freeShipping: false,
  taxableTotal: '1981.45',
  gstTotal: '59.44',
  shipping: '0.00',
  grandTotal: '2040.89',
};

describe('what the shopper pays', () => {
  it('is the plain total when no code is applied', () => {
    expect(resolvePayable(SUMMARY, null).grandTotal).toBe('2285.00');
  });

  it('is the discounted total the moment a code is applied', () => {
    // The defect this replaces: the Total row switched to the coupon figure and
    // the button did not, so the button asked for ₹2,522 against a Total of
    // ₹2,285. A shopper consents to the figure on the button.
    expect(resolvePayable(SUMMARY, COUPON).grandTotal).toBe('2040.89');
  });

  it('never falls back to the undiscounted total', () => {
    const payable = resolvePayable(SUMMARY, COUPON);
    expect(payable.grandTotal).not.toBe(SUMMARY.grandTotal);
  });
});

describe('the GST row moves with the discount', () => {
  it('uses the recomputed GST, not the pre-discount figure', () => {
    // The discount reduces the taxable value before GST, so showing the old GST
    // beside the new total would leave the rows not adding up.
    expect(resolvePayable(SUMMARY, COUPON).gstTotal).toBe('59.44');
    expect(resolvePayable(SUMMARY, null).gstTotal).toBe('66.55');
  });

  it('reports the taxable value net of the discount', () => {
    const payable = resolvePayable(SUMMARY, COUPON);
    expect(payable.taxableBeforeDiscount).toBe('2218.45');
    expect(payable.taxableTotal).toBe('1981.45');
  });
});

describe('the visible rows add up', () => {
  it('reconciles with no coupon', () => {
    expect(reconciles(resolvePayable(SUMMARY, null))).toBe(true);
  });

  it('reconciles with a coupon', () => {
    expect(reconciles(resolvePayable(SUMMARY, COUPON))).toBe(true);
  });

  it('reconciles when shipping is charged', () => {
    const shipped: SummaryTotals = { ...SUMMARY, shipping: '150.00', grandTotal: '2435.00' };
    expect(reconciles(resolvePayable(shipped, null))).toBe(true);
  });

  it('catches a breakdown that does not', () => {
    // Guards the guard: a `reconciles` that returned true for everything would
    // silently stop protecting the summary.
    const wrong = { ...resolvePayable(SUMMARY, null), gstTotal: '999.00' };
    expect(reconciles(wrong)).toBe(false);
  });
});

describe('a bag of flat-priced pieces', () => {
  /**
   * The case the live run caught: a gift set priced at a flat MRP has no metal
   * and no making, so the old summary showed ₹0.00, ₹0.00, GST — and a total
   * ₹899 larger than anything on screen accounted for.
   */
  const FIXED: SummaryTotals = {
    itemCount: 1,
    metalTotal: '0.00',
    makingTotal: '0.00',
    stoneTotal: '0.00',
    itemPriceTotal: '899.00',
    productDiscountTotal: '0.00',
    taxableTotal: '899.00',
    gstTotal: '26.97',
    itemsTotal: '925.97',
    shipping: '150.00',
    grandTotal: '1075.97',
  };

  it('accounts for every rupee of a flat price', () => {
    expect(reconciles(resolvePayable(FIXED, null))).toBe(true);
  });

  it('surfaces the flat price as its own figure', () => {
    expect(resolvePayable(FIXED, null).itemPriceTotal).toBe('899.00');
  });

  it('would not reconcile without that row', () => {
    // Proves the row is load-bearing rather than decorative.
    const withoutRow = { ...resolvePayable(FIXED, null), itemPriceTotal: '0.00' };
    expect(reconciles(withoutRow)).toBe(false);
  });
});

describe('a discount set on the product itself', () => {
  const DISCOUNTED: SummaryTotals = {
    itemCount: 1,
    metalTotal: '1650.00',
    makingTotal: '364.00',
    stoneTotal: '204.45',
    itemPriceTotal: '0.00',
    productDiscountTotal: '218.45',
    taxableTotal: '2000.00',
    gstTotal: '60.00',
    itemsTotal: '2060.00',
    shipping: '0.00',
    grandTotal: '2060.00',
  };

  it('is a separate figure from a coupon code', () => {
    const payable = resolvePayable(DISCOUNTED, null);
    expect(payable.productDiscountTotal).toBe('218.45');
    expect(payable.discount).toBe('0.00');
  });

  it('still reconciles', () => {
    expect(reconciles(resolvePayable(DISCOUNTED, null))).toBe(true);
  });

  it('reconciles alongside a coupon on top of it', () => {
    const stacked: AppliedCoupon = {
      code: 'EXTRA', discount: '100.00', freeShipping: false,
      taxableTotal: '1900.00', gstTotal: '57.00', shipping: '0.00', grandTotal: '1957.00',
    };
    expect(reconciles(resolvePayable(DISCOUNTED, stacked))).toBe(true);
  });
});

describe('shipping', () => {
  it('reads as free when a coupon waives it', () => {
    const freeShip: AppliedCoupon = {
      ...COUPON, freeShipping: true, shipping: '0.00', grandTotal: '2040.89',
    };
    const payable = resolvePayable({ ...SUMMARY, shipping: '150.00' }, freeShip);
    expect(payable.freeShipping).toBe(true);
    expect(payable.shipping).toBe('0.00');
  });

  it('reads as free when there was never a charge', () => {
    // "Free" and "₹0.00" mean the same thing to a shopper; one of them looks
    // like a bug.
    expect(resolvePayable(SUMMARY, null).freeShipping).toBe(true);
  });

  it('is charged when a coupon discounts only the price', () => {
    const payable = resolvePayable({ ...SUMMARY, shipping: '150.00' }, { ...COUPON, shipping: '150.00' });
    expect(payable.freeShipping).toBe(false);
    expect(payable.shipping).toBe('150.00');
  });
});

describe('malformed input', () => {
  it('degrades to zero rather than rendering ₹NaN', () => {
    const broken = { ...SUMMARY, metalTotal: 'not a number' };
    expect(resolvePayable(broken, null).metalTotal).toBe('0.00');
  });

  it('normalises every amount to two decimals', () => {
    const payable = resolvePayable({ ...SUMMARY, makingTotal: '364' }, null);
    expect(payable.makingTotal).toBe('364.00');
  });
});
