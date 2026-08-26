'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { ShippingAuthError } from '@/lib/shipping/auth-breaker';
import {
  createShipmentForOrder, assignAwbForOrder, schedulePickupForOrder,
  generateLabelForOrder, generateManifestForOrder, refreshTracking,
} from '@/lib/shipping/shipments';

export type Result = { ok: boolean; error?: string; info?: string };

function revalidate(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/shipments');
}

/**
 * Run one courier call and turn every failure into a `Result`.
 *
 * Five of these six actions used to carry their own `try`/`catch` and the
 * sixth — "Create shipment", the one staff press first — did not. A courier
 * error thrown out of a server action does not land in the panel that called
 * it; it reaches the root error boundary and replaces the whole
 * `/admin/orders/[id]` page with "We hit an unexpected snag", so staff lose the
 * order they were reading over a courier's bad afternoon.
 *
 * Wrapping it once rather than six times is the point: the defect was never
 * the missing `catch`, it was that a `catch` could go missing at all. A seventh
 * action written next year gets this for free.
 */
async function guarded(orderId: string, label: string, run: () => Promise<Result>): Promise<Result> {
  try {
    const res = await run();
    revalidate(orderId);
    return res;
  } catch (e) {
    // A login refusal already carries a sentence written for staff — the cause,
    // who can fix it, and until when attempts are paused. Anything else is an
    // API error whose message is at least specific, so it is passed through.
    if (e instanceof ShippingAuthError) return { ok: false, error: e.message };
    console.error(`[admin:shipments] ${label} failed for order ${orderId}`, e);
    return { ok: false, error: e instanceof Error ? e.message : `${label} failed` };
  }
}

export async function createShipmentAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  return guarded(orderId, 'Shipment creation', async () => {
    const res = await createShipmentForOrder(orderId);
    if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_CREATE', entity: 'Order', entityId: orderId });
    return res;
  });
}

export async function assignAwbAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  return guarded(orderId, 'AWB assignment', async () => {
    const res = await assignAwbForOrder(orderId);
    if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_AWB', entity: 'Order', entityId: orderId });
    return res;
  });
}

export async function schedulePickupAction(orderId: string): Promise<Result> {
  const staff = await assertPermission('shipments.manage');
  return guarded(orderId, 'Pickup scheduling', async () => {
    const res = await schedulePickupForOrder(orderId);
    if (res.ok) await writeAudit({ userId: staff.id, action: 'SHIPMENT_PICKUP', entity: 'Order', entityId: orderId });
    return res;
  });
}

export async function generateLabelAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  return guarded(orderId, 'Label generation', async () => {
    const res = await generateLabelForOrder(orderId);
    return res.ok ? { ok: true, info: res.labelUrl } : res;
  });
}

export async function generateManifestAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  return guarded(orderId, 'Manifest generation', async () => {
    const res = await generateManifestForOrder(orderId);
    return res.ok ? { ok: true, info: res.manifestUrl } : res;
  });
}

export async function refreshTrackingAction(orderId: string): Promise<Result> {
  await assertPermission('shipments.manage');
  return guarded(orderId, 'Tracking refresh', async () => {
    const res = await refreshTracking(orderId);
    return res.ok ? { ok: true, info: res.status } : res;
  });
}
