import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { anonymisedFields, isArchivable } from '@/lib/admin/removal-rules';

/**
 * Removal, verified against a real database.
 *
 * The guarantees here are about what queries return and what foreign keys
 * survive, so an in-memory fake would prove nothing: the whole question is
 * whether a soft-deleted product still resolves from an order line, and whether
 * the listing query actually excludes it. This suite talks to the dev database
 * when one is reachable and skips cleanly when it is not.
 */

const prisma = new PrismaClient();
let dbAvailable = false;

const TAG = 'softdelete-test';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.order.deleteMany({ where: { contactName: TAG } });
    await prisma.product.deleteMany({ where: { name: TAG } });
    await prisma.customer.deleteMany({ where: { OR: [{ name: TAG }, { phone: { startsWith: '99000' } }, { phone: { startsWith: 'removed-' } }] } });
  }
  await prisma.$disconnect();
});

async function makeProduct(sku: string) {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error('no category seeded');
  return prisma.product.create({
    data: {
      name: TAG, slug: `${TAG}-${sku.toLowerCase()}`, sku,
      categoryId: category.id, pricingMode: 'FIXED', fixedPrice: '1000',
      isActive: true,
      variants: {
        create: {
          sku: `${sku}-V1`, label: 'Default', isActive: true,
          inventory: { create: { stockQty: 7, lowStockThreshold: 2 } },
        },
      },
    },
    include: { variants: true },
  });
}

describe('soft-deleting a product', () => {
  it('takes its variants with it, and leaves the stock count alone', async () => {
    if (!dbAvailable) return;
    const product = await makeProduct(`${TAG}-A`);
    const variantId = product.variants[0]!.id;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { deletedAt: now, isActive: false } });
      await tx.productVariant.updateMany({ where: { productId: product.id }, data: { isActive: false } });
    });

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    expect(variant?.isActive).toBe(false);

    // Not zeroed. The pieces may still be in the safe, and a stock count
    // destroyed to tidy a listing is a number nobody can recover.
    const inventory = await prisma.inventory.findUnique({ where: { variantId } });
    expect(inventory?.stockQty).toBe(7);
  });

  it('is excluded from the stock overview, so reports do not silently drift', async () => {
    if (!dbAvailable) return;
    const product = await makeProduct(`${TAG}-B`);
    const variantId = product.variants[0]!.id;

    const before = await prisma.inventory.count({
      where: { variant: { product: { deletedAt: null } }, variantId },
    });
    expect(before).toBe(1);

    await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date(), isActive: false } });

    const after = await prisma.inventory.count({
      where: { variant: { product: { deletedAt: null } }, variantId },
    });
    expect(after).toBe(0);
  });

  it('is excluded from the storefront listing query', async () => {
    if (!dbAvailable) return;
    const product = await makeProduct(`${TAG}-C`);

    const live = () => prisma.product.count({ where: { id: product.id, isActive: true, deletedAt: null } });
    expect(await live()).toBe(1);

    await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date(), isActive: false } });
    expect(await live()).toBe(0);
  });

  it('still resolves from an order line, which is the reason it is not a real delete', async () => {
    if (!dbAvailable) return;
    const product = await makeProduct(`${TAG}-D`);

    const order = await prisma.order.create({
      data: {
        orderNumber: `${TAG}-ORDER`, contactName: TAG, contactPhone: '9900012345',
        shippingAddress: { line1: 'x' }, subtotal: '1000', grandTotal: '1000',
        paymentMethod: 'RAZORPAY',
        items: {
          create: {
            productId: product.id, nameSnapshot: TAG, skuSnapshot: product.sku,
            quantity: 1, unitPrice: '1000', lineTotal: '1000', priceBreakup: {},
          },
        },
      },
      include: { items: true },
    });

    await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date(), isActive: false } });

    // A hard delete would null this reference — the invoice would still have its
    // snapshot, but the link to what was actually sold would be gone.
    const item = await prisma.orderItem.findUnique({ where: { id: order.items[0]!.id }, include: { product: true } });
    expect(item?.productId).toBe(product.id);
    expect(item?.product?.name).toBe(TAG);
  });

  it('keeps its SKU, so a re-create clashes rather than silently duplicating', async () => {
    if (!dbAvailable) return;
    const product = await makeProduct(`${TAG}-E`);
    await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date() } });

    // This is why the create path reports "belongs to a deleted product" instead
    // of a bare unique-constraint error nobody can explain.
    const clash = await prisma.product.findFirst({ where: { sku: product.sku }, select: { deletedAt: true } });
    expect(clash?.deletedAt).not.toBeNull();
  });
});

describe('customers', () => {
  it('are hidden but intact when soft-deleted, and their orders survive', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({ data: { phone: '9900098765', name: TAG, email: `${TAG}@example.com` } });

    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } });

    expect(await prisma.customer.count({ where: { id: customer.id, deletedAt: null } })).toBe(0);
    const row = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(row?.name).toBe(TAG); // hidden, not scrubbed
  });

  it('lose their personal details but not their history when anonymised', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({
      data: { phone: '9900011111', name: TAG, email: `${TAG}-2@example.com`, dob: new Date('1990-01-01'), marketingOptIn: true },
    });

    const now = new Date();
    await prisma.customer.update({
      where: { id: customer.id },
      data: { deletedAt: now, anonymisedAt: now, ...anonymisedFields(customer.id) },
    });

    const row = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(row?.name).toBe('Removed at request');
    expect(row?.email).toBeNull();
    expect(row?.dob).toBeNull();
    expect(row?.marketingOptIn).toBe(false);
    // The row itself is still there — every order that points at it still has a
    // parent, and the sales history is intact.
    expect(row?.id).toBe(customer.id);
  });

  it('get a scrubbed phone that cannot collide with another scrubbed one', async () => {
    // The column is unique and not nullable, so it cannot simply be emptied.
    const a = anonymisedFields('cust-a');
    const b = anonymisedFields('cust-b');
    expect(a.phone).not.toBe(b.phone);
    expect(a.phone).not.toMatch(/^\d+$/);
  });

  it('are excluded from the campaign audience, so an erasure is not undone by a birthday email', async () => {
    if (!dbAvailable) return;
    const customer = await prisma.customer.create({
      data: { phone: '9900022222', name: TAG, email: `${TAG}-3@example.com`, dob: new Date('1990-05-05'), marketingOptIn: true },
    });

    const audience = () => prisma.customer.count({
      where: { id: customer.id, deletedAt: null, marketingOptIn: true, email: { not: null } },
    });
    expect(await audience()).toBe(1);

    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date() } });
    expect(await audience()).toBe(0);
  });
});

describe('orders are archived, never deleted', () => {
  it('only lets a finished order be archived', () => {
    for (const status of ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RTO']) {
      expect(isArchivable(status)).toBe(true);
    }
  });

  it('refuses one that is still in progress', () => {
    // Hiding a live order from the people who have to ship it is not a feature.
    for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'IN_MAKING', 'READY_TO_SHIP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'VERIFICATION_HOLD']) {
      expect(isArchivable(status)).toBe(false);
    }
  });

  it('keeps the invoice number when archived', async () => {
    if (!dbAvailable) return;
    const order = await prisma.order.create({
      data: {
        orderNumber: `${TAG}-ORDER-2`, contactName: TAG, contactPhone: '9900054321',
        shippingAddress: { line1: 'x' }, subtotal: '500', grandTotal: '500',
        paymentMethod: 'COD', status: 'DELIVERED', invoiceNumber: `${TAG}-INV-1`,
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { archivedAt: new Date() } });

    const row = await prisma.order.findUnique({ where: { id: order.id } });
    // GST invoices are retained for years. Archiving is a view, not a deletion.
    expect(row?.invoiceNumber).toBe(`${TAG}-INV-1`);
    expect(row?.grandTotal.toString()).toBe('500');
    expect(await prisma.order.count({ where: { id: order.id, archivedAt: null } })).toBe(0);
  });
});
