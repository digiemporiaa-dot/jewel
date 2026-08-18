import 'server-only';
import { prisma } from '@/lib/prisma';
import { releaseStock } from '@/lib/inventory';
import { ALLOWED_TRANSITIONS, canTransition } from '@/lib/order-status';
import { OrderStatus, PaymentStatus, type Prisma } from '@prisma/client';

export { ALLOWED_TRANSITIONS, canTransition };

export async function listOrders(params: { status?: OrderStatus; q?: string; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const size = 20;
  const where: Prisma.OrderWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.q) {
    where.OR = [
      { orderNumber: { contains: params.q, mode: 'insensitive' } },
      { contactPhone: { contains: params.q } },
      { contactName: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { placedAt: 'desc' }, skip: (page - 1) * size, take: size,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / size)) };
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
