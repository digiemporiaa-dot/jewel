import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { anonymisedFields, isArchivable } from '@/lib/admin/removal-rules';

// Re-exported so callers have one import for removal, while the rules stay in a
// module tests can reach without `server-only` in the way.
export { anonymisedFields, isArchivable };

/**
 * Removal, done in the only way an e-commerce system can afford.
 *
 * The rule this file exists to enforce: **nothing with financial history is ever
 * hard-deleted.** Not because deletes are frightening, but because of what
 * breaks. GST invoices have to be retained for years. Deleting a customer row
 * breaks the foreign key of every order they placed and takes that sales history
 * with it. Refund and chargeback disputes surface months later and need the
 * original record. An order that was cancelled is not an order that never
 * happened, and the difference matters to the accountant.
 *
 * So: products and customers are soft-deleted, orders are archived, and only a
 * lead — which carries no financial record at all — is actually removed.
 */

export type Result = { ok: true } | { ok: false; error: string };

// ── Products ─────────────────────────────────────────────────────────────────

/**
 * Soft-delete a product, and take its variants and inventory with it.
 *
 * The cascade is the part that is easy to forget and expensive to miss: an
 * inventory row still counted against a product nobody can see quietly corrupts
 * every stock report, and the discrepancy shows up as "the numbers don't add up"
 * long after anybody remembers deleting anything. The variants are deactivated
 * here; the inventory rows are excluded by the stock queries, which is the
 * non-destructive half of the same fix.
 */
export async function softDeleteProduct(id: string, actorId: string): Promise<Result> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, sku: true, name: true, slug: true, isActive: true, deletedAt: true },
  });
  if (!product) return { ok: false, error: 'Product not found' };
  if (product.deletedAt) return { ok: false, error: 'Already deleted' };

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { deletedAt: now, isActive: false } });
    // The variants go inactive with it. Inventory rows are left exactly as they
    // are and excluded from the stock screens instead — the pieces may still be
    // physically in the safe, and zeroing a stock count to tidy a listing is
    // destroying a number nobody can recover.
    await tx.productVariant.updateMany({ where: { productId: id }, data: { isActive: false } });
  });

  await writeAudit({
    userId: actorId,
    action: 'PRODUCT_SOFT_DELETE',
    entity: 'Product',
    entityId: id,
    before: { sku: product.sku, name: product.name, slug: product.slug, isActive: product.isActive },
    after: { deletedAt: now.toISOString() },
  });

  return { ok: true };
}

/**
 * Bring one back.
 *
 * Deliberately does not reactivate it: a restored product returns as a draft, so
 * whoever restores it decides when it goes back on sale rather than discovering
 * it already has. Its variants stay inactive for the same reason.
 */
export async function restoreProduct(id: string, actorId: string): Promise<Result> {
  const product = await prisma.product.findUnique({ where: { id }, select: { sku: true, deletedAt: true } });
  if (!product) return { ok: false, error: 'Product not found' };
  if (!product.deletedAt) return { ok: false, error: 'That product is not deleted' };

  await prisma.product.update({ where: { id }, data: { deletedAt: null, isActive: false } });
  await writeAudit({
    userId: actorId,
    action: 'PRODUCT_RESTORE',
    entity: 'Product',
    entityId: id,
    before: { deletedAt: product.deletedAt.toISOString() },
    after: { sku: product.sku, isActive: false },
  });
  return { ok: true };
}

// ── Customers ────────────────────────────────────────────────────────────────

/**
 * Soft-delete a customer, scrubbing their personal details.
 *
 * This is the correct answer to an erasure request. The person's name, phone,
 * email and dates go; the orders, their totals and their invoices stay, because
 * the shop is legally required to keep them and because sales history that
 * disappears when a customer asks to be forgotten is not sales history.
 */
export async function softDeleteCustomer(id: string, actorId: string, anonymise: boolean): Promise<Result> {
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, email: true, deletedAt: true, _count: { select: { orders: true } } },
  });
  if (!customer) return { ok: false, error: 'Customer not found' };
  if (customer.deletedAt) return { ok: false, error: 'Already deleted' };

  const now = new Date();
  await prisma.customer.update({
    where: { id },
    data: {
      deletedAt: now,
      ...(anonymise ? { ...anonymisedFields(id), anonymisedAt: now } : {}),
    },
  });

  await writeAudit({
    userId: actorId,
    action: anonymise ? 'CUSTOMER_ANONYMISE' : 'CUSTOMER_SOFT_DELETE',
    entity: 'Customer',
    entityId: id,
    // The before-state is the record of what was removed. Without it an
    // erasure cannot be explained afterwards, and an accidental one cannot be
    // undone.
    before: { name: customer.name, phone: customer.phone, email: customer.email, orders: customer._count.orders },
    after: { deletedAt: now.toISOString(), anonymised: anonymise },
  });

  return { ok: true };
}

/**
 * Restore a customer.
 *
 * Only possible when they were not anonymised: scrubbed details are gone, and a
 * "restore" that brought back a row reading "Removed at request" would be a
 * worse outcome than leaving it deleted.
 */
export async function restoreCustomer(id: string, actorId: string): Promise<Result> {
  const customer = await prisma.customer.findUnique({ where: { id }, select: { deletedAt: true, anonymisedAt: true } });
  if (!customer) return { ok: false, error: 'Customer not found' };
  if (!customer.deletedAt) return { ok: false, error: 'That customer is not deleted' };
  if (customer.anonymisedAt) {
    return { ok: false, error: 'Their details were erased at their request and cannot be brought back.' };
  }

  await prisma.customer.update({ where: { id }, data: { deletedAt: null } });
  await writeAudit({ userId: actorId, action: 'CUSTOMER_RESTORE', entity: 'Customer', entityId: id, after: { deletedAt: null } });
  return { ok: true };
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * Archive an order. There is no delete, and there will not be one.
 *
 * Archiving hides a finished order from the working list. Nothing is removed,
 * the invoice number stays allocated, and the order still appears in any range
 * that includes it. An order still in flight cannot be archived — that is what
 * cancelling is for, and hiding a live order from the people who have to ship it
 * is not a feature.
 */
export async function archiveOrder(id: string, actorId: string): Promise<Result> {
  const order = await prisma.order.findUnique({
    where: { id },
    select: { orderNumber: true, status: true, archivedAt: true, invoiceNumber: true },
  });
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.archivedAt) return { ok: false, error: 'Already archived' };
  if (!isArchivable(order.status)) {
    return { ok: false, error: `An order that is ${order.status.replace(/_/g, ' ').toLowerCase()} is still in progress. Cancel it first if it is not going ahead.` };
  }

  const now = new Date();
  await prisma.order.update({ where: { id }, data: { archivedAt: now } });
  await writeAudit({
    userId: actorId,
    action: 'ORDER_ARCHIVE',
    entity: 'Order',
    entityId: id,
    before: { orderNumber: order.orderNumber, status: order.status, invoiceNumber: order.invoiceNumber },
    after: { archivedAt: now.toISOString() },
  });
  return { ok: true };
}

export async function unarchiveOrder(id: string, actorId: string): Promise<Result> {
  const order = await prisma.order.findUnique({ where: { id }, select: { orderNumber: true, archivedAt: true } });
  if (!order) return { ok: false, error: 'Order not found' };
  if (!order.archivedAt) return { ok: false, error: 'That order is not archived' };

  await prisma.order.update({ where: { id }, data: { archivedAt: null } });
  await writeAudit({ userId: actorId, action: 'ORDER_UNARCHIVE', entity: 'Order', entityId: id, before: { orderNumber: order.orderNumber }, after: { archivedAt: null } });
  return { ok: true };
}

// ── Leads ────────────────────────────────────────────────────────────────────

/**
 * The one genuine delete in the application.
 *
 * A lead is an enquiry. It carries no invoice, no payment and no accounting
 * consequence, so keeping a soft-deleted one forever would be hoarding somebody
 * else's phone number for no reason — which is its own problem. The audit entry
 * keeps the before-state, so a deletion can still be accounted for.
 */
export async function deleteLead(id: string, actorId: string): Promise<Result> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, email: true, source: true, status: true, estimatedValue: true },
  });
  if (!lead) return { ok: false, error: 'Lead not found' };

  await prisma.lead.delete({ where: { id } });

  await writeAudit({
    userId: actorId,
    action: 'LEAD_DELETE',
    entity: 'Lead',
    entityId: id,
    before: {
      name: lead.name, phone: lead.phone, email: lead.email,
      source: lead.source, status: lead.status,
      estimatedValue: lead.estimatedValue?.toString() ?? null,
    },
  });
  return { ok: true };
}
