import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAuthorizedCron } from '@/lib/cron';
import { refreshTracking } from '@/lib/shipping/shipments';
import { ShippingAuthError } from '@/lib/shipping/auth-breaker';
import { isTerminalShipmentStatus } from '@/lib/shipping/status';
import { ShipmentStatus } from '@prisma/client';
import { runJob } from '@/lib/system/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma needs the Node runtime, never Edge.
// Serverless platforms cap execution time; 60s is the Vercel Hobby ceiling and
// comfortably within Pro. If the catalogue grows large enough for a run to
// approach this, batch the job rather than raising the limit.
export const maxDuration = 60;

/**
 * Poll the courier for non-terminal shipments and apply the latest tracking
 * (brief §56 shipment reconciliation). Protected by CRON_SECRET; belt-and-braces
 * for webhooks that arrive late or not at all.
 */
async function handler(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runJob('shipment-reconciliation', async () => {
    const active = await prisma.shipment.findMany({
      where: { awb: { not: null }, status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.RTO_DELIVERED, ShipmentStatus.CANCELLED] } },
      select: { orderId: true, status: true },
      take: 200,
    });

    let refreshed = 0;
    let stoppedEarly: string | null = null;
    for (const s of active) {
      if (isTerminalShipmentStatus(s.status)) continue;
      try {
        await refreshTracking(s.orderId);
        refreshed += 1;
      } catch (e) {
        if (e instanceof ShippingAuthError) {
          // Not this shipment's problem — the courier will not let us in at all,
          // so the remaining two hundred would fail identically. Carrying on
          // would bury the real cause under two hundred identical log lines,
          // and before the breaker existed it was this loop, not the admin
          // buttons, that burned through the account's login attempts fastest.
          stoppedEarly = e.message;
          console.error('[cron] reconcile stopped: courier auth unavailable —', e.message);
          break;
        }
        // One courier failing must not abandon the rest of the queue.
        console.error('[cron] reconcile failed for order', s.orderId, e);
      }
    }
    return { checked: active.length, refreshed, ...(stoppedEarly ? { stoppedEarly } : {}) };
  });

  return NextResponse.json({ ok: true, ...result });
}

// Vercel Cron invokes scheduled jobs with **GET** and an
// `Authorization: Bearer $CRON_SECRET` header; other schedulers (Coolify, cURL,
// GitHub Actions) use POST. Both verbs run the identical, secret-protected handler.
export const GET = handler;
export const POST = handler;
