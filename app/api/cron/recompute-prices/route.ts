import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { recomputeProductPrices } from '@/lib/pricing/resolve';

export const dynamic = 'force-dynamic';

/**
 * Recompute cached priceFrom/priceTo for the whole catalogue. Triggered by the
 * scheduler after rate changes, or on demand. Protected by CRON_SECRET.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const updated = await recomputeProductPrices();
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    console.error('[cron] recompute-prices failed', e);
    return NextResponse.json({ error: 'Recompute failed' }, { status: 500 });
  }
}
