'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { transitionOrder, recordVerification, confirmManualPayment, addOrderNote } from '@/lib/admin/orders';
import { OrderStatus } from '@prisma/client';
import { archiveOrder, unarchiveOrder } from '@/lib/admin/soft-delete';

export type Result = { ok: boolean; error?: string };

export async function transitionOrderAction(orderId: string, to: string): Promise<Result> {
  const staff = await assertPermission('orders.manage');
  const parsed = z.nativeEnum(OrderStatus).safeParse(to);
  if (!parsed.success) return { ok: false, error: 'Invalid status' };
  const res = await transitionOrder(orderId, parsed.data, staff.name ?? staff.email ?? 'staff');
  if (!res.ok) return res;
  await writeAudit({ userId: staff.id, action: 'ORDER_STATUS_CHANGE', entity: 'Order', entityId: orderId, after: { status: parsed.data } });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  return { ok: true };
}

export async function verifyOrderAction(orderId: string, result: string, notes: string): Promise<Result> {
  const staff = await assertPermission('orders.manage');
  await recordVerification(orderId, staff.id, result, notes);
  await writeAudit({ userId: staff.id, action: 'ORDER_VERIFICATION', entity: 'Order', entityId: orderId, after: { result } });
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

export async function confirmPaymentAction(orderId: string, reference: string): Promise<Result> {
  const staff = await assertPermission('orders.manage');
  const res = await confirmManualPayment(orderId, reference);
  if (!res.ok) return res;
  await writeAudit({ userId: staff.id, action: 'ORDER_MANUAL_PAYMENT', entity: 'Order', entityId: orderId, after: { reference } });
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

export async function addNoteAction(orderId: string, body: string): Promise<Result> {
  const staff = await assertPermission('orders.view');
  if (!body.trim()) return { ok: false, error: 'Empty note' };
  await addOrderNote(orderId, staff.id, body.trim());
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

/**
 * File a finished order away.
 *
 * There is no delete action here and there will not be one. GST invoices are
 * retained for years, and a refund or chargeback dispute six months from now
 * needs the original record. Archiving hides a finished order from the working
 * list; that is the whole of it.
 */
export async function archiveOrderAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('orders.manage');
  const res = await archiveOrder(orderId, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

export async function unarchiveOrderAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('orders.manage');
  const res = await unarchiveOrder(orderId, staff.id);
  if (!res.ok) return res;
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}
