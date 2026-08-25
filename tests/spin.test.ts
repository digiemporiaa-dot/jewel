import { describe, it, expect } from 'vitest';
import {
  parseSegments, pickSegment, totalWeight, oddsPercent, describePrize,
  segmentsSchema, DEFAULT_SEGMENTS, ALLOWED_SCOPES, type SpinSegment,
} from '@/lib/spin/segments';
import {
  decideDisplay, isSuppressedPath, cookieMaxAgeSeconds, SUPPRESSED_PREFIXES,
  DWELL_MS, DISMISS_DAYS,
} from '@/lib/spin/display';
import { checkCouponWindow, REJECTION_MESSAGES } from '@/lib/coupons/calculate';

const WHEEL: SpinSegment[] = [
  { label: 'A', weight: 10, prize: { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: 10, maxDiscount: 2000, minOrder: null } },
  { label: 'B', weight: 30, prize: { kind: 'COUPON', type: 'FLAT', appliesTo: 'MAKING_CHARGES', value: 500, maxDiscount: null, minOrder: null } },
  { label: 'C', weight: 60, prize: { kind: 'NONE' } },
];

describe('the draw respects the configured weights', () => {
  it('walks the cumulative range so every roll maps to exactly one segment', () => {
    // Boundaries, explicitly. An off-by-one here is a rigged wheel, and it is
    // the kind that looks fine in an eyeball test of a thousand spins.
    expect(pickSegment(WHEEL, 0)?.label).toBe('A');
    expect(pickSegment(WHEEL, 9)?.label).toBe('A');
    expect(pickSegment(WHEEL, 10)?.label).toBe('B');
    expect(pickSegment(WHEEL, 39)?.label).toBe('B');
    expect(pickSegment(WHEEL, 40)?.label).toBe('C');
    expect(pickSegment(WHEEL, 99)?.label).toBe('C');
  });

  it('lands within tolerance of the advertised odds over 100k draws', () => {
    const total = totalWeight(WHEEL);
    const counts = new Map<string, number>();
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      // A deterministic sweep rather than a random one: this asserts the mapping
      // is proportional, which is the property the disclosure depends on.
      const segment = pickSegment(WHEEL, i % total);
      counts.set(segment!.label, (counts.get(segment!.label) ?? 0) + 1);
    }
    for (const segment of WHEEL) {
      const observed = ((counts.get(segment.label) ?? 0) / N) * 100;
      const advertised = oddsPercent(WHEEL, segment);
      expect(Math.abs(observed - advertised), `${segment.label}: ${observed} vs ${advertised}`).toBeLessThan(0.5);
    }
  });

  it('is genuinely random over real draws, within a wide band', () => {
    const total = totalWeight(WHEEL);
    const counts = new Map<string, number>();
    const N = 60_000;
    for (let i = 0; i < N; i++) {
      const segment = pickSegment(WHEEL, Math.floor(Math.random() * total));
      counts.set(segment!.label, (counts.get(segment!.label) ?? 0) + 1);
    }
    // Every segment must actually come up — a prize shown but never awarded is
    // the thing the CCPA guidelines call out.
    for (const segment of WHEEL) {
      expect(counts.get(segment.label) ?? 0, segment.label).toBeGreaterThan(0);
    }
    // 2 percentage points is loose enough not to flake at this N and tight
    // enough to catch a genuinely skewed mapping.
    for (const segment of WHEEL) {
      const observed = ((counts.get(segment.label) ?? 0) / N) * 100;
      expect(Math.abs(observed - oddsPercent(WHEEL, segment)), segment.label).toBeLessThan(2);
    }
  });

  it('clamps a roll outside the range instead of always returning the last segment', () => {
    // Falling through the loop would silently make out-of-range rolls always
    // win the final prize — a rigged wheel produced by an off-by-one.
    expect(pickSegment(WHEEL, -5)?.label).toBe('A');
    expect(pickSegment(WHEEL, 999)?.label).toBe('C');
  });
});

describe('a wheel that would mislead is refused', () => {
  it('rejects a segment nobody can win', () => {
    const parsed = parseSegments([...WHEEL, { label: 'Painted on', weight: 0, prize: { kind: 'NONE' } }]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/winnable/i);
  });

  it('rejects a wheel that always lands on one prize', () => {
    const parsed = parseSegments([
      { label: 'Always', weight: 10, prize: { kind: 'NONE' } },
      { label: 'Never', weight: 0, prize: { kind: 'NONE' } },
    ]);
    expect(parsed.ok).toBe(false);
  });

  it('requires a genuine losing segment', () => {
    const allWin = WHEEL.filter((s) => s.prize.kind === 'COUPON');
    const parsed = parseSegments(allWin);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/wins nothing|believable/i);
  });

  it('needs at least two segments', () => {
    expect(parseSegments([{ label: 'Only', weight: 1, prize: { kind: 'NONE' } }]).ok).toBe(false);
  });

  it('accepts the default wheel shipped to a new campaign', () => {
    const parsed = parseSegments(DEFAULT_SEGMENTS);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
  });
});

describe('a prize cannot be scoped where there is no margin', () => {
  it('only allows making charges and stone value', () => {
    expect([...ALLOWED_SCOPES].sort()).toEqual(['MAKING_CHARGES', 'STONE_VALUE']);
  });

  it('refuses ORDER_TOTAL and METAL_VALUE', () => {
    // 10% of a ₹4,00,000 necklace is ₹40,000, almost none of it margin: gold
    // sells at the live rate. This is the single most expensive mistake this
    // feature could make, so it is refused by the schema, not by a convention.
    for (const scope of ['ORDER_TOTAL', 'METAL_VALUE']) {
      const parsed = parseSegments([
        { label: 'Bad', weight: 1, prize: { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: scope, value: 10, maxDiscount: 2000, minOrder: null } },
        { label: 'Nothing', weight: 1, prize: { kind: 'NONE' } },
      ]);
      expect(parsed.ok, scope).toBe(false);
    }
  });

  it('refuses an uncapped percentage', () => {
    const parsed = parseSegments([
      { label: '10% off', weight: 1, prize: { kind: 'COUPON', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: 10, maxDiscount: null, minOrder: null } },
      { label: 'Nothing', weight: 1, prize: { kind: 'NONE' } },
    ]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/cap|unbounded/i);
  });

  it('allows a flat amount without a cap, because the amount is the cap', () => {
    const parsed = parseSegments([
      { label: '₹500 off', weight: 1, prize: { kind: 'COUPON', type: 'FLAT', appliesTo: 'MAKING_CHARGES', value: 500, maxDiscount: null, minOrder: null } },
      { label: 'Nothing', weight: 1, prize: { kind: 'NONE' } },
    ]);
    expect(parsed.ok).toBe(true);
  });

  it('states the cap in the terms the customer is shown', () => {
    const terms = describePrize(WHEEL[0]!.prize, 30);
    expect(terms).toContain('10% off');
    expect(terms).toContain('making charges');
    expect(terms).toContain('₹2000');
    expect(terms).toContain('30 days');
  });
});

describe('one spin per phone, enforced by the coupon it produces', () => {
  const base = {
    isActive: true, startsAt: null, endsAt: null,
    usageLimit: 1, usageCount: 0, perUserLimit: 1,
    firstOrderOnly: false, minOrder: null,
  };
  const ctx = { now: new Date(), customerUses: 0, customerOrderCount: 0, cartValue: '50000.00' };

  it('accepts the code on the number it was won with', () => {
    expect(checkCouponWindow({ ...base, boundPhone: '9810012345' }, { ...ctx, verifiedPhone: '9810012345' })).toBeNull();
  });

  it('refuses it on any other number', () => {
    expect(checkCouponWindow({ ...base, boundPhone: '9810012345' }, { ...ctx, verifiedPhone: '9810099999' })).toBe('WRONG_PHONE');
  });

  it('refuses it when no number has been verified at all', () => {
    // Fails closed. Otherwise a won code forwarded to a friend works perfectly
    // as long as nobody signs in.
    expect(checkCouponWindow({ ...base, boundPhone: '9810012345' }, { ...ctx, verifiedPhone: null })).toBe('WRONG_PHONE');
    expect(checkCouponWindow({ ...base, boundPhone: '9810012345' }, ctx)).toBe('WRONG_PHONE');
  });

  it('leaves ordinary coupons unaffected', () => {
    expect(checkCouponWindow({ ...base, boundPhone: null }, { ...ctx, verifiedPhone: null })).toBeNull();
  });

  it('tells the customer what went wrong without accusing them', () => {
    expect(REJECTION_MESSAGES.WRONG_PHONE).toMatch(/different mobile number/i);
  });

  it('is single-use once redeemed', () => {
    expect(checkCouponWindow({ ...base, boundPhone: '9810012345', usageCount: 1 }, { ...ctx, verifiedPhone: '9810012345' }))
      .toBe('USAGE_LIMIT_REACHED');
  });

  it('expires on the campaign validity window', () => {
    const yesterday = new Date(Date.now() - 86400000);
    expect(checkCouponWindow({ ...base, boundPhone: null, endsAt: yesterday }, ctx)).toBe('EXPIRED');
  });
});

describe('where the popup may appear', () => {
  const ok = {
    pathname: '/', hasCampaign: true, cookie: null,
    exitIntent: false, msOnPage: DWELL_MS, scrollFraction: 0, isMobile: false,
  } as const;

  it('never shows on the cart or the checkout', () => {
    // An interstitial over a payment flow costs more in abandoned baskets than
    // the coupon earns.
    for (const path of ['/cart', '/checkout', '/checkout/pay', '/CART']) {
      expect(decideDisplay({ ...ok, pathname: path }), path).toEqual({ show: false, because: 'suppressed-path' });
    }
  });

  it('suppresses order, tracking, admin and the signup form too', () => {
    for (const prefix of SUPPRESSED_PREFIXES) {
      expect(isSuppressedPath(prefix), prefix).toBe(true);
      expect(isSuppressedPath(`${prefix}/deeper`), prefix).toBe(true);
    }
  });

  it('does not suppress a path that merely starts with the same letters', () => {
    expect(isSuppressedPath('/cartier-collection')).toBe(false);
    expect(isSuppressedPath('/orders-guide')).toBe(false);
  });

  it('respects a dismissal and a completed spin', () => {
    expect(decideDisplay({ ...ok, cookie: 'dismissed' }).show).toBe(false);
    expect(decideDisplay({ ...ok, cookie: 'done' }).show).toBe(false);
  });

  it('shows nothing when no campaign is running', () => {
    expect(decideDisplay({ ...ok, hasCampaign: false })).toEqual({ show: false, because: 'no-campaign' });
  });

  it('never shows on first paint', () => {
    expect(decideDisplay({ ...ok, msOnPage: 0, scrollFraction: 0 }))
      .toEqual({ show: false, because: 'not-triggered' });
  });

  it('opens on dwell, on scroll depth, or on exit intent', () => {
    expect(decideDisplay({ ...ok, msOnPage: DWELL_MS }).because).toBe('dwell');
    expect(decideDisplay({ ...ok, msOnPage: 0, scrollFraction: 0.5 }).because).toBe('scroll');
    expect(decideDisplay({ ...ok, msOnPage: 0, exitIntent: true }).because).toBe('exit-intent');
  });

  it('ignores exit intent on mobile, where there is no cursor to leave', () => {
    expect(decideDisplay({ ...ok, msOnPage: 0, exitIntent: true, isMobile: true }).show).toBe(false);
  });

  it('pauses for a month on dismissal and forever once spun', () => {
    expect(cookieMaxAgeSeconds('dismissed')).toBe(60 * 60 * 24 * DISMISS_DAYS);
    expect(cookieMaxAgeSeconds('done')).toBeGreaterThan(cookieMaxAgeSeconds('dismissed'));
  });
});

describe('segment parsing is defensive about stored JSON', () => {
  it('rejects anything that is not an array of segments', () => {
    for (const bad of [null, {}, 'segments', 42, [{ label: 'x' }]]) {
      expect(segmentsSchema.safeParse(bad).success).toBe(false);
    }
  });
});
