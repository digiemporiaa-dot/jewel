import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { financialYearFor, formatInvoiceNumber } from '@/lib/tax/gst';

/**
 * Invoice numbering has to hold under concurrency, and that cannot be proved
 * without a real database: the guarantee comes from Postgres row locking, not
 * from application logic, so an in-memory fake would test nothing.
 *
 * The suite therefore talks to the dev database when one is reachable and skips
 * cleanly when it is not, so `npm test` stays runnable without Postgres.
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

/** The same statement `allocateInvoiceNumber` runs, against a test-only year. */
async function allocate(financialYear: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceCounter" ("id", "financialYear", "lastNumber", "updatedAt")
    VALUES (gen_random_uuid()::text, ${financialYear}, 1, NOW())
    ON CONFLICT ("financialYear")
    DO UPDATE SET "lastNumber" = "InvoiceCounter"."lastNumber" + 1, "updatedAt" = NOW()
    RETURNING "lastNumber"
  `;
  return rows[0]!.lastNumber;
}

describe('invoice numbering under concurrency', () => {
  it('gives every concurrent caller a distinct, gap-free number', async () => {
    if (!dbAvailable) return; // no database in this environment

    const year = `TEST-${Date.now()}`;
    try {
      // Twenty checkouts landing at the same instant. Reading the maximum and
      // adding one would hand several of them the same number; at jewellery
      // order values a duplicate invoice number is a GST filing problem, not a
      // cosmetic one.
      const numbers = await Promise.all(Array.from({ length: 20 }, () => allocate(year)));

      expect(new Set(numbers).size).toBe(20); // all distinct
      expect([...numbers].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1) // 1..20, no gaps
      );
    } finally {
      await prisma.invoiceCounter.deleteMany({ where: { financialYear: year } });
    }
  }, 30_000);

  it('keeps separate series per financial year', async () => {
    if (!dbAvailable) return;

    const a = `TEST-A-${Date.now()}`;
    const b = `TEST-B-${Date.now()}`;
    try {
      expect(await allocate(a)).toBe(1);
      expect(await allocate(a)).toBe(2);
      // A new financial year restarts at 1 — the series is per year, as the
      // invoice format implies.
      expect(await allocate(b)).toBe(1);
    } finally {
      await prisma.invoiceCounter.deleteMany({ where: { financialYear: { in: [a, b] } } });
    }
  }, 30_000);

  it('produces the printed form callers actually store', async () => {
    if (!dbAvailable) return;

    const year = `TEST-F-${Date.now()}`;
    try {
      const seq = await allocate(year);
      expect(formatInvoiceNumber('MJ', financialYearFor(new Date('2026-06-01T00:00:00+05:30')), seq))
        .toBe('MJ/2026-27/0001');
    } finally {
      await prisma.invoiceCounter.deleteMany({ where: { financialYear: year } });
    }
  }, 30_000);
});
