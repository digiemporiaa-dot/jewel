import 'server-only';
import { prisma } from '@/lib/prisma';
import { LeadStatus, FollowUpStatus, type Prisma } from '@prisma/client';

/**
 * CRM data layer. Sales executives only see leads assigned to them; admins see
 * everything. Scoping is applied here (server-side) rather than in the UI.
 */

export type CrmScope = { userId: string; assignedOnly: boolean };

function scopeWhere(scope: CrmScope): Prisma.LeadWhereInput {
  return scope.assignedOnly ? { assignedToId: scope.userId } : {};
}

/** Pipeline counts per lead stage, for the CRM board header. */
export async function getPipelineCounts(scope: CrmScope): Promise<Record<LeadStatus, number>> {
  const rows = await prisma.lead.groupBy({
    by: ['status'],
    where: scopeWhere(scope),
    _count: true,
  });
  const base = Object.fromEntries(Object.values(LeadStatus).map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const r of rows) base[r.status] = r._count;
  return base;
}

export async function listLeads(scope: CrmScope, params: { status?: LeadStatus; q?: string; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const size = 20;
  const where: Prisma.LeadWhereInput = { ...scopeWhere(scope) };
  if (params.status) where.status = params.status;
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { phone: { contains: params.q } },
      { email: { contains: params.q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * size, take: size,
      include: {
        assignedTo: { select: { name: true } },
        product: { select: { name: true, slug: true } },
        followUps: { where: { status: FollowUpStatus.PENDING }, orderBy: { dueAt: 'asc' }, take: 1 },
      },
    }),
    prisma.lead.count({ where }),
  ]);
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / size)) };
}

export async function getLead(id: string, scope: CrmScope) {
  const lead = await prisma.lead.findFirst({
    where: { id, ...scopeWhere(scope) }, // ownership enforced server-side
    include: {
      assignedTo: { select: { id: true, name: true } },
      product: { select: { name: true, slug: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
      followUps: { orderBy: { dueAt: 'asc' }, include: { assignedTo: { select: { name: true } } } },
      callLogs: { orderBy: { calledAt: 'desc' }, include: { staff: { select: { name: true } } } },
    },
  });
  return lead;
}

/** Follow-ups that are due (or overdue) — the sales daily worklist. */
export async function getDueFollowUps(scope: CrmScope, withinHours = 24) {
  const until = new Date(Date.now() + withinHours * 3600_000);
  return prisma.followUp.findMany({
    where: {
      status: FollowUpStatus.PENDING,
      dueAt: { lte: until },
      ...(scope.assignedOnly ? { assignedToId: scope.userId } : {}),
    },
    orderBy: { dueAt: 'asc' },
    take: 50,
    include: { lead: { select: { id: true, name: true, phone: true, email: true, source: true, status: true } } },
  });
}

export async function getSalesStaff() {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ['SALES_EXECUTIVE', 'ADMIN', 'SUPER_ADMIN'] } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function listCustomers(params: { q?: string; page?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const size = 20;
  const where: Prisma.CustomerWhereInput = {};
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { phone: { contains: params.q } },
      { email: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * size, take: size,
      include: { _count: { select: { orders: true } } },
    }),
    prisma.customer.count({ where }),
  ]);
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / size)) };
}

export async function getCustomerDetail(id: string) {
  const [customer, spendAgg] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        orders: { orderBy: { placedAt: 'desc' }, take: 20, select: { id: true, orderNumber: true, status: true, grandTotal: true, placedAt: true } },
        addresses: true,
        leads: { select: { id: true, status: true, createdAt: true } },
        appointments: { orderBy: { date: 'desc' }, take: 5 },
      },
    }),
    prisma.order.aggregate({
      where: { customerId: id, paymentStatus: { in: ['CAPTURED', 'AUTHORIZED'] } },
      _sum: { grandTotal: true },
      _count: true,
    }),
  ]);
  if (!customer) return null;
  return {
    customer,
    lifetimeValue: (spendAgg._sum.grandTotal ?? 0).toString(),
    paidOrderCount: spendAgg._count,
  };
}
