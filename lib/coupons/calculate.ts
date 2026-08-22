import Decimal from 'decimal.js';

/**
 * Coupon calculation for jewellery.
 *
 * The rule that drives every decision here: **discounts are given on making
 * charges, almost never on metal.** Metal sells at the live rate with
 * effectively no margin, so "10% off the order total" on a ₹4,00,000 necklace
 * gives away ₹40,000 that is overwhelmingly gold sold at cost. Getting this
 * wrong is the single most expensive mistake available in this codebase.
 *
 * So the discount is computed **per eligible line, on one named component** —
 * never as a percentage of the cart total. Pure and dependency-free apart from
 * decimal.js, so every rule below is directly testable.
 */

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
const money = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export type CouponScope = 'MAKING_CHARGES' | 'METAL_VALUE' | 'STONE_VALUE' | 'ORDER_TOTAL';
export type CouponType = 'PERCENTAGE' | 'FLAT' | 'FREE_SHIPPING';

/** Everything the rules need to know about one cart line. */
export type CouponLine = {
  itemId: string;
  quantity: number;
  /** Per-unit components, as 2dp strings, straight from the price breakup. */
  metalValue: string;
  makingValue: string;
  stoneValue: string;
  /** Per-unit taxable value net of GST — the base for an ORDER_TOTAL coupon. */
  taxableValue: string;
  /** True when the product already carries its own discount. */
  alreadyDiscounted: boolean;
  categoryIds: string[];
  collectionIds: string[];
  metalType: string | null;
  purity: string | null;
  /** Net weight per unit in grams, if the product has one. */
  weightGrams: string | null;
};

export type CouponRules = {
  code: string;
  type: CouponType;
  /** Percentage points for PERCENTAGE, rupees for FLAT. */
  value: string;
  appliesTo: CouponScope;
  minOrder: string | null;
  maxDiscount: string | null;
  categoryIds: string[];
  collectionIds: string[];
  metalTypes: string[];
  purities: string[];
  minWeightGrams: string | null;
  maxWeightGrams: string | null;
  excludeDiscounted: boolean;
};

export type LineDiscount = { itemId: string; base: string; discount: string };

export type CouponCalculation = {
  code: string;
  appliesTo: CouponScope;
  /** Total discount in rupees, applied to the taxable value before GST. */
  discountTotal: string;
  /** The component value the discount was computed from, across eligible lines. */
  eligibleBase: string;
  perLine: LineDiscount[];
  freeShipping: boolean;
  /** Lines that matched every filter. */
  eligibleItemIds: string[];
};

/**
 * Does this line match the coupon's filters?
 *
 * An empty filter array means "no restriction on that dimension". A line has to
 * match **every** non-empty filter — the filters narrow, they do not widen.
 */
export function isLineEligible(line: CouponLine, rules: CouponRules): boolean {
  if (rules.excludeDiscounted && line.alreadyDiscounted) return false;

  if (rules.categoryIds.length > 0 && !line.categoryIds.some((id) => rules.categoryIds.includes(id))) {
    return false;
  }
  if (rules.collectionIds.length > 0 && !line.collectionIds.some((id) => rules.collectionIds.includes(id))) {
    return false;
  }
  if (rules.metalTypes.length > 0 && (!line.metalType || !rules.metalTypes.includes(line.metalType))) {
    return false;
  }
  if (rules.purities.length > 0 && (!line.purity || !rules.purities.includes(line.purity))) {
    return false;
  }

  // Weight bounds compare against the **per-unit** weight: a "above 10g" offer
  // means a 10g piece, not two 5g pieces that happen to add up.
  if (rules.minWeightGrams !== null || rules.maxWeightGrams !== null) {
    if (line.weightGrams === null) return false; // unweighed piece cannot satisfy a weight rule
    const w = new Decimal(line.weightGrams);
    if (rules.minWeightGrams !== null && w.lt(new Decimal(rules.minWeightGrams))) return false;
    if (rules.maxWeightGrams !== null && w.gt(new Decimal(rules.maxWeightGrams))) return false;
  }

  return true;
}

/** The value a coupon of this scope is computed from, for one line (× quantity). */
export function scopeBaseFor(line: CouponLine, scope: CouponScope): Decimal {
  const perUnit = (() => {
    switch (scope) {
      case 'MAKING_CHARGES':
        return new Decimal(line.makingValue || '0');
      case 'METAL_VALUE':
        return new Decimal(line.metalValue || '0');
      case 'STONE_VALUE':
        return new Decimal(line.stoneValue || '0');
      case 'ORDER_TOTAL':
        return new Decimal(line.taxableValue || '0');
    }
  })();
  return money(perUnit.times(line.quantity));
}

/**
 * Compute a coupon against a cart.
 *
 * Returns a discount of zero rather than throwing when nothing is eligible — the
 * caller decides whether that is an error to show the shopper or simply a code
 * that does not apply to what is in the bag.
 *
 * The discount reduces the **taxable value**, so GST is charged on the
 * discounted amount. Discounting after tax would collect GST the store never
 * received.
 */
export function calculateCoupon(lines: CouponLine[], rules: CouponRules): CouponCalculation {
  const eligible = lines.filter((line) => isLineEligible(line, rules));

  if (rules.type === 'FREE_SHIPPING') {
    return {
      code: rules.code,
      appliesTo: rules.appliesTo,
      discountTotal: '0.00',
      eligibleBase: '0.00',
      perLine: [],
      freeShipping: eligible.length > 0,
      eligibleItemIds: eligible.map((l) => l.itemId),
    };
  }

  const bases = eligible.map((line) => ({ line, base: scopeBaseFor(line, rules.appliesTo) }));
  const totalBase = bases.reduce((sum, b) => sum.plus(b.base), new Decimal(0));

  if (totalBase.lte(0)) {
    return {
      code: rules.code,
      appliesTo: rules.appliesTo,
      discountTotal: '0.00',
      eligibleBase: '0.00',
      perLine: [],
      freeShipping: false,
      eligibleItemIds: eligible.map((l) => l.itemId),
    };
  }

  const value = new Decimal(rules.value || '0');
  const perLine: LineDiscount[] = [];
  let discountTotal = new Decimal(0);

  if (rules.type === 'PERCENTAGE') {
    for (const { line, base } of bases) {
      const d = money(base.times(value).div(100));
      perLine.push({ itemId: line.itemId, base: base.toFixed(2), discount: d.toFixed(2) });
      discountTotal = discountTotal.plus(d);
    }
  } else {
    // FLAT: spread across eligible lines in proportion to their base, and never
    // more than the base itself — a ₹5,000 flat coupon cannot take ₹5,000 off
    // ₹2,000 of making charges.
    const capped = Decimal.min(value, totalBase);
    let allocated = new Decimal(0);
    bases.forEach(({ line, base }, index) => {
      const isLast = index === bases.length - 1;
      // The last line takes the remainder so the parts sum to the whole exactly.
      const d = isLast ? capped.minus(allocated) : money(capped.times(base).div(totalBase));
      allocated = allocated.plus(d);
      perLine.push({ itemId: line.itemId, base: base.toFixed(2), discount: d.toFixed(2) });
      discountTotal = discountTotal.plus(d);
    });
  }

  // maxDiscount caps the whole coupon. Scale the per-line amounts down together
  // so they still sum to the capped total.
  if (rules.maxDiscount !== null) {
    const cap = new Decimal(rules.maxDiscount);
    if (discountTotal.gt(cap)) {
      const ratio = cap.div(discountTotal);
      let allocated = new Decimal(0);
      perLine.forEach((row, index) => {
        const isLast = index === perLine.length - 1;
        const d = isLast ? cap.minus(allocated) : money(new Decimal(row.discount).times(ratio));
        allocated = allocated.plus(d);
        row.discount = d.toFixed(2);
      });
      discountTotal = cap;
    }
  }

  return {
    code: rules.code,
    appliesTo: rules.appliesTo,
    discountTotal: money(discountTotal).toFixed(2),
    eligibleBase: totalBase.toFixed(2),
    perLine,
    freeShipping: false,
    eligibleItemIds: eligible.map((l) => l.itemId),
  };
}

// ─── Validity, independent of the cart contents ──────────────────────────────

export type CouponWindow = {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  minOrder: string | null;
};

export type CouponContext = {
  now: Date;
  /** How many times this customer has already redeemed this code. */
  customerUses: number;
  /** How many orders this customer has placed, for `firstOrderOnly`. */
  customerOrderCount: number;
  /** Cart value the `minOrder` threshold is measured against. */
  cartValue: string;
};

export type CouponRejection =
  | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'USAGE_LIMIT_REACHED'
  | 'PER_USER_LIMIT_REACHED' | 'NOT_FIRST_ORDER' | 'BELOW_MIN_ORDER';

export const REJECTION_MESSAGES: Record<CouponRejection, string> = {
  INACTIVE: 'That code is no longer available',
  NOT_STARTED: 'That code is not active yet',
  EXPIRED: 'That code has expired',
  USAGE_LIMIT_REACHED: 'That code has been fully redeemed',
  PER_USER_LIMIT_REACHED: 'You have already used that code',
  NOT_FIRST_ORDER: 'That code is for first orders only',
  BELOW_MIN_ORDER: 'Your bag does not meet the minimum for that code',
};

/**
 * Check the parts of a coupon's validity that do not depend on what is in the
 * bag. Returns null when the coupon is usable.
 *
 * This is re-run at order creation, not only when the code is typed: rates move,
 * carts sit open for hours, and another shopper may have taken the last use in
 * between.
 */
export function checkCouponWindow(window: CouponWindow, ctx: CouponContext): CouponRejection | null {
  if (!window.isActive) return 'INACTIVE';
  if (window.startsAt && ctx.now < window.startsAt) return 'NOT_STARTED';
  if (window.endsAt && ctx.now > window.endsAt) return 'EXPIRED';
  if (window.usageLimit !== null && window.usageCount >= window.usageLimit) return 'USAGE_LIMIT_REACHED';
  if (window.perUserLimit !== null && ctx.customerUses >= window.perUserLimit) return 'PER_USER_LIMIT_REACHED';
  if (window.firstOrderOnly && ctx.customerOrderCount > 0) return 'NOT_FIRST_ORDER';
  if (window.minOrder !== null && new Decimal(ctx.cartValue).lt(new Decimal(window.minOrder))) {
    return 'BELOW_MIN_ORDER';
  }
  return null;
}
