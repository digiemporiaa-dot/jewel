import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { resolveSettings, type TickerRate, type TickerSettings } from '@/lib/rates/ticker';

/**
 * The ticker's configuration and its rates, read together and cached under one
 * tag.
 *
 * The strip sits in the site header, so this runs on every page. Caching it and
 * busting the tag when an admin saves a rate is what the brief means by
 * "revalidate when rates change; do not poll from the client" — the alternative
 * is either a stale strip or a fetch on every page view for a number that
 * changes once a day.
 *
 * Errors propagate out of the cached function deliberately: `unstable_cache`
 * does not store a rejection, so a transient database failure cannot pin an
 * empty ticker in the cache until somebody happens to press save.
 */

export const RATE_TICKER_TAG = 'rate-ticker';

export type TickerData = {
  settings: TickerSettings;
  rates: TickerRate[];
  /** Every active purity, for the admin's picker. */
  available: { purityId: string; metalName: string; purityName: string }[];
};

const load = unstable_cache(
  async (): Promise<TickerData> => {
    const [row, rates] = await Promise.all([
      prisma.rateTickerSettings.findUnique({ where: { id: 'default' } }),
      prisma.metalRate.findMany({
        // `isCurrent` is the live row per purity in an append-only history. The
        // ticker reads the same rows the pricing engine does; there is no
        // separate display rate to drift out of step with what is charged.
        where: { isCurrent: true, purity: { isActive: true } },
        include: { purity: { include: { metal: true } } },
        orderBy: [{ purity: { metal: { order: 'asc' } } }, { purity: { order: 'asc' } }],
      }),
    ]);

    const mapped: TickerRate[] = rates.map((r) => ({
      purityId: r.purityId,
      metalName: r.purity.metal.name,
      purityName: r.purity.name,
      ratePerGram: r.ratePerGram.toString(),
      // ISO, because unstable_cache round-trips its result through JSON.
      effectiveFrom: r.effectiveFrom.toISOString(),
    }));

    return {
      settings: resolveSettings(row),
      rates: mapped,
      available: mapped.map((r) => ({ purityId: r.purityId, metalName: r.metalName, purityName: r.purityName })),
    };
  },
  ['rate-ticker'],
  { tags: [RATE_TICKER_TAG] }
);

export async function getTickerData(): Promise<TickerData> {
  try {
    return await load();
  } catch (e) {
    // A header with no rate strip beats a header that 500s.
    console.error('[rates] could not load the ticker', e);
    return { settings: resolveSettings(null), rates: [], available: [] };
  }
}

/** Call after saving a rate or the ticker's own settings. */
export function revalidateRateTicker(): void {
  revalidateTag(RATE_TICKER_TAG);
}
