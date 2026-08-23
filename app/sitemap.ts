import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { getSeoSettings, siteUrl } from '@/lib/seo/settings';
import { HOME_SLUG } from '@/lib/cms/home';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

/**
 * The sitemap.
 *
 * Built from live data so new content is discoverable without a redeploy, and
 * filtered by `noIndex` so it never advertises a page whose own `<meta robots>`
 * tells crawlers to stay away. Listing a page in a sitemap and then telling the
 * crawler not to index it is a contradiction Search Console reports as an error,
 * so the two have to agree.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const SITE_URL = siteUrl();
  const seo = await getSeoSettings();

  // Nothing to advertise while the site is switched off.
  if (!seo.indexingEnabled) return [];

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/collections`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/appointments`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/track`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const [products, categories, collections, pages, posts] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null, noIndex: false },
        select: { slug: true, updatedAt: true },
      }),
      prisma.category.findMany({
        where: { isActive: true, noIndex: false },
        select: { slug: true, updatedAt: true },
      }),
      prisma.collection.findMany({
        where: { isActive: true, noIndex: false },
        select: { slug: true, updatedAt: true },
      }),
      prisma.cmsPage.findMany({
        where: {
          noIndex: false,
          // The homepage is a CmsPage but it is served at `/`, which the static
          // entries above already list. Including it here would advertise
          // `/pages/home`, an address that only redirects.
          slug: { not: HOME_SLUG },
          OR: [
            { status: 'PUBLISHED' },
            { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
          ],
        },
        select: { slug: true, updatedAt: true },
      }),
      prisma.blogPost.findMany({
        where: { status: 'PUBLISHED', publishedAt: { lte: new Date() }, noIndex: false },
        select: { slug: true, updatedAt: true },
      }),
    ]);

    return [
      ...staticEntries,
      ...products.map((p) => ({ url: `${SITE_URL}/p/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'daily' as const, priority: 0.9 })),
      ...categories.map((c) => ({ url: `${SITE_URL}/c/${c.slug}`, lastModified: c.updatedAt, changeFrequency: 'daily' as const, priority: 0.8 })),
      ...collections.map((c) => ({ url: `${SITE_URL}/collection/${c.slug}`, lastModified: c.updatedAt, changeFrequency: 'weekly' as const, priority: 0.7 })),
      ...pages.map((p) => ({ url: `${SITE_URL}/pages/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'monthly' as const, priority: 0.5 })),
      ...posts.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'monthly' as const, priority: 0.5 })),
    ];
  } catch (e) {
    // Never fail the sitemap if the database is briefly unavailable — an empty
    // one would tell crawlers the shop has no products.
    console.error('[sitemap] falling back to static entries', e);
    return staticEntries;
  }
}
