import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { runOccasionCampaigns } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

/** Birthday / anniversary greetings (brief §41). Protected by CRON_SECRET. */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runOccasionCampaigns();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron] campaigns failed', e);
    return NextResponse.json({ error: 'Campaign run failed' }, { status: 500 });
  }
}
