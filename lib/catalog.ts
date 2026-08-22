import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { ProductCardData } from '@/lib/storefront';

function mapCard(p: Prisma.ProductGetPayload<{ include: { category: { select: { name: true } }; images: true } }>): ProductCardData {
  const primary = p.images.find((i) => i.isPrimary) ?? p.images[0] ?? null;
  return {
    id: p.id, name: p.name, slug: p.slug, categoryName: p.category.name,
    image: primary?.url ?? null, hoverImage: null,
    priceFrom: p.priceFrom ? p.priceFrom.toString() : null,
    priceTo: p.priceTo ? p.priceTo.toString() : null,
    fulfilmentType: p.fulfilmentType, leadTimeDays: p.leadTimeDays,
    certification: p.certification, isNewArrival: p.isNewArrival,
    metalColor: p.metalColor, pricingMode: p.pricingMode,
  };
}

async function productRow(where: Prisma.ProductWhereInput, orderBy: Prisma.ProductOrderByWithRelationInput[], limit: number): Promise<ProductCardData[]> {
  try {
    const rows = await prisma.product.findMany({
      where: { isActive: true, deletedAt: null, ...where },
      orderBy,
      take: limit,
      include: { category: { select: { name: true } }, images: true },
    });
    return rows.map(mapCard);
  } catch {
    return [];
  }
}

export const getFeaturedProducts = cache((limit = 8) =>
  productRow({ isFeatured: true }, [{ createdAt: 'desc' }], limit));

export const getNewArrivals = cache((limit = 8) =>
  productRow({ isNewArrival: true }, [{ createdAt: 'desc' }], limit));

export const getBestSellers = cache((limit = 8) =>
  productRow({ isBestSeller: true }, [{ createdAt: 'desc' }], limit));

/** Top-level active categories for homepage / nav shortcuts. */
export const getTopCategories = cache(async (limit = 8) => {
  try {
    return await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: { order: 'asc' },
      take: limit,
      select: { id: true, name: true, slug: true, imageUrl: true },
    });
  } catch {
    return [];
  }
});

/** Active collections for homepage bands. */
export const getActiveCollections = cache(async (limit = 6) => {
  try {
    return await prisma.collection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      take: limit,
      select: { id: true, name: true, slug: true, imageUrl: true, description: true },
    });
  } catch {
    return [];
  }
});
