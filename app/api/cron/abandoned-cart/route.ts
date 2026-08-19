import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { runAbandonedCartCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/** Staged abandoned-cart reminders (brief §40). Protected by CRON_SECRET. */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runAbandonedCartCampaign();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron] abandoned-cart failed', e);
    return NextResponse.json({ error: 'Campaign run failed' }, { status: 500 });
  }
}
