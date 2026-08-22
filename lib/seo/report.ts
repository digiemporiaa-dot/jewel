import 'server-only';
import { prisma } from '@/lib/prisma';
import { resolveSeo, auditSeo, duplicateTitles, type SeoWarning } from '@/lib/seo/resolve';
import { seoDefaults } from '@/lib/seo/settings';

/**
 * What is wrong with this shop's SEO, across every page at once.
 *
 * The per-page warnings are useful while editing one thing; this is the view
 * that catches the problems nobody goes looking for — forty products with no
 * description, twenty rings all called "Gold Ring", a category quietly left
 * `noIndex` after a sale ended.
 */

export type PageReport = {
  path: string;
  label: string;
  kind: 'Product' | 'Category' | 'Collection' | 'Page' | 'Post';
  title: string;
  warnings: SeoWarning[];
};

export type SeoReport = {
  pages: PageReport[];
  duplicates: { title: string; paths: string[] }[];
  counts: { total: number; missingDescription: number; missingImage: number; hidden: number };
  indexingEnabled: boolean;
};

/** How many rows to audit. A catalogue scan is not a per-request operation. */
const LIMIT = 500;

export async function buildSeoReport(): Promise<SeoReport> {
  const defaults = await seoDefaults();

  const [products, categories, collections, pages, posts] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        slug: true, name: true, shortDescription: true, seoTitle: true, seoDescription: true,
        ogImageUrl: true, canonicalUrl: true, noIndex: true,
        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      },
      take: LIMIT,
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: {
        slug: true, name: true, description: true, imageUrl: true,
        seoTitle: true, seoDescription: true, ogImageUrl: true, canonicalUrl: true, noIndex: true,
      },
      take: LIMIT,
    }),
    prisma.collection.findMany({
      where: { isActive: true },
      select: {
        slug: true, name: true, description: true, imageUrl: true,
        seoTitle: true, seoDescription: true, ogImageUrl: true, canonicalUrl: true, noIndex: true,
      },
      take: LIMIT,
    }),
    prisma.cmsPage.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        slug: true, title: true, seoTitle: true, seoDescription: true,
        ogImageUrl: true, canonicalUrl: true, noIndex: true,
      },
      take: LIMIT,
    }),
    prisma.blogPost.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        slug: true, title: true, excerpt: true, featuredImage: true,
        seoTitle: true, seoDescription: true, ogImageUrl: true, canonicalUrl: true, noIndex: true,
      },
      take: LIMIT,
    }),
  ]);

  const audit = (
    kind: PageReport['kind'],
    path: string,
    label: string,
    input: Parameters<typeof resolveSeo>[0]
  ): PageReport => {
    const resolved = resolveSeo(input, defaults);
    return {
      kind, path, label,
      title: resolved.fullTitle,
      warnings: auditSeo(resolved, { isPublic: true, brandName: defaults.brandName }),
    };
  };

  const reports: PageReport[] = [
    ...products.map((p) =>
      audit('Product', `/p/${p.slug}`, p.name, {
        path: `/p/${p.slug}`, fallbackTitle: p.name,
        seoTitle: p.seoTitle, seoDescription: p.seoDescription,
        fallbackDescription: p.shortDescription,
        ogImageUrl: p.ogImageUrl, fallbackImage: p.images[0]?.url ?? null,
        canonicalUrl: p.canonicalUrl, noIndex: p.noIndex,
      })
    ),
    ...categories.map((c) =>
      audit('Category', `/c/${c.slug}`, c.name, {
        path: `/c/${c.slug}`, fallbackTitle: c.name,
        seoTitle: c.seoTitle, seoDescription: c.seoDescription,
        fallbackDescription: c.description,
        ogImageUrl: c.ogImageUrl, fallbackImage: c.imageUrl,
        canonicalUrl: c.canonicalUrl, noIndex: c.noIndex,
      })
    ),
    ...collections.map((c) =>
      audit('Collection', `/collection/${c.slug}`, c.name, {
        path: `/collection/${c.slug}`, fallbackTitle: c.name,
        seoTitle: c.seoTitle, seoDescription: c.seoDescription,
        fallbackDescription: c.description,
        ogImageUrl: c.ogImageUrl, fallbackImage: c.imageUrl,
        canonicalUrl: c.canonicalUrl, noIndex: c.noIndex,
      })
    ),
    ...pages.map((p) =>
      audit('Page', `/pages/${p.slug}`, p.title, {
        path: `/pages/${p.slug}`, fallbackTitle: p.title,
        seoTitle: p.seoTitle, seoDescription: p.seoDescription,
        ogImageUrl: p.ogImageUrl, canonicalUrl: p.canonicalUrl, noIndex: p.noIndex,
      })
    ),
    ...posts.map((p) =>
      audit('Post', `/blog/${p.slug}`, p.title, {
        path: `/blog/${p.slug}`, fallbackTitle: p.title,
        seoTitle: p.seoTitle, seoDescription: p.seoDescription,
        fallbackDescription: p.excerpt,
        ogImageUrl: p.ogImageUrl, fallbackImage: p.featuredImage,
        canonicalUrl: p.canonicalUrl, noIndex: p.noIndex,
      })
    ),
  ];

  return {
    // Worst first: a page with an error outranks one with two warnings.
    pages: reports
      .filter((r) => r.warnings.length > 0)
      .sort((a, b) => {
        const errs = (r: PageReport) => r.warnings.filter((w) => w.severity === 'error').length;
        return errs(b) - errs(a) || b.warnings.length - a.warnings.length;
      }),
    duplicates: duplicateTitles(reports.map((r) => ({ path: r.path, title: r.title }))),
    counts: {
      total: reports.length,
      missingDescription: reports.filter((r) => r.warnings.some((w) => w.field === 'description')).length,
      missingImage: reports.filter((r) => r.warnings.some((w) => w.field === 'ogImage')).length,
      hidden: reports.filter((r) => r.warnings.some((w) => w.field === 'noIndex')).length,
    },
    indexingEnabled: defaults.indexingEnabled,
  };
}
