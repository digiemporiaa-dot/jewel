import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { applyShipmentStatus } from '@/lib/shipping/shipments';

export const dynamic = 'force-dynamic';

/**
 * Shiprocket tracking webhook. Authenticated by a shared token header, recorded
 * idempotently as a WebhookEvent, then applied to the shipment + order. NDR/RTO
 * events flow through the same status mapping (brief §21).
 */
function tokenValid(request: Request): boolean {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN ?? '';
  const got = request.headers.get('x-api-key') ?? request.headers.get('x-shiprocket-token') ?? '';
  if (!expected || got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

type ShiprocketPayload = {
  awb?: string;
  order_id?: string;
  current_status?: string;
  shipment_status?: string;
  scans?: unknown[];
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!tokenValid(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: ShiprocketPayload;
  try {
    payload = JSON.parse(rawBody) as ShiprocketPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const status = payload.current_status ?? payload.shipment_status ?? 'UNKNOWN';
  const awb = payload.awb ?? '';
  const eventId = `${awb || payload.order_id || 'unknown'}:${status}`;

  const existing = await prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'shiprocket', eventId } } });
  if (existing && existing.status === 'PROCESSED') {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  const event = existing
    ? await prisma.webhookEvent.update({ where: { id: existing.id }, data: { status: 'PROCESSING', attempts: { increment: 1 }, signatureValid: true } })
    : await prisma.webhookEvent.create({ data: { provider: 'shiprocket', eventId, eventType: status, status: 'PROCESSING', signatureValid: true, payload: payload as unknown as object, attempts: 1 } });

  try {
    // Resolve the order: by AWB, else by our order number.
    let order = awb ? await prisma.order.findFirst({ where: { shipment: { awb } }, select: { id: true } }) : null;
    if (!order && payload.order_id) {
      order = await prisma.order.findUnique({ where: { orderNumber: payload.order_id }, select: { id: true } });
    }
    if (order) {
      await applyShipmentStatus(order.id, status, 'shiprocket');
    }
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date(), error: null } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'processing failed';
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: 'FAILED', error: message } });
    console.error('[webhook:shiprocket] failed', message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
