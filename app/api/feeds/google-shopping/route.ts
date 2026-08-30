import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron';
import { catalogueForMerchant } from '@/lib/merchant/catalogue';
import { buildGoogleShoppingFeed } from '@/lib/merchant/feed';
import { getStoreSettings } from '@/lib/store';
import { siteUrl } from '@/lib/seo/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The catalogue as a Google Shopping XML feed.
 *
 * Register it in Merchant Center as a supplemental feed. It covers the window
 * before the Content API is linked, and it keeps listings alive if the service
 * account ever stops working — a crawl a day is worse than a push a minute, and
 * far better than nothing.
 *
 * Behind `CRON_SECRET`, like every other machine endpoint here. The feed is not
 * exactly secret — the same prices are on the product pages — but a public one
 * hands a competitor the entire catalogue with prices, as a single file, on a
 * schedule. Merchant Center supports a fetch header, which is where the secret
 * goes.
 */
async function handler(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [{ items }, store] = await Promise.all([catalogueForMerchant(), getStoreSettings()]);
  const xml = buildGoogleShoppingFeed(items, {
    title: store.brandName,
    link: siteUrl().replace(/\/$/, ''),
    description: store.tagline,
  });

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Never cached in between: a stale feed is the problem this whole feature
      // exists to solve.
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = handler;
export const POST = handler;
