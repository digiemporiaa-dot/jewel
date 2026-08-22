import 'server-only';
import { prisma } from '@/lib/prisma';
import { releaseStock } from '@/lib/inventory';
import { ALLOWED_TRANSITIONS, canTransition } from '@/lib/order-status';
import { OrderStatus, PaymentStatus, type Prisma } from '@prisma/client';
import { rangeFilter, type ResolvedRange } from '@/lib/admin/date-range';

export { ALLOWED_TRANSITIONS, canTransition };

export type OrderListParams = {
  status?: OrderStatus;
  q?: string;
  page?: number;
  range?: ResolvedRange;
};

/** Orders that never became revenue, and should not be summed as if they had. */
const VOID_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.RTO,
];

export function orderListWhere(params: OrderListParams): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.q) {
    where.OR = [
      { orderNumber: { contains: params.q, mode: 'insensitive' } },
      { contactPhone: { contains: params.q } },
      { contactName: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  // `placedAt` rather than `createdAt`: it is the column the list is sorted and
  // read by, and a filter that disagrees with the visible date column is a bug
  // report waiting to be filed.
  const range = params.range ? rangeFilter(params.range) : undefined;
  if (range) where.placedAt = range;
  return where;
}

export async function listOrders(params: OrderListParams) {
  const page = Math.max(1, params.page ?? 1);
  const size = 20;
  const where = orderListWhere(params);

  const [items, total, sum, voidSum] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { placedAt: 'desc' }, skip: (page - 1) * size, take: size,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { grandTotal: true } }),
    // Summed separately so the headline figure can say what it excludes.
    // "₹4.2 lakh this month" that quietly includes three cancellations is the
    // number somebody forwards to their accountant.
    prisma.order.aggregate({
      where: { ...where, status: { in: VOID_STATUSES } },
      _sum: { grandTotal: true },
      _count: true,
    }),
  ]);

  const gross = sum._sum.grandTotal?.toString() ?? '0';
  const voided = voidSum._sum.grandTotal?.toString() ?? '0';

  return {
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / size)),
    gross,
    voided,
    voidedCount: voidSum._count,
  };
}

/**
 * Every order in the filtered range, for CSV export.
 *
 * Deliberately not paginated — an export of page one is not an export — but
 * capped, because a request for "all time" on a shop with years of history
 * should not try to build a 200MB string in memory.
 */
export const EXPORT_LIMIT = 5000;

export async function ordersForExport(params: OrderListParams) {
  return prisma.order.findMany({
    where: orderListWhere(params),
    orderBy: { placedAt: 'desc' },
    take: EXPORT_LIMIT,
    include: { _count: { select: { items: true } } },
  });
}

export async function getOrderAdmin(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      events: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      refunds: true,
      shipment: true,
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      verifiedBy: { select: { name: true } },
      customer: { select: { name: true, phone: true, email: true } },
    },
  });
}

/** Apply a controlled status transition. Releases inventory on cancellation. */
export async function transitionOrder(orderId: string, to: OrderStatus, actor: string): Promise<{ ok: boolean; error?: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return { ok: false, error: 'Order not found' };
  if (!canTransition(order.status, to)) return { ok: false, error: `Cannot move from ${order.status} to ${to}` };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: to, events: { create: { status: to, message: `Status → ${to}`, actor } } },
    });
  });

  // Release reserved inventory when an order is cancelled or returned.
  if (to === OrderStatus.CANCELLED || to === OrderStatus.RTO) {
    for (const item of order.items) {
      if (item.variantId) await releaseStock(item.variantId, item.quantity, orderId).catch(() => {});
    }
  }
  return { ok: true };
}

/** Record a high-value verification call outcome (brief §37). */
export async function recordVerification(orderId: string, staffId: string, result: string, notes: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) return;
  const pass = result.toLowerCase() === 'passed';
  await prisma.order.update({
    where: { id: orderId },
    data: {
      verifiedById: staffId,
      verifiedAt: new Date(),
      verificationResult: result,
      verificationNotes: notes,
      ...(pass && order.status === OrderStatus.VERIFICATION_HOLD ? { status: OrderStatus.CONFIRMED } : {}),
      events: { create: { message: `Verification ${result}`, actor: 'staff' } },
    },
  });
}

/** Manually confirm a bank-transfer / COD-token payment. */
export async function confirmManualPayment(orderId: string, reference: string): Promise<{ ok: boolean; error?: string }> {
  const { confirmPayment } = await import('@/lib/orders');
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) return { ok: false, error: 'Order not found' };
  const pending = order.payments.find((p) => p.status === PaymentStatus.PENDING);
  if (!pending) return { ok: false, error: 'No pending payment' };
  await confirmPayment({ orderId, providerPaymentId: `manual_${reference || Date.now()}`, source: 'callback' });
  return { ok: true };
}

/** Record an internal note on an order. */
export async function addOrderNote(orderId: string, authorId: string, body: string): Promise<void> {
  await prisma.orderNote.create({ data: { orderId, authorId, body, internal: true } });
}
