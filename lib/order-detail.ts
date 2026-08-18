import 'server-only';
import { prisma } from '@/lib/prisma';

/** Load an order for display, enforcing ownership (customer or guest phone). */
export async function getOrderForView(params: {
  orderNumber: string;
  customerId?: string | null;
  phone?: string | null;
}) {
  const order = await prisma.order.findUnique({
    where: { orderNumber: params.orderNumber },
    include: {
      items: true,
      events: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { createdAt: 'asc' } },
      shipment: true,
    },
  });
  if (!order) return null;

  // Ownership: the logged-in customer owns it, OR the guest supplies the order phone.
  const owns =
    (params.customerId && order.customerId === params.customerId) ||
    (params.phone && order.contactPhone.replace(/\D/g, '').endsWith(params.phone.replace(/\D/g, '').slice(-10)));
  if (!owns) return null;

  return order;
}

export async function getCustomerOrders(customerId: string) {
  return prisma.order.findMany({
    where: { customerId },
    orderBy: { placedAt: 'desc' },
    include: { items: { select: { nameSnapshot: true, quantity: true } } },
  });
}
