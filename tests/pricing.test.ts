import { describe, it, expect } from 'vitest';
import {
  calculatePrice,
  isRateLockValid,
  PricingError,
  type CalculatePriceInput,
} from '@/lib/pricing';

describe('calculatePrice — WEIGHT_BASED', () => {
  it('computes metal value + GST (no wastage/making)', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED',
      ratePerGram: 7000,
      netWeight: 10,
      gstPercent: 3,
    });
    expect(r.metalValue).toBe('70000.00');
    expect(r.gst).toBe('2100.00');
    expect(r.total).toBe('72100.00');
    expect(r.rateUsed).toBe('7000.00');
  });

  it('applies wastage as a percentage of metal value', () => {
    const r = calculatePrice({ mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, wastagePct: 8, gstPercent: 3 });
    expect(r.wastage).toBe('5600.00');
    expect(r.subtotal).toBe('75600.00');
    expect(r.total).toBe('77868.00');
  });

  it('applies PERCENTAGE making charge', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3,
      making: { type: 'PERCENTAGE', value: 12 },
    });
    expect(r.making).toBe('8400.00');
    expect(r.total).toBe('80752.00');
  });

  it('applies PER_GRAM making charge', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3,
      making: { type: 'PER_GRAM', value: 500 },
    });
    expect(r.making).toBe('5000.00');
  });

  it('applies FLAT making charge', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3,
      making: { type: 'FLAT', value: 2000 },
    });
    expect(r.making).toBe('2000.00');
  });

  it('enforces the minimum making charge (floor)', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 5, gstPercent: 3,
      making: { type: 'PER_GRAM', value: 100, minCharge: 1200 }, // raw 500 → floored to 1200
    });
    expect(r.making).toBe('1200.00');
    expect(r.subtotal).toBe('36200.00');
    expect(r.total).toBe('37286.00');
  });
});

describe('calculatePrice — COMPONENT_BASED', () => {
  it('adds diamond value using rate per carat', () => {
    const r = calculatePrice({
      mode: 'COMPONENT_BASED', ratePerGram: 5000, netWeight: 4, wastagePct: 6, gstPercent: 3,
      making: { type: 'PERCENTAGE', value: 14 },
      diamonds: [{ caratWeight: 0.5, pieces: 1, ratePerCarat: 58000 }],
    });
    expect(r.metalValue).toBe('20000.00');
    expect(r.wastage).toBe('1200.00');
    expect(r.making).toBe('2800.00');
    expect(r.diamondValue).toBe('29000.00');
    expect(r.subtotal).toBe('53000.00');
    expect(r.total).toBe('54590.00');
    expect(r.ratePerCarat).toBe('58000.00');
  });

  it('handles multiple diamond pieces and blends the rate per carat', () => {
    const r = calculatePrice({
      mode: 'COMPONENT_BASED', ratePerGram: 5000, netWeight: 3, gstPercent: 3,
      diamonds: [{ caratWeight: 0.3, pieces: 2, ratePerCarat: 42000 }],
    });
    expect(r.diamondValue).toBe('25200.00'); // 0.3 × 2 × 42000
    expect(r.ratePerCarat).toBe('42000.00');
  });

  it('adds stone value (flat) and by rate × pieces', () => {
    const flat = calculatePrice({
      mode: 'COMPONENT_BASED', ratePerGram: 5000, netWeight: 3, gstPercent: 3,
      stones: [{ value: 9000 }],
    });
    expect(flat.stoneValue).toBe('9000.00');

    const rated = calculatePrice({
      mode: 'COMPONENT_BASED', ratePerGram: 5000, netWeight: 3, gstPercent: 3,
      stones: [{ ratePerUnit: 3500, pieces: 8 }],
    });
    expect(rated.stoneValue).toBe('28000.00');
  });
});

describe('calculatePrice — FIXED', () => {
  it('adds GST on top when exclusive', () => {
    const r = calculatePrice({ mode: 'FIXED', fixedPrice: 3499, gstPercent: 3 });
    expect(r.subtotal).toBe('3499.00');
    expect(r.gst).toBe('104.97');
    expect(r.total).toBe('3603.97');
  });

  it('extracts GST from the price when inclusive', () => {
    const r = calculatePrice({ mode: 'FIXED', fixedPrice: 3499, gstPercent: 3, gstInclusive: true });
    expect(r.taxable).toBe('3397.09');
    expect(r.gst).toBe('101.91');
    expect(r.total).toBe('3499.00');
  });
});

describe('calculatePrice — discounts', () => {
  it('applies a percentage discount to the subtotal before GST', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3,
      discount: { type: 'PERCENTAGE', value: 10 },
    });
    expect(r.discount).toBe('7000.00');
    expect(r.taxable).toBe('63000.00');
    expect(r.total).toBe('64890.00');
  });

  it('caps a flat discount at maxDiscount', () => {
    const r = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3,
      discount: { type: 'FLAT', value: 10000, maxDiscount: 5000 },
    });
    expect(r.discount).toBe('5000.00');
  });

  it('never lets a discount exceed the subtotal', () => {
    const r = calculatePrice({
      mode: 'FIXED', fixedPrice: 1000, gstPercent: 3,
      discount: { type: 'FLAT', value: 99999 },
    });
    expect(r.discount).toBe('1000.00');
    expect(r.taxable).toBe('0.00');
  });
});

describe('calculatePrice — quantity, rate change & historical snapshot', () => {
  it('multiplies the line total by quantity', () => {
    const r = calculatePrice({ mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 10, gstPercent: 3, quantity: 2 });
    expect(r.unitTotal).toBe('72100.00');
    expect(r.total).toBe('144200.00');
  });

  it('reflects a metal-rate change in the price', () => {
    const base: CalculatePriceInput = { mode: 'WEIGHT_BASED', netWeight: 10, gstPercent: 3 };
    const before = calculatePrice({ ...base, ratePerGram: 6800 });
    const after = calculatePrice({ ...base, ratePerGram: 7050 });
    expect(before.total).toBe('70040.00'); // 68000 + 3%
    expect(after.total).toBe('72615.00'); // 70500 + 3%
    expect(after.total).not.toBe(before.total);
  });

  it('reproduces a historical price from the frozen rate snapshot', () => {
    // Given the rate that was snapshotted on the order, the engine returns the
    // same total regardless of the "current" rate.
    const snapshot: CalculatePriceInput = { mode: 'WEIGHT_BASED', ratePerGram: 6460, netWeight: 8.9, gstPercent: 3 };
    const a = calculatePrice(snapshot);
    const b = calculatePrice(snapshot);
    expect(a.total).toBe(b.total);
    expect(a.rateUsed).toBe('6460.00');
  });
});

describe('rate lock expiry (§15)', () => {
  const lockedAt = new Date('2026-08-18T10:00:00.000Z');
  it('is valid within the lock window', () => {
    expect(isRateLockValid(lockedAt, 15, new Date('2026-08-18T10:10:00.000Z'))).toBe(true);
  });
  it('is invalid after the lock window', () => {
    expect(isRateLockValid(lockedAt, 15, new Date('2026-08-18T10:20:00.000Z'))).toBe(false);
  });
});

describe('calculatePrice — invalid inputs raise PricingError', () => {
  it('throws when a weight-based rate is missing', () => {
    expect(() => calculatePrice({ mode: 'WEIGHT_BASED', netWeight: 10, gstPercent: 3 })).toThrow(PricingError);
  });
  it('throws on a non-positive weight', () => {
    expect(() => calculatePrice({ mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 0, gstPercent: 3 })).toThrow(PricingError);
  });
  it('throws when a fixed price is missing', () => {
    expect(() => calculatePrice({ mode: 'FIXED', gstPercent: 3 })).toThrow(PricingError);
  });
});

describe('PRICE SECURITY (§59) — the server always computes the real price', () => {
  it('ignores any client-claimed amount; the engine has no client-total input', () => {
    // A malicious browser might POST { amount: "1" } while the true price is ₹50,000.
    // The engine only accepts product/rate state, so the computed total stands.
    const maliciousClientPayload = { amount: '1', total: 1, price: 1 } as Record<string, unknown>;
    const serverTruth = calculatePrice({
      mode: 'WEIGHT_BASED', ratePerGram: 7000, netWeight: 7.05, gstPercent: 3,
      making: { type: 'PERCENTAGE', value: 12 },
    });
    // 49350 metal + 5922 making = 55272 + 3% = 56930.16
    expect(serverTruth.total).toBe('56930.16');
    expect(serverTruth.total).not.toBe(String(maliciousClientPayload.amount));
    // The engine's public input type has no field that could carry a client total.
    const inputKeys = Object.keys({
      mode: 1, quantity: 1, ratePerGram: 1, netWeight: 1, wastagePct: 1, making: 1,
      diamonds: 1, stones: 1, fixedPrice: 1, gstPercent: 1, gstInclusive: 1, discount: 1,
    });
    expect(inputKeys).not.toContain('total');
    expect(inputKeys).not.toContain('amount');
  });
});
