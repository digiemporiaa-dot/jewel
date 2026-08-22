import { prisma } from '@/lib/prisma';
import { OrderStatus, PaymentStatus, LeadStatus } from '@prisma/client';

export type DashboardStats = {
  ordersToday: number;
  salesToday: string;
  pendingPayments: number;
  pendingDispatch: number;
  newCustomersToday: number;
  newLeads: number;
  upcomingAppointments: number;
  lowStock: number;
  abandonedCarts: number;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = startOfToday();
  const empty: DashboardStats = {
    ordersToday: 0,
    salesToday: '0',
    pendingPayments: 0,
    pendingDispatch: 0,
    newCustomersToday: 0,
    newLeads: 0,
    upcomingAppointments: 0,
    lowStock: 0,
    abandonedCarts: 0,
  };

  try {
    const [
      ordersToday,
      salesAgg,
      pendingPayments,
      pendingDispatch,
      newCustomersToday,
      newLeads,
      upcomingAppointments,
      lowStock,
      abandonedCarts,
    ] = await Promise.all([
      prisma.order.count({ where: { placedAt: { gte: today } } }),
      prisma.order.aggregate({
        _sum: { grandTotal: true },
        where: {
          placedAt: { gte: today },
          paymentStatus: { in: [PaymentStatus.CAPTURED, PaymentStatus.AUTHORIZED] },
        },
      }),
      prisma.order.count({ where: { paymentStatus: PaymentStatus.PENDING } }),
      prisma.order.count({
        where: { status: { in: [OrderStatus.CONFIRMED, OrderStatus.READY_TO_SHIP] } },
      }),
      prisma.customer.count({ where: { createdAt: { gte: today }, deletedAt: null } }),
      prisma.lead.count({ where: { status: LeadStatus.NEW } }),
      prisma.appointment.count({ where: { date: { gte: new Date() } } }),
      prisma.inventory.count({
        where: { stockQty: { lte: 2 }, variant: { product: { deletedAt: null } } }, // threshold check refined per-row in inventory screen
      }),
      prisma.cart.count({ where: { abandonedAt: { not: null } } }),
    ]);

    return {
      ...empty,
      ordersToday,
      salesToday: (salesAgg._sum.grandTotal ?? 0).toString(),
      pendingPayments,
      pendingDispatch,
      newCustomersToday,
      newLeads,
      upcomingAppointments,
      lowStock,
      abandonedCarts,
    };
  } catch {
    return empty;
  }
}
