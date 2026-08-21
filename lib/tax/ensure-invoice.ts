import 'server-only';
import { prisma } from '@/lib/prisma';
import { OrderStatus } from '@prisma/client';
import { getStoreSettings } from '@/lib/store';
import { allocateInvoiceNumber } from '@/lib/tax/invoice-number';
import { invoicePrefixFromBrand } from '@/lib/tax/gst';

/**
 * Orders that represent a completed sale and therefore warrant a tax invoice.
 *
 * `PENDING_PAYMENT` is excluded on purpose: a shopper who abandons at the
 * payment step must not consume an invoice number, because GST requires the
 * series to be gap-free and a burnt number is a gap someone has to explain.
 * `CANCELLED` is excluded for the same reason.
 */
const INVOICEABLE: OrderStatus[] = [
  OrderStatus.PAYMENT_CONFIRMED,
  OrderStatus.VERIFICATION_HOLD,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_MAKING,
  OrderStatus.READY_TO_SHIP,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUNDED,
  OrderStatus.RTO,
];

/**
 * Return the order's invoice number, allocating one on first use.
 *
 * Idempotent and safe to call from anywhere: the allocation happens inside a
 * transaction that re-reads the order under the counter's row lock, so two
 * concurrent calls for the same order cannot produce two numbers. A refunded or
 * returned order keeps the number it was issued — the invoice still exists, and
 * the credit note is a separate document.
 */
export async function ensureInvoiceNumber(orderId: string): Promise<string | null> {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { invoiceNumber: true, status: true },
  });
  if (!existing) return null;
  if (existing.invoiceNumber) return existing.invoiceNumber;
  if (!INVOICEABLE.includes(existing.status)) return null;

  const store = await getStoreSettings();
  const prefix = invoicePrefixFromBrand(store.brandName);

  try {
    return await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction: another request may have allocated one
      // between the check above and here.
      const fresh = await tx.order.findUnique({
        where: { id: orderId },
        select: { invoiceNumber: true, status: true, placedAt: true },
      });
      if (!fresh) return null;
      if (fresh.invoiceNumber) return fresh.invoiceNumber;
      if (!INVOICEABLE.includes(fresh.status)) return null;

      const { invoiceNumber } = await allocateInvoiceNumber(tx, { prefix, at: fresh.placedAt });
      await tx.order.update({ where: { id: orderId }, data: { invoiceNumber } });
      return invoiceNumber;
    });
  } catch (e) {
    // The unique index is the backstop. If a concurrent transaction won the
    // race, re-read rather than failing the caller — the invoice still renders.
    console.error('[invoice] number allocation failed', e);
    const after = await prisma.order.findUnique({
      where: { id: orderId },
      select: { invoiceNumber: true },
    });
    return after?.invoiceNumber ?? null;
  }
}
