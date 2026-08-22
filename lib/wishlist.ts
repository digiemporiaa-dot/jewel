import 'server-only';
import { prisma } from '@/lib/prisma';
import type { ProductCardData } from '@/lib/storefront';

/** Toggle a product in the guest wishlist. Returns the new saved state. */
export async function toggleWishlist(productId: string, sessionToken: string): Promise<{ saved: boolean }> {
  const existing = await prisma.wishlistItem.findFirst({ where: { sessionToken, productId } });
  if (existing) {
    await prisma.wishlistItem.delete({ where: { id: existing.id } });
    return { saved: false };
  }
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { priceFrom: true } });
  await prisma.wishlistItem.create({
    data: { sessionToken, productId, priceAtAdd: product?.priceFrom ?? null },
  });
  return { saved: true };
}

export async function getWishlistProductIds(sessionToken: string | undefined): Promise<Set<string>> {
  if (!sessionToken) return new Set();
  const items = await prisma.wishlistItem.findMany({ where: { sessionToken }, select: { productId: true } });
  return new Set(items.map((i) => i.productId));
}

export async function getWishlist(sessionToken: string | undefined): Promise<ProductCardData[]> {
  if (!sessionToken) return [];
  const items = await prisma.wishlistItem.findMany({
    where: { sessionToken },
    orderBy: { createdAt: 'desc' },
    include: { product: { include: { category: { select: { name: true } }, images: true } } },
  });
  return items.map(({ product: p }) => {
    const primary = p.images.find((i) => i.isPrimary) ?? p.images[0] ?? null;
    return {
      id: p.id, name: p.name, slug: p.slug, categoryName: p.category.name,
      image: primary?.url ?? null,
      hoverImage: null,
      priceFrom: p.priceFrom ? p.priceFrom.toString() : null,
      priceTo: p.priceTo ? p.priceTo.toString() : null,
      fulfilmentType: p.fulfilmentType, leadTimeDays: p.leadTimeDays,
      certification: p.certification, isNewArrival: p.isNewArrival,
      metalColor: p.metalColor, pricingMode: p.pricingMode,
    };
  });
}

export async function getWishlistCount(sessionToken: string | undefined): Promise<number> {
  if (!sessionToken) return 0;
  return prisma.wishlistItem.count({ where: { sessionToken } });
}
