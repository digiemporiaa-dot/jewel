/**
 * The one place that decides what the shopper is about to pay.
 *
 * This exists because it did not, and that cost real money: the Total row read
 * the coupon-adjusted figure while the pay button read the undiscounted one, so
 * with a code applied the button advertised ₹2,522 above a Total of ₹2,285. A
 * shopper consents to the figure on the button. Two figures on one screen is not
 * a cosmetic bug.
 *
 * So: every surface that shows or sends an amount — the Total row, the button
 * label, the COD confirmation, the analytics `value` — reads the same
 * `PayableTotals` object. There is no second path to a number.
 *
 * None of this decides *what* anything costs. Pricing lives in lib/pricing.ts,
 * discounting in lib/coupons/. This only chooses which already-computed set of
 * figures applies right now, and it is deliberately pure so that choice is
 * testable without a browser or a database.
 */

/** The cart totals as the server computed them, before any coupon. */
export type SummaryTotals = {
  itemCount: number;
  metalTotal: string;
  makingTotal: string;
  stoneTotal: string;
  /** Flat-priced items, which have no metal or making component of their own. */
  itemPriceTotal: string;
  /** Per-item discounts set on the product, before any coupon code. */
  productDiscountTotal: string;
  taxableTotal: string;
  gstTotal: string;
  itemsTotal: string;
  shipping: string;
  grandTotal: string;
};

/**
 * What a coupon preview reports. Advisory only — the authoritative evaluation
 * runs again when the order is created, which is why the code, never the
 * amount, is what gets submitted.
 */
export type AppliedCoupon = {
  code: string;
  discount: string;
  freeShipping: boolean;
  /** Recomputed on the discounted base, so GST is not charged on money never taken. */
  taxableTotal: string;
  gstTotal: string;
  /** Zero when the coupon grants free shipping. */
  shipping: string;
  grandTotal: string;
};

export type PayableTotals = {
  itemCount: number;
  /**
   * Components before any coupon. Metal + making + stones + flat-priced items,
   * less the product's own discount, equals `taxableBeforeDiscount` — which is
   * why every one of them has a row: a bag of flat-priced pieces would
   * otherwise show ₹0 metal, ₹0 making, and a total out of nowhere.
   */
  metalTotal: string;
  makingTotal: string;
  stoneTotal: string;
  itemPriceTotal: string;
  productDiscountTotal: string;
  taxableBeforeDiscount: string;
  /** Zero when no coupon applies. */
  discount: string;
  discountCode: string | null;
  /** `taxableBeforeDiscount` − `discount`. */
  taxableTotal: string;
  gstTotal: string;
  shipping: string;
  freeShipping: boolean;
  /** The amount the shopper pays. The only figure any button may show. */
  grandTotal: string;
};

function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

/**
 * Resolve the figures to display and charge.
 *
 * With no coupon the server's own totals pass through untouched. With one, the
 * coupon's recomputed taxable value, GST and grand total win — all three, not
 * just the grand total. Showing the pre-discount GST beside a discounted total
 * is the same class of mistake as the button bug: rows that do not add up.
 */
export function resolvePayable(
  summary: SummaryTotals,
  coupon: AppliedCoupon | null
): PayableTotals {
  const base = {
    itemCount: summary.itemCount,
    metalTotal: money(summary.metalTotal),
    makingTotal: money(summary.makingTotal),
    stoneTotal: money(summary.stoneTotal),
    itemPriceTotal: money(summary.itemPriceTotal),
    productDiscountTotal: money(summary.productDiscountTotal),
    taxableBeforeDiscount: money(summary.taxableTotal),
  };

  if (!coupon) {
    return {
      ...base,
      discount: '0.00',
      discountCode: null,
      taxableTotal: money(summary.taxableTotal),
      gstTotal: money(summary.gstTotal),
      shipping: money(summary.shipping),
      freeShipping: Number(summary.shipping) === 0,
      grandTotal: money(summary.grandTotal),
    };
  }

  return {
    ...base,
    discount: money(coupon.discount),
    discountCode: coupon.code,
    taxableTotal: money(coupon.taxableTotal),
    gstTotal: money(coupon.gstTotal),
    shipping: money(coupon.shipping),
    // Free shipping and "shipping was already zero" look identical to the
    // shopper, and both should read "Free" rather than "₹0.00".
    freeShipping: coupon.freeShipping || Number(coupon.shipping) === 0,
    grandTotal: money(coupon.grandTotal),
  };
}

/**
 * Does the visible breakdown actually add up?
 *
 * At these order values shoppers check the arithmetic, and a summary whose rows
 * do not reconcile reads as a mistake even when the total is right. Used by the
 * tests to hold the presentation honest; a tolerance of one paisa absorbs the
 * per-line GST rounding.
 */
export function reconciles(totals: PayableTotals): boolean {
  const components =
    Number(totals.metalTotal) + Number(totals.makingTotal) + Number(totals.stoneTotal) +
    Number(totals.itemPriceTotal) - Number(totals.productDiscountTotal);
  const taxableOk = Math.abs(components - Number(totals.taxableBeforeDiscount)) <= 0.01;

  const net = Number(totals.taxableBeforeDiscount) - Number(totals.discount);
  const netOk = Math.abs(net - Number(totals.taxableTotal)) <= 0.01;

  const grand = Number(totals.taxableTotal) + Number(totals.gstTotal) + Number(totals.shipping);
  const grandOk = Math.abs(grand - Number(totals.grandTotal)) <= 0.01;

  return taxableOk && netOk && grandOk;
}
