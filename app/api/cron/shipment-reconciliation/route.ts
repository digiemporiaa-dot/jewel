import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAuthorizedCron } from '@/lib/cron';
import { refreshTracking } from '@/lib/shipping/shipments';
import { isTerminalShipmentStatus } from '@/lib/shipping/status';
import { ShipmentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Poll the courier for non-terminal shipments and apply the latest tracking
 * (brief §56 shipment reconciliation). Protected by CRON_SECRET; belt-and-braces
 * for webhooks that arrive late or not at all.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const active = await prisma.shipment.findMany({
    where: { awb: { not: null }, status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.RTO_DELIVERED, ShipmentStatus.CANCELLED] } },
    select: { orderId: true, status: true },
    take: 200,
  });

  let refreshed = 0;
  for (const s of active) {
    if (isTerminalShipmentStatus(s.status)) continue;
    try {
      await refreshTracking(s.orderId);
      refreshed += 1;
    } catch (e) {
      console.error('[cron] reconcile failed for order', s.orderId, e);
    }
  }
  return NextResponse.json({ ok: true, checked: active.length, refreshed });
}
