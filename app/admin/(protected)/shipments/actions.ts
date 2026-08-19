'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import {
  createShipmentForOrder, assignAwbForOrder, schedulePickupForOrder,
  generateLabelForOrder, generateManifestForOrder, refreshTracking,
} from '@/lib/shipping/shipments';

export type Result = { ok: boolean; error?: string; info?: string };

function revalidate(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/shipments');
}

export async function createShipmentAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  const res = await createShipmentForOrder(orderId);
  if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_CREATE', entity: 'Order', entityId: orderId });
  revalidate(orderId);
  return res;
}

export async function assignAwbAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  try {
    const res = await assignAwbForOrder(orderId);
    if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_AWB', entity: 'Order', entityId: orderId });
    revalidate(orderId);
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'AWB assignment failed' };
  }
}

export async function schedulePickupAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  try {
    const res = await schedulePickupForOrder(orderId);
    if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_PICKUP', entity: 'Order', entityId: orderId });
    revalidate(orderId);
    return res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Pickup scheduling failed' };
  }
}

export async function generateLabelAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  try {
    const res = await generateLabelForOrder(orderId);
    revalidate(orderId);
    return res.ok ? { ok: true, info: res.labelUrl } : res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Label generation failed' };
  }
}

export async function generateManifestAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  try {
    const res = await generateManifestForOrder(orderId);
    revalidate(orderId);
    return res.ok ? { ok: true, info: res.manifestUrl } : res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Manifest generation failed' };
  }
}

export async function refreshTrackingAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  try {
    const res = await refreshTracking(orderId);
    revalidate(orderId);
    return res.ok ? { ok: true, info: res.status } : res;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tracking refresh failed' };
  }
}
