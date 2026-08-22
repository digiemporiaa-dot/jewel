import { describe, it, expect } from 'vitest';
import {
  monthlyInstalment, emiOption, lowestEmi, allEmiOptions, parseTenures,
  DEFAULT_TENURES, DISCLAIMER, type EmiTenure,
} from '@/lib/emi';

const TENURES: EmiTenure[] = [
  { months: 3, annualRatePercent: 13 },
  { months: 12, annualRatePercent: 14 },
  { months: 24, annualRatePercent: 15 },
];

describe('the EMI formula', () => {
  it('matches the standard reducing-balance calculation', () => {
    // ₹1,00,000 over 12 months at 14%. Cross-checked against an independent
    // computation of P·r·(1+r)^n / ((1+r)^n − 1): ₹8,978.71/month.
    const m = monthlyInstalment('100000', 12, 14);
    expect(Number(m.toFixed(2))).toBeCloseTo(8978.71, 1);
  });

  it('charges more per month over a shorter tenure', () => {
    const short = monthlyInstalment('100000', 3, 13);
    const long = monthlyInstalment('100000', 24, 13);
    expect(Number(short)).toBeGreaterThan(Number(long));
  });

  it('handles 0% no-cost EMI without dividing by zero', () => {
    // A common offer — it must not blow up.
    expect(monthlyInstalment('120000', 12, 0).toFixed(2)).toBe('10000.00');
  });

  it('returns zero for a zero principal and refuses a zero tenure', () => {
    expect(monthlyInstalment('0', 12, 14).toFixed(2)).toBe('0.00');
    expect(() => monthlyInstalment('1000', 0, 14)).toThrow();
  });
});

describe('a quoted option', () => {
  it('rounds the monthly figure up, never below what the bank will charge', () => {
    // Quoting a rupee less than reality is the kind of small lie that turns into
    // a support ticket.
    const exact = monthlyInstalment('100000', 12, 14);
    const quoted = Number(emiOption('100000', { months: 12, annualRatePercent: 14 }).monthly);
    expect(quoted).toBeGreaterThanOrEqual(Number(exact));
  });

  it('reports total payable and interest consistently', () => {
    const o = emiOption('100000', { months: 12, annualRatePercent: 14 });
    expect(Number(o.totalPayable)).toBe(Number(o.monthly) * 12);
    expect(Number(o.interest)).toBe(Number(o.totalPayable) - 100000);
  });

  it('shows no interest on a 0% plan', () => {
    const o = emiOption('120000', { months: 12, annualRatePercent: 0 });
    expect(o.interest).toBe('0');
  });
});

describe('the "from ₹X/month" headline', () => {
  it('picks the lowest monthly instalment across tenures', () => {
    const best = lowestEmi({ amount: '400000', enabled: true, minAmount: null, tenures: TENURES });
    expect(best).not.toBeNull();
    // The longest tenure gives the smallest monthly figure.
    expect(best?.months).toBe(24);

    const all = allEmiOptions({ amount: '400000', enabled: true, minAmount: null, tenures: TENURES });
    expect(Number(best?.monthly)).toBe(Math.min(...all.map((o) => Number(o.monthly))));
  });

  it('is hidden when EMI is switched off', () => {
    expect(lowestEmi({ amount: '400000', enabled: false, minAmount: null, tenures: TENURES })).toBeNull();
  });

  it('is hidden below the bank minimum', () => {
    // Showing an EMI the shopper cannot actually get is worse than showing none.
    expect(lowestEmi({ amount: '4999', enabled: true, minAmount: '5000', tenures: TENURES })).toBeNull();
    expect(lowestEmi({ amount: '5000', enabled: true, minAmount: '5000', tenures: TENURES })).not.toBeNull();
  });

  it('is hidden when no tenures are configured', () => {
    expect(lowestEmi({ amount: '400000', enabled: true, minAmount: null, tenures: [] })).toBeNull();
  });

  it('is hidden for a zero or negative amount', () => {
    expect(lowestEmi({ amount: '0', enabled: true, minAmount: null, tenures: TENURES })).toBeNull();
  });

  it('orders the details panel cheapest monthly first', () => {
    const all = allEmiOptions({ amount: '400000', enabled: true, minAmount: null, tenures: TENURES });
    const monthlies = all.map((o) => Number(o.monthly));
    expect([...monthlies].sort((a, b) => a - b)).toEqual(monthlies);
  });
});

describe('reading the configured tenure table', () => {
  it('accepts a well-formed table', () => {
    expect(parseTenures([{ months: 12, annualRatePercent: 14 }])).toEqual([
      { months: 12, annualRatePercent: 14 },
    ]);
  });

  it('drops malformed rows rather than rendering ₹NaN', () => {
    const parsed = parseTenures([
      { months: 12, annualRatePercent: 14 },
      { months: 'twelve', annualRatePercent: 14 },
      { months: 12 },
      { months: 0, annualRatePercent: 14 },
      { months: 999, annualRatePercent: 14 },
      { months: 6, annualRatePercent: -1 },
      { months: 6, annualRatePercent: 900 },
      null,
      'nonsense',
    ]);
    expect(parsed).toEqual([{ months: 12, annualRatePercent: 14 }]);
  });

  it('returns an empty table for anything that is not an array', () => {
    expect(parseTenures(null)).toEqual([]);
    expect(parseTenures({ months: 12 })).toEqual([]);
    expect(parseTenures(undefined)).toEqual([]);
  });

  it('de-duplicates repeated tenures', () => {
    // Two rates for "12 months" is a configuration mistake; showing both would
    // be worse than picking one.
    const parsed = parseTenures([
      { months: 12, annualRatePercent: 14 },
      { months: 12, annualRatePercent: 18 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.annualRatePercent).toBe(14);
  });

  it('ships a usable default table', () => {
    expect(parseTenures(DEFAULT_TENURES)).toEqual(DEFAULT_TENURES);
  });
});

describe('the disclaimer', () => {
  it('says the figure is indicative and bank-set', () => {
    // Quoting a firm monthly figure the bank then refuses is a support problem
    // and a trust problem, so the caveat is not optional.
    expect(DISCLAIMER.toLowerCase()).toContain('indicative');
    expect(DISCLAIMER.toLowerCase()).toContain('bank');
  });
});
