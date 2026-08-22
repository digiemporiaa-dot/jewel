import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Concurrent enquiry capture.
 *
 * The guarantee comes from the unique index on `Lead.dedupeKey`, not from
 * application logic: a `findFirst` then `create` would let two clicks landing in
 * the same millisecond both pass the check and both insert. An in-memory fake
 * would prove nothing about that, so this suite talks to the dev database when
 * one is reachable and skips cleanly when it is not.
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

/** What `upsertByDedupeKey` does: insert, and treat a conflict as a repeat. */
async function capture(dedupeKey: string): Promise<'created' | 'repeated'> {
  try {
    await prisma.lead.create({
      data: { dedupeKey, source: 'WHATSAPP', status: 'NEW', notes: 'test' },
    });
    return 'created';
  } catch {
    await prisma.lead.update({ where: { dedupeKey }, data: { touchCount: { increment: 1 } } });
    return 'repeated';
  }
}

describe('capturing the same enquiry many times at once', () => {
  it('creates exactly one lead for twenty simultaneous clicks', async () => {
    if (!dbAvailable) return;

    const key = `whatsapp:test:${Date.now()}`;
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => capture(key)));
      expect(results.filter((r) => r === 'created')).toHaveLength(1);

      const rows = await prisma.lead.findMany({ where: { dedupeKey: key } });
      expect(rows).toHaveLength(1);
      // The repeats are counted, not discarded — a shopper who came back four
      // times is a warmer lead than one who clicked once.
      expect(rows[0]?.touchCount).toBe(20);
    } finally {
      await prisma.lead.deleteMany({ where: { dedupeKey: key } });
    }
  }, 30_000);

  it('keeps two different shoppers apart', async () => {
    if (!dbAvailable) return;

    const stamp = Date.now();
    const a = `whatsapp:s:one:p:${stamp}`;
    const b = `whatsapp:s:two:p:${stamp}`;
    try {
      const results = await Promise.all([capture(a), capture(b), capture(a), capture(b)]);
      expect(results.filter((r) => r === 'created')).toHaveLength(2);
      expect(await prisma.lead.count({ where: { dedupeKey: { in: [a, b] } } })).toBe(2);
    } finally {
      await prisma.lead.deleteMany({ where: { dedupeKey: { in: [a, b] } } });
    }
  }, 30_000);
});

describe('leads a person entered by hand', () => {
  it('are unaffected by the unique index, because their key is null', async () => {
    if (!dbAvailable) return;

    // Postgres exempts NULLs from a UNIQUE index. If it did not, the shop could
    // only ever hold one manually created lead.
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.lead.create({
          data: { source: 'PHONE', status: 'NEW', name: `Manual ${i}`, phone: '+919810000000' },
          select: { id: true },
        })
      )
    );
    try {
      expect(created).toHaveLength(3);
    } finally {
      await prisma.lead.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
    }
  }, 30_000);

  it('may still be stored with no name and no phone', async () => {
    if (!dbAvailable) return;

    // The columns are nullable because an automatically captured enquiry has
    // neither; the admin form is what requires them from staff.
    const lead = await prisma.lead.create({
      data: { source: 'WHATSAPP', status: 'NEW' },
      select: { id: true, name: true, phone: true, touchCount: true },
    });
    try {
      expect(lead.name).toBeNull();
      expect(lead.phone).toBeNull();
      expect(lead.touchCount).toBe(1);
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
    }
  }, 30_000);
});
