import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Inventory mutations are transactional and oversell-safe (brief §34). Reserving
 * stock uses a single conditional UPDATE so two concurrent orders can never drive
 * available (stockQty − reservedQty) below zero.
 */

export class OutOfStockError extends Error {
  constructor(message = 'Insufficient stock') {
    super(message);
    this.name = 'OutOfStockError';
  }
}

async function inventoryIdForVariant(variantId: string): Promise<string> {
  const inv = await prisma.inventory.findUnique({ where: { variantId }, select: { id: true } });
  if (!inv) throw new Error(`No inventory record for variant ${variantId}`);
  return inv.id;
}

/**
 * Atomically reserve `qty` units. Throws OutOfStockError if not enough is
 * available. The conditional UPDATE guarantees no oversell under concurrency.
 */
export async function reserveStock(variantId: string, qty: number, orderId?: string): Promise<void> {
  if (qty <= 0) throw new Error('Quantity must be positive');
  await prisma.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedQty" = "reservedQty" + ${qty}, "updatedAt" = now()
      WHERE "variantId" = ${variantId} AND ("stockQty" - "reservedQty") >= ${qty}`;
    if (affected === 0) throw new OutOfStockError();
    const inv = await tx.inventory.findUnique({ where: { variantId }, select: { id: true } });
    if (inv) {
      await tx.inventoryLedger.create({
        data: { inventoryId: inv.id, delta: -qty, reason: 'ORDER_RESERVE', orderId: orderId ?? null },
      });
    }
  });
}

/** Release a prior reservation (order cancelled / payment failed). */
export async function releaseStock(variantId: string, qty: number, orderId?: string): Promise<void> {
  if (qty <= 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedQty" = GREATEST("reservedQty" - ${qty}, 0), "updatedAt" = now()
      WHERE "variantId" = ${variantId}`;
    const inv = await tx.inventory.findUnique({ where: { variantId }, select: { id: true } });
    if (inv) {
      await tx.inventoryLedger.create({
        data: { inventoryId: inv.id, delta: qty, reason: 'ORDER_RELEASE', orderId: orderId ?? null },
      });
    }
  });
}

/** Commit a reservation to a sale (on dispatch): reduce both stock and reserved. */
export async function commitStock(variantId: string, qty: number, orderId?: string): Promise<void> {
  if (qty <= 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "Inventory"
      SET "stockQty" = GREATEST("stockQty" - ${qty}, 0),
          "reservedQty" = GREATEST("reservedQty" - ${qty}, 0),
          "updatedAt" = now()
      WHERE "variantId" = ${variantId}`;
    const inv = await tx.inventory.findUnique({ where: { variantId }, select: { id: true } });
    if (inv) {
      await tx.inventoryLedger.create({
        data: { inventoryId: inv.id, delta: -qty, reason: 'SALE', orderId: orderId ?? null },
      });
    }
  });
}

/** Admin: set the absolute stock quantity (with an audit ledger entry). */
export async function setStock(
  variantId: string,
  newStock: number,
  opts: { lowStockThreshold?: number; reason?: string; note?: string } = {}
): Promise<void> {
  if (newStock < 0) throw new Error('Stock cannot be negative');
  await prisma.$transaction(async (tx) => {
    const inv = await tx.inventory.findUnique({ where: { variantId } });
    if (!inv) throw new Error('No inventory record');
    const delta = newStock - inv.stockQty;
    await tx.inventory.update({
      where: { variantId },
      data: {
        stockQty: newStock,
        ...(opts.lowStockThreshold !== undefined ? { lowStockThreshold: opts.lowStockThreshold } : {}),
      },
    });
    if (delta !== 0) {
      await tx.inventoryLedger.create({
        data: { inventoryId: inv.id, delta, reason: opts.reason ?? 'ADJUSTMENT', note: opts.note ?? null },
      });
    }
  });
}

export type InventoryRow = {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string | null;
  stockQty: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number;
  lowStock: boolean;
};

export async function getInventoryOverview(onlyLow = false): Promise<InventoryRow[]> {
  const rows = await prisma.inventory.findMany({
    include: { variant: { include: { product: { select: { name: true } } } } },
    orderBy: { stockQty: 'asc' },
  });
  const mapped = rows.map((r) => {
    const available = r.stockQty - r.reservedQty;
    return {
      variantId: r.variantId,
      sku: r.variant.sku,
      productName: r.variant.product.name,
      variantLabel: r.variant.label,
      stockQty: r.stockQty,
      reservedQty: r.reservedQty,
      available,
      lowStockThreshold: r.lowStockThreshold,
      lowStock: available <= r.lowStockThreshold,
    };
  });
  return onlyLow ? mapped.filter((r) => r.lowStock) : mapped;
}
