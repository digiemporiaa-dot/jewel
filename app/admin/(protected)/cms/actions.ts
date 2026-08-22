'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseBlockData, defaultBlockData } from '@/lib/cms/blocks';
import { resolveBlockStyle, syncLegacyFields } from '@/lib/cms/style';
import { CmsBlockType, PublishStatus, type Prisma } from '@prisma/client';
import { recordSlugChange } from '@/lib/redirects';

export type Result = { ok: boolean; error?: string };

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const pageSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(120),
  slug: z.string().trim().min(2).max(120).regex(slugRegex, 'Use lowercase letters, numbers and hyphens'),
  status: z.nativeEnum(PublishStatus),
  scheduledAt: z.string().optional().or(z.literal('')),
  seoTitle: z.string().trim().max(160).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(320).optional().or(z.literal('')),
});

export async function createPageAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('cms.manage');
  const parsed = pageSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const exists = await prisma.cmsPage.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
  if (exists) return { ok: false, error: 'That slug is already in use' };

  const page = await prisma.cmsPage.create({
    data: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      status: parsed.data.status,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      publishedAt: parsed.data.status === PublishStatus.PUBLISHED ? new Date() : null,
      seoTitle: parsed.data.seoTitle || null,
      seoDescription: parsed.data.seoDescription || null,
    },
  });
  await writeAudit({ userId: staff.id, action: 'CMS_PAGE_CREATE', entity: 'CmsPage', entityId: page.id, after: { slug: parsed.data.slug } });
  revalidatePath('/admin/cms');
  redirect(`/admin/cms/${page.id}`);
}

export async function updatePageAction(id: string, fd: FormData): Promise<Result> {
  const staff = await assertPermission('cms.manage');
  const parsed = pageSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const clash = await prisma.cmsPage.findFirst({ where: { slug: parsed.data.slug, id: { not: id } }, select: { id: true } });
  if (clash) return { ok: false, error: 'That slug is already in use' };

  const before = await prisma.cmsPage.findUnique({ where: { id }, select: { slug: true } });
  const page = await prisma.cmsPage.update({
    where: { id },
    data: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      status: parsed.data.status,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      publishedAt: parsed.data.status === PublishStatus.PUBLISHED ? new Date() : null,
      seoTitle: parsed.data.seoTitle || null,
      seoDescription: parsed.data.seoDescription || null,
    },
  });
  await recordSlugChange({
    prefix: '/pages', oldSlug: before?.slug ?? '', newSlug: parsed.data.slug, staffId: staff.id,
  });
  await writeAudit({ userId: staff.id, action: 'CMS_PAGE_UPDATE', entity: 'CmsPage', entityId: id, after: { status: parsed.data.status } });
  revalidatePath('/admin/cms');
  revalidatePath(`/admin/cms/${id}`);
  revalidatePath(`/pages/${page.slug}`);
  return { ok: true };
}

export async function deletePageAction(id: string): Promise<Result> {
  const staff = await assertPermission('cms.manage');
  const page = await prisma.cmsPage.findUnique({ where: { id }, select: { slug: true } });
  await prisma.cmsPage.delete({ where: { id } });
  await writeAudit({ userId: staff.id, action: 'CMS_PAGE_DELETE', entity: 'CmsPage', entityId: id, before: page });
  revalidatePath('/admin/cms');
  redirect('/admin/cms');
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export async function addBlockAction(pageId: string, type: string): Promise<Result> {
  await assertPermission('cms.manage');
  const parsed = z.nativeEnum(CmsBlockType).safeParse(type);
  if (!parsed.success) return { ok: false, error: 'Unknown block type' };

  const count = await prisma.cmsBlock.count({ where: { pageId } });
  await prisma.cmsBlock.create({
    data: {
      pageId, type: parsed.data, order: count,
      data: defaultBlockData(parsed.data) as Prisma.InputJsonValue,
    },
  });
  revalidatePath(`/admin/cms/${pageId}`);
  return { ok: true };
}

/**
 * Save a block's typed content and its presentation style.
 *
 * Content is validated against the block type's own schema; `style` is validated
 * separately against the constrained vocabulary in lib/cms/style.ts and stored
 * alongside it under the `style` key of the same JSON column. The resolved style
 * is written in full, so what the editor showed is exactly what is stored — and
 * for a block that had no style before, resolving reproduces its current
 * appearance rather than inventing a new one.
 */
export async function saveBlockAction(blockId: string, data: unknown): Promise<Result> {
  const staff = await assertPermission('cms.manage');
  const block = await prisma.cmsBlock.findUnique({
    where: { id: blockId },
    select: { pageId: true, type: true, page: { select: { slug: true } } },
  });
  if (!block) return { ok: false, error: 'Block not found' };

  const parsed = parseBlockData(block.type, data);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid block content' };

  const style = resolveBlockStyle(block.type, data);
  const content = syncLegacyFields(block.type, parsed.data as Record<string, unknown>, style);

  await prisma.cmsBlock.update({
    where: { id: blockId },
    data: { data: { ...content, style } as Prisma.InputJsonValue },
  });
  await writeAudit({
    userId: staff.id,
    action: 'CMS_BLOCK_SAVE',
    entity: 'CmsBlock',
    entityId: blockId,
    after: { type: block.type, style },
  });

  revalidatePath(`/admin/cms/${block.pageId}`);
  revalidatePath(`/pages/${block.page.slug}`);
  return { ok: true };
}

export async function deleteBlockAction(blockId: string): Promise<Result> {
  await assertPermission('cms.manage');
  const block = await prisma.cmsBlock.findUnique({ where: { id: blockId }, select: { pageId: true } });
  if (!block) return { ok: false, error: 'Block not found' };
  await prisma.cmsBlock.delete({ where: { id: blockId } });
  revalidatePath(`/admin/cms/${block.pageId}`);
  return { ok: true };
}

export async function moveBlockAction(blockId: string, direction: 'up' | 'down'): Promise<Result> {
  await assertPermission('cms.manage');
  const block = await prisma.cmsBlock.findUnique({ where: { id: blockId } });
  if (!block) return { ok: false, error: 'Block not found' };

  const neighbour = await prisma.cmsBlock.findFirst({
    where: { pageId: block.pageId, order: direction === 'up' ? { lt: block.order } : { gt: block.order } },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
  });
  if (!neighbour) return { ok: true }; // already at the edge

  await prisma.$transaction([
    prisma.cmsBlock.update({ where: { id: block.id }, data: { order: neighbour.order } }),
    prisma.cmsBlock.update({ where: { id: neighbour.id }, data: { order: block.order } }),
  ]);
  revalidatePath(`/admin/cms/${block.pageId}`);
  return { ok: true };
}

export async function toggleBlockAction(blockId: string): Promise<Result> {
  await assertPermission('cms.manage');
  const block = await prisma.cmsBlock.findUnique({ where: { id: blockId } });
  if (!block) return { ok: false, error: 'Block not found' };
  await prisma.cmsBlock.update({ where: { id: blockId }, data: { isActive: !block.isActive } });
  revalidatePath(`/admin/cms/${block.pageId}`);
  return { ok: true };
}
