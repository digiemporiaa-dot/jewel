import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { getLivePageSlugs } from '@/lib/cms';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Sitemap covering active products, categories, collections, published CMS pages
 * and blog posts (brief §28). Built from live data so new content is discoverable
 * without a redeploy.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/collections`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/appointments`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/track`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const [products, categories, collections, pages, posts] = await Promise.all([
      prisma.product.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      prisma.collection.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      getLivePageSlugs(),
      prisma.blogPost.findMany({
        where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } },
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
  } catch {
    // Never fail the sitemap if the database is briefly unavailable.
    return staticEntries;
  }
}
