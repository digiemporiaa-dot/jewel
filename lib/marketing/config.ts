import 'server-only';
import { unstable_cache, updateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { toPublicTagConfig, EMPTY_TAG_CONFIG, type PublicTagConfig } from '@/lib/marketing/tags';

/** Cache tag for the marketing configuration; busted when an admin saves. */
export const TAG_CACHE_TAG = 'marketing-tags';

/**
 * The tag configuration is read on **every** request — by the layout to render
 * the scripts and by the middleware to compose the CSP — so it is cached and
 * invalidated explicitly on save rather than re-queried each time.
 *
 * Errors propagate out of the cached function deliberately: `unstable_cache`
 * does not store a rejection, so a transient database failure cannot pin the
 * empty config in the cache and leave the store untracked until the next save.
 */
const loadTags = unstable_cache(
  async (): Promise<PublicTagConfig> => {
    const row = await prisma.marketingTags.findUnique({ where: { id: 'default' } });
    return toPublicTagConfig(row as Record<string, unknown> | null);
  },
  ['marketing-tags'],
  { tags: [TAG_CACHE_TAG] }
);

/**
 * Browser-safe tag configuration. Never contains `metaCapiToken` — the return
 * type has no such field, so it cannot be leaked by forgetting to strip it.
 *
 * Falls back to "everything off" if the database is unreachable: a storefront
 * that renders without analytics is a far better outcome than one that fails to
 * render at all.
 */
export async function getTagConfig(): Promise<PublicTagConfig> {
  try {
    return await loadTags();
  } catch (e) {
    console.error('[marketing] failed to load tag config', e);
    return EMPTY_TAG_CONFIG;
  }
}

/**
 * The Meta CAPI access token, for server-side event delivery only.
 *
 * Read straight from the database on each use rather than cached alongside the
 * public config, so the secret never shares a cache entry with data that is
 * serialised to the browser. Returns null unless CAPI is switched on.
 */
export async function getCapiCredentials(): Promise<{ pixelId: string; token: string } | null> {
  try {
    const row = await prisma.marketingTags.findUnique({
      where: { id: 'default' },
      select: { metaPixelId: true, metaCapiToken: true, metaCapiEnabled: true },
    });
    if (!row?.metaCapiEnabled || !row.metaPixelId || !row.metaCapiToken) return null;
    return { pixelId: row.metaPixelId, token: row.metaCapiToken };
  } catch (e) {
    console.error('[marketing] failed to read CAPI credentials', e);
    return null;
  }
}

/** Invalidate the cached configuration. Called after every admin save. */
export function revalidateTagConfig(): void {
  // `updateTag`, not `revalidateTag`. Next 16 split the two: `revalidateTag` now
  // takes a cache-life profile and marks a tag stale, while `updateTag` expires it
  // immediately with read-your-own-writes semantics — which is exactly what an
  // admin save needs. Every caller of this is a Server Action, which is the only
  // place `updateTag` may be called from.
  updateTag(TAG_CACHE_TAG);
}
