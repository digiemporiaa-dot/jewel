'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { recordSlugChange } from '@/lib/redirects';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Trim to null so optional columns stay NULL instead of holding empty strings. */
function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

/**
 * Slugs are part of public URLs (/c/<slug>), so they are normalised rather than
 * trusted: lowercase, non-alphanumerics collapsed to single hyphens.
 */
function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const baseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  slug: z.string().max(80).optional(),
  description: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().url('Image URL must be a valid URL').max(500).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  parentId: z.string().nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(400).nullable().optional(),
});

function readForm(fd: FormData) {
  return {
    name: fd.get('name'),
    slug: nullable(fd.get('slug')) ?? undefined,
    description: nullable(fd.get('description')),
    imageUrl: nullable(fd.get('imageUrl')),
    order: fd.get('order') ?? 0,
    isActive: fd.get('isActive') === 'true' || fd.get('isActive') === 'on',
    parentId: nullable(fd.get('parentId')),
    seoTitle: nullable(fd.get('seoTitle')),
    seoDescription: nullable(fd.get('seoDescription')),
  };
}

export async function createCategoryAction(fd: FormData): Promise<ActionResult> {
  const staff = await assertPermission('categories.manage');
  const parsed = baseSchema.safeParse(readForm(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const d = parsed.data;
  const slug = toSlug(d.slug || d.name);
  if (!slug) return { ok: false, error: 'Could not derive a slug from that name' };

  const clash = await prisma.category.findUnique({ where: { slug } });
  if (clash) return { ok: false, error: `Slug "${slug}" is already in use` };

  const category = await prisma.category.create({
    data: {
      name: d.name,
      slug,
      description: d.description ?? null,
      imageUrl: d.imageUrl ?? null,
      order: d.order,
      isActive: d.isActive,
      parentId: d.parentId || null,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
    },
  });

  await writeAudit({
    userId: staff.id,
    action: 'CATEGORY_CREATE',
    entity: 'Category',
    entityId: category.id,
    after: { name: d.name, slug, isActive: d.isActive },
  });

  revalidatePath('/admin/categories');
  revalidatePath('/');
  return { ok: true };
}

export async function updateCategoryAction(id: string, fd: FormData): Promise<ActionResult> {
  const staff = await assertPermission('categories.manage');
  const parsed = baseSchema.safeParse(readForm(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const before = await prisma.category.findUnique({ where: { id } });
  if (!before) return { ok: false, error: 'Category not found' };

  const d = parsed.data;
  const slug = toSlug(d.slug || d.name);
  if (!slug) return { ok: false, error: 'Could not derive a slug from that name' };

  const clash = await prisma.category.findUnique({ where: { slug } });
  if (clash && clash.id !== id) return { ok: false, error: `Slug "${slug}" is already in use` };

  // A category cannot be its own parent, and cannot sit under one of its own
  // descendants — either would create a cycle the storefront menu cannot render.
  let parentId = d.parentId || null;
  if (parentId === id) return { ok: false, error: 'A category cannot be its own parent' };
  if (parentId) {
    const seen = new Set<string>([id]);
    let cursor: string | null = parentId;
    while (cursor) {
      if (seen.has(cursor)) return { ok: false, error: 'That parent would create a loop' };
      seen.add(cursor);
      const next: { parentId: string | null } | null = await prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }

  await prisma.category.update({
    where: { id },
    data: {
      name: d.name,
      slug,
      description: d.description ?? null,
      imageUrl: d.imageUrl ?? null,
      order: d.order,
      isActive: d.isActive,
      parentId,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
    },
  });

  // Renaming breaks every link that already exists — in Google, in a shared
  // WhatsApp message, in whatever was advertised.
  await recordSlugChange({ prefix: '/c', oldSlug: before?.slug ?? '', newSlug: slug, staffId: staff.id });

  await writeAudit({
    userId: staff.id,
    action: 'CATEGORY_UPDATE',
    entity: 'Category',
    entityId: id,
    before: { name: before.name, slug: before.slug, isActive: before.isActive },
    after: { name: d.name, slug, isActive: d.isActive },
  });

  revalidatePath('/admin/categories');
  revalidatePath('/');
  return { ok: true };
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  const staff = await assertPermission('categories.manage');

  const category = await prisma.category.findUnique({
    where: { id },
    select: {
      name: true,
      slug: true,
      _count: { select: { products: true, children: true, makingChargeRules: true } },
    },
  });
  if (!category) return { ok: false, error: 'Category not found' };

  // Deleting would orphan products or silently drop a pricing rule, so the
  // dependent records have to be moved first. Deactivating is the soft option.
  if (category._count.products > 0) {
    return { ok: false, error: `${category._count.products} product(s) still use this category. Move them first, or set it inactive.` };
  }
  if (category._count.children > 0) {
    return { ok: false, error: `${category._count.children} sub-categor(y/ies) sit under this one. Move them first.` };
  }
  if (category._count.makingChargeRules > 0) {
    return { ok: false, error: `${category._count.makingChargeRules} making-charge rule(s) reference this category. Remove them first.` };
  }

  await prisma.category.delete({ where: { id } });
  await writeAudit({
    userId: staff.id,
    action: 'CATEGORY_DELETE',
    entity: 'Category',
    entityId: id,
    before: { name: category.name, slug: category.slug },
  });

  revalidatePath('/admin/categories');
  revalidatePath('/');
  return { ok: true };
}
