import 'server-only';
import { prisma } from '@/lib/prisma';
import { ShipmentStatus, type Prisma } from '@prisma/client';

export async function listShipments(params: { status?: ShipmentStatus; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const size = 20;
  const where: Prisma.ShipmentWhereInput = {};
  if (params.status) where.status = params.status;

  const [items, total, counts] = await Promise.all([
    prisma.shipment.findMany({
      where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * size, take: size,
      include: { order: { select: { id: true, orderNumber: true, contactName: true, contactPhone: true } } },
    }),
    prisma.shipment.count({ where }),
    prisma.shipment.groupBy({ by: ['status'], _count: true }),
  ]);

  return {
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / size)),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<ShipmentStatus, number>>,
  };
}
