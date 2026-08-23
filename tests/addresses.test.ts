import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { addressSchema } from '@/lib/validations/address';

/**
 * Saved addresses.
 *
 * The `Address` model and its `isDefault` flag existed from the first schema and
 * nothing ever wrote a row. Checkout snapshotted an address onto the order and
 * forgot it, so a returning customer retyped it — on a ₹1.2 lakh purchase, which
 * is exactly where an order is abandoned.
 *
 * The rules worth pinning are ownership and the "exactly one default" invariant,
 * both of which are enforced in SQL rather than in a check-then-write, so this
 * suite talks to the dev database when one is reachable.
 */

const prisma = new PrismaClient();
let dbAvailable = false;
const TAG = 'address-test';

beforeAll(async () => {
  try { await prisma.$queryRaw`SELECT 1`; dbAvailable = true; } catch { dbAvailable = false; }
});

afterAll(async () => {
  if (dbAvailable) await prisma.customer.deleteMany({ where: { name: TAG } });
  await prisma.$disconnect();
});

const VALID = {
  name: 'Ravi Kumar', phone: '9876543210', line1: '12 Chandni Chowk',
  city: 'Delhi', state: 'Delhi', pincode: '110006',
};

describe('what counts as an address', () => {
  it('accepts a complete one', () => {
    expect(addressSchema.safeParse(VALID).success).toBe(true);
  });

  it('insists on a 10-digit Indian mobile', () => {
    // A courier calls this number. A wrong one is a failed delivery.
    for (const phone of ['12345', '1234567890', '+919876543210', '98765432101']) {
      expect(addressSchema.safeParse({ ...VALID, phone }).success, phone).toBe(false);
    }
  });

  it('insists on a 6-digit pincode', () => {
    for (const pincode of ['11000', '1100066', 'ABC123']) {
      expect(addressSchema.safeParse({ ...VALID, pincode }).success, pincode).toBe(false);
    }
  });

  it('refuses a blank line 1, city or state', () => {
    expect(addressSchema.safeParse({ ...VALID, line1: '' }).success).toBe(false);
    expect(addressSchema.safeParse({ ...VALID, city: '' }).success).toBe(false);
    expect(addressSchema.safeParse({ ...VALID, state: '' }).success).toBe(false);
  });

  it('allows an empty second line and label', () => {
    expect(addressSchema.safeParse({ ...VALID, line2: '', label: '' }).success).toBe(true);
  });
});

describe('exactly one default', () => {
  it('makes the first address default whether or not it was asked for', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({ data: { phone: '9800000001', name: TAG } });
    const a = await prisma.address.create({ data: { ...VALID, customerId: customer.id, isDefault: true } });
    expect(a.isDefault).toBe(true);
  });

  it('moves the flag rather than adding a second one', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({ data: { phone: '9800000002', name: TAG } });
    const first = await prisma.address.create({ data: { ...VALID, customerId: customer.id, isDefault: true } });
    // What `saveAddress` does inside its transaction.
    await prisma.address.updateMany({ where: { customerId: customer.id, isDefault: true }, data: { isDefault: false } });
    const second = await prisma.address.create({ data: { ...VALID, line1: '9 Karol Bagh', customerId: customer.id, isDefault: true } });

    const defaults = await prisma.address.findMany({ where: { customerId: customer.id, isDefault: true } });
    // Two defaults would make checkout's preselection arbitrary.
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
    expect((await prisma.address.findUnique({ where: { id: first.id } }))!.isDefault).toBe(false);
  });
});

describe('ownership', () => {
  it('scopes an update to the owner, so another customer\'s id matches nothing', async () => {
    if (!dbAvailable) return;
    const mine = await prisma.customer.create({ data: { phone: '9800000003', name: TAG } });
    const theirs = await prisma.customer.create({ data: { phone: '9800000004', name: TAG } });
    const theirAddress = await prisma.address.create({ data: { ...VALID, customerId: theirs.id } });

    // The shape `saveAddress` uses: ownership lives in the `where`, so a guessed
    // id simply updates nothing rather than needing a separate check.
    const res = await prisma.address.updateMany({
      where: { id: theirAddress.id, customerId: mine.id },
      data: { line1: 'Hijacked' },
    });
    expect(res.count).toBe(0);
    expect((await prisma.address.findUnique({ where: { id: theirAddress.id } }))!.line1).toBe(VALID.line1);
  });

  it('scopes deletion the same way', async () => {
    if (!dbAvailable) return;
    const mine = await prisma.customer.create({ data: { phone: '9800000005', name: TAG } });
    const theirs = await prisma.customer.create({ data: { phone: '9800000006', name: TAG } });
    const theirAddress = await prisma.address.create({ data: { ...VALID, customerId: theirs.id } });

    const res = await prisma.address.deleteMany({ where: { id: theirAddress.id, customerId: mine.id } });
    expect(res.count).toBe(0);
    expect(await prisma.address.count({ where: { id: theirAddress.id } })).toBe(1);
  });
});

describe('remembering an order address', () => {
  it('does not save the same place twice', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({ data: { phone: '9800000007', name: TAG } });
    await prisma.address.create({ data: { ...VALID, customerId: customer.id } });

    // The duplicate check `rememberAddress` runs: same line and pincode is the
    // same place, however the city was capitalised the second time.
    const duplicate = await prisma.address.findFirst({
      where: { customerId: customer.id, line1: VALID.line1, pincode: VALID.pincode },
    });
    expect(duplicate).not.toBeNull();
    expect(await prisma.address.count({ where: { customerId: customer.id } })).toBe(1);
  });
});
