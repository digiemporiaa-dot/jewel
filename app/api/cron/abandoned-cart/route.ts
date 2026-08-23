import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { runAbandonedCartCampaign } from '@/lib/campaigns';
import { runJob } from '@/lib/system/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma needs the Node runtime, never Edge.
// Serverless platforms cap execution time; 60s is the Vercel Hobby ceiling and
// comfortably within Pro. If the catalogue grows large enough for a run to
// approach this, batch the job rather than raising the limit.
export const maxDuration = 60;

/** Staged abandoned-cart reminders (brief §40). Protected by CRON_SECRET. */
async function handler(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runJob('abandoned-cart', () => runAbandonedCartCampaign());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron] abandoned-cart failed', e);
    return NextResponse.json({ error: 'Campaign run failed' }, { status: 500 });
  }
}

// Vercel Cron invokes scheduled jobs with **GET** and an
// `Authorization: Bearer $CRON_SECRET` header; other schedulers (Coolify, cURL,
// GitHub Actions) use POST. Both verbs run the identical, secret-protected handler.
export const GET = handler;
export const POST = handler;
