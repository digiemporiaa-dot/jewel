'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export type ActionResult = { ok: true } | { ok: false; error: string };

function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

/** Slugs are public URL segments (/collection/<slug>), so they are normalised. */
function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  slug: z.string().max(80).optional(),
  description: z.string().max(2000).nullable().optional(),
  imageUrl: z.string().url('Image URL must be a valid URL').max(500).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
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
    seoTitle: nullable(fd.get('seoTitle')),
    seoDescription: nullable(fd.get('seoDescription')),
  };
}

export async function createCollectionAction(fd: FormData): Promise<ActionResult> {
  const staff = await assertPermission('collections.manage');
  const parsed = schema.safeParse(readForm(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const d = parsed.data;
  const slug = toSlug(d.slug || d.name);
  if (!slug) return { ok: false, error: 'Could not derive a slug from that name' };

  const clash = await prisma.collection.findUnique({ where: { slug } });
  if (clash) return { ok: false, error: `Slug "${slug}" is already in use` };

  const collection = await prisma.collection.create({
    data: {
      name: d.name,
      slug,
      description: d.description ?? null,
      imageUrl: d.imageUrl ?? null,
      order: d.order,
      isActive: d.isActive,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
    },
  });

  await writeAudit({
    userId: staff.id,
    action: 'COLLECTION_CREATE',
    entity: 'Collection',
    entityId: collection.id,
    after: { name: d.name, slug, isActive: d.isActive },
  });

  revalidatePath('/admin/collections');
  revalidatePath('/collections');
  return { ok: true };
}

export async function updateCollectionAction(id: string, fd: FormData): Promise<ActionResult> {
  const staff = await assertPermission('collections.manage');
  const parsed = schema.safeParse(readForm(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const before = await prisma.collection.findUnique({ where: { id } });
  if (!before) return { ok: false, error: 'Collection not found' };

  const d = parsed.data;
  const slug = toSlug(d.slug || d.name);
  if (!slug) return { ok: false, error: 'Could not derive a slug from that name' };

  const clash = await prisma.collection.findUnique({ where: { slug } });
  if (clash && clash.id !== id) return { ok: false, error: `Slug "${slug}" is already in use` };

  await prisma.collection.update({
    where: { id },
    data: {
      name: d.name,
      slug,
      description: d.description ?? null,
      imageUrl: d.imageUrl ?? null,
      order: d.order,
      isActive: d.isActive,
      seoTitle: d.seoTitle ?? null,
      seoDescription: d.seoDescription ?? null,
    },
  });

  await writeAudit({
    userId: staff.id,
    action: 'COLLECTION_UPDATE',
    entity: 'Collection',
    entityId: id,
    before: { name: before.name, slug: before.slug, isActive: before.isActive },
    after: { name: d.name, slug, isActive: d.isActive },
  });

  revalidatePath('/admin/collections');
  revalidatePath('/collections');
  return { ok: true };
}

export async function deleteCollectionAction(id: string): Promise<ActionResult> {
  const staff = await assertPermission('collections.manage');

  const collection = await prisma.collection.findUnique({
    where: { id },
    select: { name: true, slug: true, _count: { select: { products: true } } },
  });
  if (!collection) return { ok: false, error: 'Collection not found' };

  // Unlike categories, membership is a join table — removing the collection
  // would only drop the links, not the products. Still made explicit so a
  // populated collection is never wiped by a stray click.
  if (collection._count.products > 0) {
    return { ok: false, error: `${collection._count.products} product(s) are in this collection. Remove them first, or set it hidden.` };
  }

  await prisma.collection.delete({ where: { id } });
  await writeAudit({
    userId: staff.id,
    action: 'COLLECTION_DELETE',
    entity: 'Collection',
    entityId: id,
    before: { name: collection.name, slug: collection.slug },
  });

  revalidatePath('/admin/collections');
  revalidatePath('/collections');
  return { ok: true };
}
