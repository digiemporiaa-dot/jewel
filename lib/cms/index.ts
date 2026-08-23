import 'server-only';
import { prisma } from '@/lib/prisma';
import { PublishStatus } from '@prisma/client';
import { HOME_SLUG } from '@/lib/cms/home';

/** A page is visible publicly when PUBLISHED, or SCHEDULED with a past date. */
export async function getPublishedPage(slug: string) {
  const page = await prisma.cmsPage.findUnique({
    where: { slug },
    include: { blocks: { where: { isActive: true }, orderBy: { order: 'asc' } } },
  });
  if (!page) return null;

  const live =
    page.status === PublishStatus.PUBLISHED ||
    (page.status === PublishStatus.SCHEDULED && page.scheduledAt !== null && page.scheduledAt <= new Date());
  return live ? page : null;
}

/**
 * The homepage, if the shop has one.
 *
 * `null` means "never set up", not "broken": `/` falls back to the blueprint in
 * lib/cms/home.ts so a fresh install still has a finished-looking homepage.
 * Draft and scheduled-for-later behave the same way, which is what makes it safe
 * to unpublish the homepage while reworking it — visitors see the default, not
 * a 404 on the shop's front door.
 */
export async function getHomePage() {
  return getPublishedPage(HOME_SLUG);
}

export async function listCmsPages() {
  return prisma.cmsPage.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { blocks: true } } },
  });
}

export async function getCmsPageForEdit(id: string) {
  return prisma.cmsPage.findUnique({
    where: { id },
    include: { blocks: { orderBy: { order: 'asc' } } },
  });
}

/** Slugs of live pages, for the sitemap. */
export async function getLivePageSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const pages = await prisma.cmsPage.findMany({
    where: {
      OR: [
        { status: PublishStatus.PUBLISHED },
        { status: PublishStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      ],
    },
    select: { slug: true, updatedAt: true },
  });
  return pages;
}

// ── Blog ─────────────────────────────────────────────────────────────────────

export async function listPublishedPosts(limit = 20) {
  return prisma.blogPost.findMany({
    where: { status: PublishStatus.PUBLISHED, publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
}

export async function getPublishedPost(slug: string) {
  const post = await prisma.blogPost.findUnique({ where: { slug } });
  if (!post) return null;
  const live = post.status === PublishStatus.PUBLISHED && (!post.publishedAt || post.publishedAt <= new Date());
  return live ? post : null;
}

export async function listAllPosts() {
  return prisma.blogPost.findMany({ orderBy: { updatedAt: 'desc' } });
}

export async function getPostForEdit(id: string) {
  return prisma.blogPost.findUnique({ where: { id } });
}
