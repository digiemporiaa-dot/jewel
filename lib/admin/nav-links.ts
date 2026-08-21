import 'server-only';
import { prisma } from '@/lib/prisma';
import { PublishStatus } from '@prisma/client';

/** A destination offered by the link picker, grouped for the <optgroup>. */
export type LinkOption = { group: string; label: string; href: string };

/**
 * Everything an admin can link to without typing a URL. Fixed routes first, then
 * live content — so a new category or collection shows up in the picker the
 * moment it is created, with no code change.
 */
export async function getLinkOptions(): Promise<LinkOption[]> {
  const [pages, categories, collections] = await Promise.all([
    prisma.cmsPage.findMany({
      where: { status: PublishStatus.PUBLISHED },
      select: { title: true, slug: true },
      orderBy: { title: 'asc' },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: { name: true, slug: true },
      orderBy: { order: 'asc' },
    }),
    prisma.collection.findMany({
      where: { isActive: true },
      select: { name: true, slug: true },
      orderBy: { order: 'asc' },
    }),
  ]);

  return [
    { group: 'Store', label: 'Home', href: '/' },
    { group: 'Store', label: 'All collections', href: '/collections' },
    { group: 'Store', label: 'Blog', href: '/blog' },
    { group: 'Store', label: 'Track order', href: '/track' },
    { group: 'Store', label: 'Book appointment', href: '/appointments' },
    { group: 'Store', label: 'Search', href: '/search' },
    ...categories.map((c) => ({ group: 'Categories', label: c.name, href: `/c/${c.slug}` })),
    ...collections.map((c) => ({ group: 'Collections', label: c.name, href: `/collection/${c.slug}` })),
    ...pages.map((p) => ({ group: 'Pages', label: p.title, href: `/pages/${p.slug}` })),
  ];
}

export type LinkIssue =
  | { kind: 'missing'; slug: string }
  | { kind: 'unpublished'; slug: string; status: PublishStatus };

/**
 * Flag navigation links that point at a CMS page which does not exist or is not
 * published.
 *
 * This is not a hypothetical: the footer shipped linking to seven pages that had
 * never been created, and every one of them was a live 404 that nobody noticed.
 * Surfacing it in the admin is the difference between a broken link being found
 * by staff and being found by a customer.
 *
 * Only `/pages/<slug>` links are checked — category and collection routes render
 * their own empty states, and external URLs are not ours to validate.
 */
export async function checkPageLinks(hrefs: string[]): Promise<Map<string, LinkIssue>> {
  const slugByHref = new Map<string, string>();
  for (const href of hrefs) {
    const match = /^\/pages\/([a-z0-9-]+)\/?$/i.exec(href.trim());
    if (match?.[1]) slugByHref.set(href, match[1]);
  }
  if (slugByHref.size === 0) return new Map();

  const slugs = [...new Set(slugByHref.values())];
  const found = await prisma.cmsPage.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, status: true },
  });
  const statusBySlug = new Map(found.map((p) => [p.slug, p.status]));

  const issues = new Map<string, LinkIssue>();
  for (const [href, slug] of slugByHref) {
    const status = statusBySlug.get(slug);
    if (status === undefined) {
      issues.set(href, { kind: 'missing', slug });
    } else if (status !== PublishStatus.PUBLISHED) {
      issues.set(href, { kind: 'unpublished', slug, status });
    }
  }
  return issues;
}
