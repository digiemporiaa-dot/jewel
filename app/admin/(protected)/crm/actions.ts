'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/rbac';
import { leadCreateSchema, leadUpdateSchema, followUpSchema, callLogSchema } from '@/lib/validations/crm';
import { FollowUpStatus, LeadStatus } from '@prisma/client';
import { deleteLead } from '@/lib/admin/soft-delete';
import { redirect } from 'next/navigation';

export type Result = { ok: boolean; error?: string };

/** Sales executives may only touch leads assigned to them. */
async function assertLeadAccess(leadId: string, staff: { id: string; role: Parameters<typeof can>[0] }): Promise<boolean> {
  // Anyone who can manage all leads (admin) passes; otherwise must be the assignee.
  if (can(staff.role, 'orders.manage')) return true;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } });
  return !!lead && lead.assignedToId === staff.id;
}

export async function createLeadAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const parsed = leadCreateSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const lead = await prisma.lead.create({
    data: {
      name: d.name, phone: d.phone, email: d.email || null, source: d.source,
      productId: d.productId || null,
      estimatedValue: d.estimatedValue ? d.estimatedValue : null,
      notes: d.notes || null,
      // Default to the creating staff member so nothing is unowned.
      assignedToId: d.assignedToId || staff.id,
    },
  });
  await writeAudit({ userId: staff.id, action: 'LEAD_CREATE', entity: 'Lead', entityId: lead.id, after: { name: d.name, phone: d.phone } });
  revalidatePath('/admin/crm');
  return { ok: true };
}

export async function updateLeadAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const parsed = leadUpdateSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  if (!(await assertLeadAccess(d.id, staff))) return { ok: false, error: 'This lead is not assigned to you' };

  const before = await prisma.lead.findUnique({ where: { id: d.id }, select: { status: true, assignedToId: true } });
  await prisma.lead.update({
    where: { id: d.id },
    data: {
      status: d.status as LeadStatus,
      assignedToId: d.assignedToId || undefined,
      estimatedValue: d.estimatedValue ? d.estimatedValue : undefined,
      notes: d.notes || undefined,
      ...(d.status !== before?.status ? { lastContactedAt: new Date() } : {}),
    },
  });
  await writeAudit({ userId: staff.id, action: 'LEAD_UPDATE', entity: 'Lead', entityId: d.id, before, after: { status: d.status } });
  revalidatePath('/admin/crm');
  revalidatePath(`/admin/crm/${d.id}`);
  return { ok: true };
}

export async function addFollowUpAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const parsed = followUpSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  if (!(await assertLeadAccess(parsed.data.leadId, staff))) return { ok: false, error: 'This lead is not assigned to you' };

  const dueAt = new Date(parsed.data.dueAt);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, error: 'Invalid date' };

  await prisma.followUp.create({
    data: { leadId: parsed.data.leadId, dueAt, note: parsed.data.note || null, assignedToId: staff.id },
  });
  await prisma.lead.update({ where: { id: parsed.data.leadId }, data: { status: LeadStatus.FOLLOW_UP } });
  revalidatePath(`/admin/crm/${parsed.data.leadId}`);
  revalidatePath('/admin/crm');
  return { ok: true };
}

export async function completeFollowUpAction(followUpId: string): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const fu = await prisma.followUp.findUnique({ where: { id: followUpId }, select: { leadId: true } });
  if (!fu) return { ok: false, error: 'Follow-up not found' };
  if (!(await assertLeadAccess(fu.leadId, staff))) return { ok: false, error: 'Not your lead' };

  await prisma.followUp.update({ where: { id: followUpId }, data: { status: FollowUpStatus.COMPLETED, completedAt: new Date() } });
  revalidatePath(`/admin/crm/${fu.leadId}`);
  revalidatePath('/admin/crm');
  return { ok: true };
}

export async function logCallAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const parsed = callLogSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  if (!(await assertLeadAccess(parsed.data.leadId, staff))) return { ok: false, error: 'This lead is not assigned to you' };

  const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId }, select: { customerId: true } });
  await prisma.callLog.create({
    data: {
      leadId: parsed.data.leadId,
      customerId: lead?.customerId ?? null,
      staffId: staff.id,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes || null,
    },
  });
  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: { lastContactedAt: new Date(), status: LeadStatus.CONTACTED },
  });
  revalidatePath(`/admin/crm/${parsed.data.leadId}`);
  return { ok: true };
}


/**
 * The one real delete in the application.
 *
 * A lead is an enquiry: no invoice, no payment, nothing an accountant needs. So
 * unlike a product, a customer or an order, it genuinely goes — keeping a
 * soft-deleted copy of somebody's phone number forever, for no reason anybody
 * could give, is its own kind of problem. The audit entry keeps the before-state
 * so the deletion can still be accounted for.
 */
export async function deleteLeadAction(leadId: string, typed: string): Promise<Result> {
  const staff = await assertPermission('leads.manage');
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { name: true, phone: true } });
  if (!lead) return { ok: false, error: 'Lead not found' };

  // Whichever identifier this lead actually has. A WhatsApp enquiry from an
  // anonymous visitor has neither, and then the id is what there is to type.
  const expected = lead.phone ?? lead.name ?? leadId;
  if (typed.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    return { ok: false, error: `Type ${expected} to confirm.` };
  }

  const res = await deleteLead(leadId, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/crm');
  redirect('/admin/crm');
}
