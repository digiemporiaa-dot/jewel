import Decimal from 'decimal.js';

/**
 * EMI messaging.
 *
 * A ₹70,000–₹4,00,000 order is hard to pay in one UPI transfer, and Indian
 * jewellery shoppers expect to see a monthly figure. But the number shown here
 * is **indicative only**: the bank sets the tenure and the rate at the moment of
 * payment, and quoting a firm monthly figure the bank then refuses is both a
 * support problem and a trust problem. Every surface that renders this must
 * carry the caveat, which is why `DISCLAIMER` lives here rather than being
 * retyped per component.
 *
 * Pure and dependency-free apart from decimal.js, so the arithmetic is testable.
 */

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type EmiTenure = {
  /** Number of monthly instalments. */
  months: number;
  /** Annual interest rate as a percentage, e.g. 13.5. */
  annualRatePercent: number;
};

export type EmiOption = {
  months: number;
  annualRatePercent: number;
  /** Monthly instalment, rounded to the rupee — banks quote whole rupees. */
  monthly: string;
  /** Total repaid across the tenure. */
  totalPayable: string;
  /** Interest component of the total. */
  interest: string;
};

export const DISCLAIMER =
  'Indicative only. Final EMI, tenure and interest are set by your bank at checkout.';

/**
 * Standard reducing-balance EMI.
 *
 *   EMI = P·r·(1+r)^n / ((1+r)^n − 1),  r = annual rate / 12 / 100
 *
 * A zero rate degrades to simple division rather than dividing by zero — 0%
 * "no-cost EMI" is a common offer and must not blow up.
 */
export function monthlyInstalment(
  principal: Decimal.Value,
  months: number,
  annualRatePercent: number
): Decimal {
  const p = new Decimal(principal);
  if (months <= 0) throw new Error('EMI tenure must be at least one month');
  if (p.lte(0)) return new Decimal(0);

  if (annualRatePercent === 0) return p.div(months);

  const r = new Decimal(annualRatePercent).div(12).div(100);
  const growth = r.plus(1).pow(months);
  return p.times(r).times(growth).div(growth.minus(1));
}

/** Build a full option for one tenure. */
export function emiOption(
  principal: Decimal.Value,
  tenure: EmiTenure
): EmiOption {
  const monthly = monthlyInstalment(principal, tenure.months, tenure.annualRatePercent)
    .toDecimalPlaces(0, Decimal.ROUND_UP); // never quote lower than the bank will charge
  const totalPayable = monthly.times(tenure.months);

  return {
    months: tenure.months,
    annualRatePercent: tenure.annualRatePercent,
    monthly: monthly.toFixed(0),
    totalPayable: totalPayable.toFixed(0),
    interest: Decimal.max(totalPayable.minus(principal), 0).toFixed(0),
  };
}

/**
 * The headline "EMI from ₹X/month" figure.
 *
 * The lowest monthly instalment across the configured tenures — which is
 * normally the longest one. Returns null when EMI should not be shown at all:
 * disabled, no tenures configured, or below the bank's minimum.
 */
export function lowestEmi(params: {
  amount: Decimal.Value;
  enabled: boolean;
  minAmount: Decimal.Value | null;
  tenures: EmiTenure[];
}): EmiOption | null {
  if (!params.enabled) return null;
  if (params.tenures.length === 0) return null;

  const amount = new Decimal(params.amount);
  if (amount.lte(0)) return null;
  // Banks impose their own floor; showing an EMI the shopper cannot get is worse
  // than showing none.
  if (params.minAmount !== null && amount.lt(new Decimal(params.minAmount))) return null;

  const options = params.tenures
    .filter((t) => t.months > 0)
    .map((t) => emiOption(amount, t));
  if (options.length === 0) return null;

  return options.reduce((best, o) => (Number(o.monthly) < Number(best.monthly) ? o : best));
}

/** Every configured tenure, cheapest monthly first, for a details panel. */
export function allEmiOptions(params: {
  amount: Decimal.Value;
  enabled: boolean;
  minAmount: Decimal.Value | null;
  tenures: EmiTenure[];
}): EmiOption[] {
  if (!params.enabled || params.tenures.length === 0) return [];
  const amount = new Decimal(params.amount);
  if (amount.lte(0)) return [];
  if (params.minAmount !== null && amount.lt(new Decimal(params.minAmount))) return [];

  return params.tenures
    .filter((t) => t.months > 0)
    .map((t) => emiOption(amount, t))
    .sort((a, b) => Number(a.monthly) - Number(b.monthly));
}

/**
 * Read the tenure table out of the settings JSON column.
 *
 * Anything malformed is dropped rather than rendered: a bad row would otherwise
 * produce `₹NaN/month` on a product page, which reads as a broken site.
 */
export function parseTenures(value: unknown): EmiTenure[] {
  if (!Array.isArray(value)) return [];
  const out: EmiTenure[] = [];

  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const months = Number(r.months);
    const rate = Number(r.annualRatePercent);
    if (!Number.isFinite(months) || months < 1 || months > 120) continue;
    if (!Number.isFinite(rate) || rate < 0 || rate > 60) continue;
    out.push({ months: Math.round(months), annualRatePercent: rate });
  }

  // De-duplicate by tenure, keeping the first — two rates for "12 months" is a
  // configuration mistake, and picking silently is better than showing both.
  const seen = new Set<number>();
  return out.filter((t) => (seen.has(t.months) ? false : (seen.add(t.months), true)));
}

/** Default table for a fresh deployment. Rates are typical, not promised. */
export const DEFAULT_TENURES: EmiTenure[] = [
  { months: 3, annualRatePercent: 13 },
  { months: 6, annualRatePercent: 13 },
  { months: 9, annualRatePercent: 14 },
  { months: 12, annualRatePercent: 14 },
  { months: 18, annualRatePercent: 15 },
  { months: 24, annualRatePercent: 15 },
];
