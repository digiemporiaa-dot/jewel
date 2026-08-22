import 'server-only';
import { unstable_cache, revalidateTag } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import type { SeoDefaults } from '@/lib/seo/resolve';

/**
 * Site-wide SEO configuration.
 *
 * Read on every request by `generateMetadata`, so it is cached and busted
 * explicitly when an admin saves rather than re-queried per page.
 *
 * As with the marketing tags, errors propagate out of the cached function on
 * purpose: `unstable_cache` does not store a rejection, so a transient database
 * failure cannot pin a fallback in the cache and leave the whole site on default
 * metadata until somebody happens to press save.
 */

export const SEO_CACHE_TAG = 'seo-settings';

export type SeoSettingsRow = {
  titleTemplate: string | null;
  defaultTitle: string | null;
  defaultDescription: string | null;
  defaultOgImageUrl: string | null;
  indexingEnabled: boolean;
  robotsDisallow: string[];
  localBusinessEnabled: boolean;
  businessType: string | null;
  priceRange: string | null;
  latitude: string | null;
  longitude: string | null;
  openingHours: unknown;
  bingVerification: string | null;
  pinterestVerification: string | null;
};

/**
 * What an unconfigured shop gets.
 *
 * `indexingEnabled` is true: a deployment whose SeoSettings row has not been
 * created yet must not silently drop out of search.
 */
const FALLBACK: SeoSettingsRow = {
  titleTemplate: null,
  defaultTitle: null,
  defaultDescription: null,
  defaultOgImageUrl: null,
  indexingEnabled: true,
  robotsDisallow: [],
  localBusinessEnabled: false,
  businessType: 'JewelryStore',
  priceRange: null,
  latitude: null,
  longitude: null,
  openingHours: null,
  bingVerification: null,
  pinterestVerification: null,
};

const load = unstable_cache(
  async (): Promise<SeoSettingsRow> => {
    const row = await prisma.seoSettings.findUnique({ where: { id: 'default' } });
    if (!row) return FALLBACK;
    return {
      titleTemplate: row.titleTemplate,
      defaultTitle: row.defaultTitle,
      defaultDescription: row.defaultDescription,
      defaultOgImageUrl: row.defaultOgImageUrl,
      indexingEnabled: row.indexingEnabled,
      robotsDisallow: row.robotsDisallow,
      localBusinessEnabled: row.localBusinessEnabled,
      businessType: row.businessType,
      priceRange: row.priceRange,
      latitude: row.latitude?.toString() ?? null,
      longitude: row.longitude?.toString() ?? null,
      openingHours: row.openingHours,
      bingVerification: row.bingVerification,
      pinterestVerification: row.pinterestVerification,
    };
  },
  ['seo-settings'],
  { tags: [SEO_CACHE_TAG] }
);

export async function getSeoSettings(): Promise<SeoSettingsRow> {
  try {
    return await load();
  } catch (e) {
    // A storefront that renders with default metadata beats one that 500s.
    console.error('[seo] failed to load settings', e);
    return FALLBACK;
  }
}

export function revalidateSeoSettings(): void {
  revalidateTag(SEO_CACHE_TAG);
}

/**
 * The site's own origin, with any trailing slash removed.
 *
 * `SITE_URL` is checked first because `NEXT_PUBLIC_*` values are inlined into
 * the bundle at build time: a shop that changes domain, or a resale deployment
 * pointed at a new one, would otherwise keep emitting canonicals for the old
 * host until somebody rebuilt. Canonicals naming the wrong domain are worse than
 * none at all, so this one must be correctable at runtime.
 */
export function siteUrl(): string {
  const value = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return value.replace(/\/+$/, '');
}

/**
 * Everything `resolveSeo` needs, assembled once per request.
 *
 * The brand name comes from StoreSetting rather than being repeated here, so a
 * redeployment for another jeweller has exactly one place to change it.
 */
export async function seoDefaults(): Promise<SeoDefaults> {
  const [seo, store] = await Promise.all([getSeoSettings(), getStoreSettings()]);
  return {
    siteUrl: siteUrl(),
    brandName: store.brandName,
    titleTemplate: seo.titleTemplate ?? `%s · ${store.brandName}`,
    defaultTitle: seo.defaultTitle ?? `${store.brandName} — ${store.tagline}`,
    defaultDescription: seo.defaultDescription ?? store.tagline,
    defaultOgImageUrl: seo.defaultOgImageUrl ?? store.logoUrl,
    indexingEnabled: seo.indexingEnabled,
  };
}
