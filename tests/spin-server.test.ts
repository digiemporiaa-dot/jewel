import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The server side of a spin, with the database stubbed.
 *
 * What is worth pinning here is not "does it return a prize" but the four things
 * that cost money or trust if they are wrong: the coupon that gets created, that
 * a second spin on the same number is refused, that a loss is still recorded, and
 * that the IP hash never contains the address.
 */

vi.mock('server-only', () => ({}));

type CreateArgs = { data: Record<string, unknown> };

const db = {
  spinCampaign: { findFirst: vi.fn() },
  spinResult: {
    count: vi.fn(async () => 0),
    // Typed rather than bare `vi.fn()`, so `mock.calls` carries the argument
    // shape and the assertions below need no casts.
    create: vi.fn(async (_args: CreateArgs) => ({})),
  },
  coupon: {
    findUnique: vi.fn(async () => null as { id: string } | null),
    create: vi.fn(async (args: CreateArgs) => ({ ...args.data, id: 'c1' })),
  },
  $transaction: vi.fn(),
};
vi.mock('@/lib/prisma', () => ({ prisma: db }));

const CAMPAIGN = {
  id: 'camp1',
  name: 'First-order spin',
  perPhoneLimit: 1,
  couponValidityDays: 30,
  segments: [
    { label: '10% off making', weight: 1, prize: { kind: 'COUPON' as const, type: 'PERCENTAGE' as const, appliesTo: 'MAKING_CHARGES' as const, value: 10, maxDiscount: 2000, minOrder: null } },
  ],
};
const LOSING_CAMPAIGN = { ...CAMPAIGN, segments: [{ label: 'Better luck next time', weight: 1, prize: { kind: 'NONE' as const } }] };

beforeEach(() => {
  vi.clearAllMocks();
  db.spinResult.count.mockResolvedValue(0);
  db.coupon.findUnique.mockResolvedValue(null);
  db.coupon.create.mockImplementation(async ({ data }: CreateArgs) => ({ ...data, id: 'c1' }));
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

/** The mocks are untyped by nature; narrow once here rather than at every use. */
function createdCoupon(): Record<string, unknown> {
  const call = db.coupon.create.mock.calls[0];
  if (!call) throw new Error('no coupon was created');
  return call[0].data;
}

function recordedSpin(): Record<string, unknown> {
  const call = db.spinResult.create.mock.calls[0];
  if (!call) throw new Error('no spin was recorded');
  return call[0].data;
}

describe('the coupon a win produces', () => {
  it('is scoped to making charges, capped, single-use and bound to the phone', async () => {
    const { spin } = await import('@/lib/spin');
    const out = await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });

    expect(out.ok).toBe(true);
    const data = createdCoupon();

    expect(data.appliesTo).toBe('MAKING_CHARGES');
    // The cap is the difference between a ₹2,000 promotion and a ₹40,000 one.
    expect(String(data.maxDiscount)).toBe('2000');
    expect(data.usageLimit).toBe(1);
    expect(data.perUserLimit).toBe(1);
    expect(data.boundPhone).toBe('9810012345');
    // A won code stacked on a running sale is a discount nobody agreed to.
    expect(data.stackable).toBe(false);
    expect(data.isActive).toBe(true);
  });

  it('expires after the campaign validity, not never', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const { spin } = await import('@/lib/spin');
    await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4', now });

    const data = createdCoupon();
    expect((data.endsAt as Date).toISOString()).toBe('2026-09-23T00:00:00.000Z');
  });

  it('is created in the same transaction as the result that records it', async () => {
    // A coupon without its result row could be won twice; a result without its
    // coupon is a prize the customer cannot claim.
    const { spin } = await import('@/lib/spin');
    await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('uses a code with no easily-mistyped characters', async () => {
    const { spin } = await import('@/lib/spin');
    const out = await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });
    expect(out.ok && out.won && out.code).toMatch(/^SPIN[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});

describe('one spin per phone', () => {
  it('refuses a second spin on a number that has already had one', async () => {
    db.spinResult.count.mockResolvedValueOnce(1); // per-phone count
    const { spin } = await import('@/lib/spin');
    const out = await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });

    expect(out).toMatchObject({ ok: false, alreadySpun: true });
    // Nothing minted on a refusal.
    expect(db.coupon.create).not.toHaveBeenCalled();
  });

  it('honours a campaign that allows more than one', async () => {
    db.spinResult.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const { spin } = await import('@/lib/spin');
    const out = await spin({
      campaign: { ...CAMPAIGN, perPhoneLimit: 2 },
      customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4',
    });
    expect(out.ok).toBe(true);
  });

  it('stops a connection farming codes across many numbers', async () => {
    db.spinResult.count.mockResolvedValueOnce(0).mockResolvedValueOnce(8); // per-phone, then per-IP
    const { spin } = await import('@/lib/spin');
    const out = await spin({ campaign: CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });

    expect(out.ok).toBe(false);
    expect(db.coupon.create).not.toHaveBeenCalled();
  });
});

describe('a losing spin', () => {
  it('is recorded, so the delivered odds can be checked against the advertised ones', async () => {
    const { spin } = await import('@/lib/spin');
    const out = await spin({ campaign: LOSING_CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });

    expect(out).toMatchObject({ ok: true, won: false });
    expect(db.spinResult.create).toHaveBeenCalledOnce();
    expect(db.coupon.create).not.toHaveBeenCalled();
  });

  it('still counts against the one-spin limit', async () => {
    const { spin } = await import('@/lib/spin');
    await spin({ campaign: LOSING_CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '1.2.3.4' });
    // Recorded against the customer, which is what the per-phone count reads.
    expect(recordedSpin().customerId).toBe('cust1');
  });
});

describe('the stored IP', () => {
  it('is a hash, never the address', async () => {
    const { hashIp } = await import('@/lib/spin');
    const hash = hashIp('203.0.113.42');
    expect(hash).not.toContain('203.0.113.42');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for one address and different for another', async () => {
    const { hashIp } = await import('@/lib/spin');
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'));
  });

  it('is what gets written, not the raw value', async () => {
    const { spin, hashIp } = await import('@/lib/spin');
    await spin({ campaign: LOSING_CAMPAIGN, customerId: 'cust1', phone: '9810012345', ip: '203.0.113.42' });
    expect(recordedSpin().ipHash).toBe(hashIp('203.0.113.42'));
  });
});
