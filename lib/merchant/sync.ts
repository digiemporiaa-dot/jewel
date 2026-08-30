import 'server-only';
import { getMerchantProvider } from '@/lib/merchant';
import { catalogueForMerchant } from '@/lib/merchant/catalogue';
import type { BatchResult } from '@/lib/merchant/provider';

/**
 * Push the whole catalogue to the shopping channel.
 *
 * Shared by the nightly reprice and the manual button in the admin, so the two
 * cannot end up sending different things.
 */

export type SyncOutcome =
  | { state: 'skipped'; reason: string }
  | { state: 'done'; succeeded: number; failed: number; skipped: number; firstErrors: string[] }
  | { state: 'timeout'; afterMs: number };

/**
 * How long the reprice cron is willing to wait.
 *
 * The route's own ceiling is 60s and the reprice has already spent some of it.
 * This is a wall the sync cannot lean past, not a promise about how long Google
 * takes: the request keeps running, the cron simply stops waiting for it and
 * answers.
 */
export const SYNC_TIMEOUT_MS = 20_000;

export async function syncCatalogueToMerchant(timeoutMs = SYNC_TIMEOUT_MS): Promise<SyncOutcome> {
  const provider = getMerchantProvider();
  if (provider.dev) {
    return { state: 'skipped', reason: 'No Merchant Center is configured (GOOGLE_MERCHANT_ID / GOOGLE_SERVICE_ACCOUNT_JSON).' };
  }

  // Raced rather than aborted. There is no way to un-send the batches already
  // accepted, and cancelling mid-way would leave the catalogue half updated —
  // worse than letting it finish unattended.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SyncOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'timeout', afterMs: timeoutMs }), timeoutMs);
  });

  try {
    return await Promise.race([runSync(provider), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSync(provider: ReturnType<typeof getMerchantProvider>): Promise<SyncOutcome> {
  try {
    const { items, skipped } = await catalogueForMerchant();
    if (items.length === 0) {
      return { state: 'done', succeeded: 0, failed: 0, skipped: skipped.length, firstErrors: skipped.slice(0, 5).map((s) => `${s.sku}: ${s.reason}`) };
    }
    const result: BatchResult = await provider.batchUpsert(items);
    if (result.failed.length > 0) {
      console.error('[merchant] sync finished with rejections', result.failed.slice(0, 10));
    }
    return {
      state: 'done',
      succeeded: result.succeeded,
      failed: result.failed.length,
      skipped: skipped.length,
      // A handful, not all of them: a hundred identical messages in a cron log
      // is how the one different message gets missed.
      firstErrors: result.failed.slice(0, 5).map((f) => `${f.offerId}: ${f.error}`),
    };
  } catch (e) {
    // Never thrown onward. This runs inside the pricing cron.
    console.error('[merchant] sync failed', e instanceof Error ? e.message : e);
    return { state: 'done', succeeded: 0, failed: 0, skipped: 0, firstErrors: ['sync failed — see server log'] };
  }
}
