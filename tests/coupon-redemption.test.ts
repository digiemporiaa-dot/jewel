import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Concurrent redemption of a coupon's last use.
 *
 * The guarantee comes from Postgres, not from application logic — a conditional
 * `UPDATE … WHERE usageCount < limit` either matches a row or it does not — so
 * an in-memory fake would prove nothing. The suite talks to the dev database
 * when one is reachable and skips cleanly when it is not, so `npm test` stays
 * runnable without Postgres.
 */

const prisma = new PrismaClient();
let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** The exact statement `claimCouponUse` runs for a limited coupon. */
async function claim(id: string, limit: number): Promise<boolean> {
  const res = await prisma.coupon.updateMany({
    where: { id, usageCount: { lt: limit } },
    data: { usageCount: { increment: 1 } },
  });
  return res.count === 1;
}

async function makeCoupon(code: string, usageLimit: number | null, usageCount = 0) {
  return prisma.coupon.create({
    data: {
      code, type: 'PERCENTAGE', value: '10', appliesTo: 'MAKING_CHARGES',
      usageLimit, usageCount, isActive: true,
    },
    select: { id: true },
  });
}

describe('concurrent redemption of the final use', () => {
  it('lets exactly one of ten simultaneous shoppers take the last use', async () => {
    if (!dbAvailable) return;

    const code = `TESTLAST${Date.now()}`;
    const coupon = await makeCoupon(code, 10, 9); // one use left
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => claim(coupon.id, 10)));

      // At jewellery order values one leaked redemption is a ₹50,000 mistake,
      // so "roughly one" is not good enough.
      expect(results.filter(Boolean)).toHaveLength(1);

      const after = await prisma.coupon.findUnique({ where: { id: coupon.id }, select: { usageCount: true } });
      expect(after?.usageCount).toBe(10);
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  }, 30_000);

  it('never lets usageCount exceed the limit under load', async () => {
    if (!dbAvailable) return;

    const code = `TESTLOAD${Date.now()}`;
    const coupon = await makeCoupon(code, 5, 0);
    try {
      const results = await Promise.all(Array.from({ length: 40 }, () => claim(coupon.id, 5)));
      expect(results.filter(Boolean)).toHaveLength(5);

      const after = await prisma.coupon.findUnique({ where: { id: coupon.id }, select: { usageCount: true } });
      expect(after?.usageCount).toBe(5);
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  }, 30_000);

  it('refuses every claim on an already-exhausted coupon', async () => {
    if (!dbAvailable) return;

    const code = `TESTDONE${Date.now()}`;
    const coupon = await makeCoupon(code, 3, 3);
    try {
      const results = await Promise.all([claim(coupon.id, 3), claim(coupon.id, 3)]);
      expect(results.filter(Boolean)).toHaveLength(0);
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  }, 30_000);

  it('lets an unlimited coupon be redeemed freely', async () => {
    if (!dbAvailable) return;

    const code = `TESTFREE${Date.now()}`;
    const coupon = await makeCoupon(code, null, 0);
    try {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          prisma.coupon.update({ where: { id: coupon.id }, data: { usageCount: { increment: 1 } } })
        )
      );
      const after = await prisma.coupon.findUnique({ where: { id: coupon.id }, select: { usageCount: true } });
      expect(after?.usageCount).toBe(8);
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  }, 30_000);
});

describe('stacking', () => {
  it('defaults to not stackable', async () => {
    if (!dbAvailable) return;

    const code = `TESTSTACK${Date.now()}`;
    const coupon = await prisma.coupon.create({
      data: { code, type: 'PERCENTAGE', value: '10' },
      select: { id: true, stackable: true, appliesTo: true },
    });
    try {
      // Two stacked codes on a high-value piece can discount more than the
      // margin on it, so combining has to be opted into deliberately.
      expect(coupon.stackable).toBe(false);
      // And the scope defaults to the margin-bearing component.
      expect(coupon.appliesTo).toBe('MAKING_CHARGES');
    } finally {
      await prisma.coupon.delete({ where: { id: coupon.id } });
    }
  }, 30_000);
});
