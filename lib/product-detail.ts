import 'server-only';
import { prisma } from '@/lib/prisma';
import { getProductPricing } from '@/lib/pricing/resolve';
import type { PriceBreakup } from '@/lib/pricing';
import type { ProductCardData } from '@/lib/storefront';

export type DetailVariant = {
  id: string;
  label: string | null;
  size: string | null;
  sku: string;
  metalColor: string | null;
  weight: string | null;
  available: number;
  inStock: boolean;
  breakup: PriceBreakup | null;
  error: string | null;
};

export type ProductDetail = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  description: string | null;
  categoryName: string;
  categorySlug: string;
  metalName: string | null;
  purityName: string | null;
  metalColor: string | null;
  fulfilmentType: 'READY_TO_SHIP' | 'MADE_TO_ORDER';
  leadTimeDays: number | null;
  certification: string | null;
  gstInclusive: boolean;
  occasion: string[];
  tags: string[];
  images: { url: string; alt: string | null; type: 'IMAGE' | 'VIDEO' }[];
  variants: DetailVariant[];
  priceFrom: string | null;
  priceTo: string | null;
  defaultVariantId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  reviewCount: number;
  reviewAverage: number | null;
};

export async function getProductDetail(slug: string): Promise<ProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: { select: { name: true, slug: true } },
      metal: { select: { name: true } },
      purity: { select: { name: true } },
      images: { orderBy: { order: 'asc' } },
      variants: { where: { isActive: true }, include: { inventory: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!product || !product.isActive) return null;

  const pricing = await getProductPricing({ id: product.id });
  const madeToOrder = product.fulfilmentType === 'MADE_TO_ORDER';

  const variants: DetailVariant[] = product.variants.map((v) => {
    const vp = pricing?.variants.find((x) => x.variantId === v.id);
    const available = v.inventory ? v.inventory.stockQty - v.inventory.reservedQty : 0;
    return {
      id: v.id,
      label: v.label,
      size: v.size,
      sku: v.sku,
      metalColor: v.metalColor ?? product.metalColor,
      weight: (v.netWeight ?? product.netWeight)?.toString() ?? null,
      available,
      inStock: madeToOrder || available > 0,
      breakup: vp?.breakup ?? null,
      error: vp?.error ?? null,
    };
  });

  // Default to the first in-stock variant, else the first.
  const defaultVariant = variants.find((v) => v.inStock) ?? variants[0] ?? null;

  // Approved reviews summary (none until Phase 6).
  const reviewAgg = await prisma.review.aggregate({
    where: { productId: product.id, status: 'APPROVED' },
    _count: true,
    _avg: { rating: true },
  });

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    shortDescription: product.shortDescription,
    description: product.description,
    categoryName: product.category.name,
    categorySlug: product.category.slug,
    metalName: product.metal?.name ?? null,
    purityName: product.purity?.name ?? null,
    metalColor: product.metalColor,
    fulfilmentType: product.fulfilmentType,
    leadTimeDays: product.leadTimeDays,
    certification: product.certification,
    gstInclusive: product.gstInclusive,
    occasion: product.occasion,
    tags: product.tags,
    images: product.images.map((i) => ({ url: i.url, alt: i.alt, type: i.type })),
    variants,
    priceFrom: pricing?.priceFrom ?? null,
    priceTo: pricing?.priceTo ?? null,
    defaultVariantId: defaultVariant?.id ?? null,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    ogImageUrl: product.ogImageUrl,
    canonicalUrl: product.canonicalUrl,
    noIndex: product.noIndex,
    reviewCount: reviewAgg._count,
    reviewAverage: reviewAgg._avg.rating,
  };
}

export async function getRelatedProducts(categorySlug: string, excludeId: string, limit = 4): Promise<ProductCardData[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true, category: { slug: categorySlug }, id: { not: excludeId } },
    take: limit,
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    include: { category: { select: { name: true } }, images: true },
  });
  return products.map((p) => {
    const primary = p.images.find((i) => i.isPrimary) ?? p.images[0] ?? null;
    return {
      id: p.id, name: p.name, slug: p.slug, categoryName: p.category.name,
      image: primary?.url ?? null, hoverImage: null,
      priceFrom: p.priceFrom?.toString() ?? null, priceTo: p.priceTo?.toString() ?? null,
      fulfilmentType: p.fulfilmentType, leadTimeDays: p.leadTimeDays,
      certification: p.certification, isNewArrival: p.isNewArrival,
      metalColor: p.metalColor, pricingMode: p.pricingMode,
    };
  });
}
