import 'server-only';
import { prisma } from '@/lib/prisma';
import { imageSchema } from '@/lib/validations/products';

export async function addImage(raw: unknown) {
  const parsed = imageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;
  const count = await prisma.productImage.count({ where: { productId: d.productId } });
  await prisma.productImage.create({
    data: {
      productId: d.productId,
      url: d.url,
      alt: d.alt || null,
      device: d.device,
      type: d.type,
      order: count,
      isPrimary: count === 0, // first image is primary
    },
  });
  return { ok: true as const };
}

export async function deleteImage(imageId: string) {
  const img = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!img) return { ok: false as const, error: 'Image not found' };
  await prisma.productImage.delete({ where: { id: imageId } });
  // If we removed the primary, promote the next image.
  if (img.isPrimary) {
    const next = await prisma.productImage.findFirst({ where: { productId: img.productId }, orderBy: { order: 'asc' } });
    if (next) await prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
  }
  return { ok: true as const };
}

export async function setPrimaryImage(imageId: string) {
  const img = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!img) return { ok: false as const, error: 'Image not found' };
  await prisma.$transaction([
    prisma.productImage.updateMany({ where: { productId: img.productId }, data: { isPrimary: false } }),
    prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
  ]);
  return { ok: true as const };
}

/** Move an image up or down in the ordering by swapping with its neighbour. */
export async function moveImage(imageId: string, direction: 'up' | 'down') {
  const img = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!img) return { ok: false as const, error: 'Image not found' };
  const neighbour = await prisma.productImage.findFirst({
    where: {
      productId: img.productId,
      order: direction === 'up' ? { lt: img.order } : { gt: img.order },
    },
    orderBy: { order: direction === 'up' ? 'desc' : 'asc' },
  });
  if (!neighbour) return { ok: true as const }; // already at the edge
  await prisma.$transaction([
    prisma.productImage.update({ where: { id: img.id }, data: { order: neighbour.order } }),
    prisma.productImage.update({ where: { id: neighbour.id }, data: { order: img.order } }),
  ]);
  return { ok: true as const };
}
