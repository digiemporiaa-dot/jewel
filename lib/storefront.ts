import 'server-only';
import { prisma } from '@/lib/prisma';
import type { Prisma, MetalType } from '@prisma/client';

export const LISTING_PAGE_SIZE = 12;

export type SortKey = 'recommended' | 'newest' | 'price-low' | 'price-high' | 'popularity' | 'best-selling';

export type ListingParams = {
  q?: string;
  metal?: string; // 'gold' | 'silver' | ...
  purity?: string; // '22k'
  color?: string;
  priceMin?: string;
  priceMax?: string;
  avail?: string; // 'ready' | 'made'
  occasion?: string;
  sort?: SortKey;
  page?: number;
};

export type ProductCardData = {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  image: string | null;
  hoverImage: string | null;
  priceFrom: string | null;
  priceTo: string | null;
  fulfilmentType: 'READY_TO_SHIP' | 'MADE_TO_ORDER';
  leadTimeDays: number | null;
  certification: string | null;
  isNewArrival: boolean;
  metalColor: string | null;
  pricingMode: string;
};

// "Virtual" categories filter by attribute rather than category membership, so the
// header nav (Gold / Silver / Diamond / New Arrivals) resolves to populated pages.
const VIRTUAL: Record<string, { title: string; where: Prisma.ProductWhereInput }> = {
  gold: { title: 'Gold Jewellery', where: { metal: { type: 'GOLD' } } },
  silver: { title: 'Silver Jewellery', where: { metal: { type: 'SILVER' } } },
  diamond: { title: 'Diamond Jewellery', where: { hasDiamond: true } },
  'new-arrivals': { title: 'New Arrivals', where: { isNewArrival: true } },
};

const METAL_SLUG_TO_TYPE: Record<string, MetalType> = {
  gold: 'GOLD',
  silver: 'SILVER',
  platinum: 'PLATINUM',
};

function buildFilterWhere(params: ListingParams): Prisma.ProductWhereInput[] {
  const and: Prisma.ProductWhereInput[] = [];

  if (params.q) {
    and.push({
      OR: [
        { name: { contains: params.q, mode: 'insensitive' } },
        { sku: { contains: params.q, mode: 'insensitive' } },
        { tags: { has: params.q.toLowerCase() } },
        { shortDescription: { contains: params.q, mode: 'insensitive' } },
      ],
    });
  }
  if (params.metal && METAL_SLUG_TO_TYPE[params.metal]) {
    and.push({ metal: { type: METAL_SLUG_TO_TYPE[params.metal] } });
  }
  if (params.purity) {
    and.push({ purity: { name: { equals: params.purity, mode: 'insensitive' } } });
  }
  if (params.color) {
    and.push({ metalColor: { equals: params.color, mode: 'insensitive' } });
  }
  if (params.avail === 'ready') and.push({ fulfilmentType: 'READY_TO_SHIP' });
  if (params.avail === 'made') and.push({ fulfilmentType: 'MADE_TO_ORDER' });
  if (params.occasion) and.push({ occasion: { has: params.occasion } });

  const min = params.priceMin ? Number(params.priceMin) : undefined;
  const max = params.priceMax ? Number(params.priceMax) : undefined;
  if (min !== undefined && Number.isFinite(min)) and.push({ priceFrom: { gte: min } });
  if (max !== undefined && Number.isFinite(max)) and.push({ priceFrom: { lte: max } });

  return and;
}

function orderByFor(sort: SortKey | undefined): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'price-low':
      return [{ priceFrom: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'price-high':
      return [{ priceFrom: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'best-selling':
    case 'popularity':
      return [{ isBestSeller: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }];
    case 'recommended':
    default:
      return [{ isFeatured: 'desc' }, { isNewArrival: 'desc' }, { createdAt: 'desc' }];
  }
}

function toCard(p: Prisma.ProductGetPayload<{ include: { category: { select: { name: true } }; images: true } }>): ProductCardData {
  const primary = p.images.find((i) => i.isPrimary) ?? p.images[0] ?? null;
  const hover = p.images.find((i) => !i.isPrimary && i.type === 'IMAGE') ?? null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    categoryName: p.category.name,
    image: primary?.url ?? null,
    hoverImage: hover?.url ?? null,
    priceFrom: p.priceFrom ? p.priceFrom.toString() : null,
    priceTo: p.priceTo ? p.priceTo.toString() : null,
    fulfilmentType: p.fulfilmentType,
    leadTimeDays: p.leadTimeDays,
    certification: p.certification,
    isNewArrival: p.isNewArrival,
    metalColor: p.metalColor,
    pricingMode: p.pricingMode,
  };
}

/** The SEO fields an entity carries, for `buildMetadata`. */
export type ListingSeo = {
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  /** The entity's own image, a better social card than the site default. */
  image: string | null;
};

/** A listing with no backing row — a virtual category, or search. */
const NO_SEO: ListingSeo = {
  seoTitle: null, seoDescription: null, ogImageUrl: null,
  canonicalUrl: null, noIndex: false, image: null,
};

export type Listing = {
  title: string;
  description: string | null;
  seo: ListingSeo;
  items: ProductCardData[];
  total: number;
  page: number;
  totalPages: number;
};

async function runListing(
  baseWhere: Prisma.ProductWhereInput,
  params: ListingParams,
  meta: { title: string; description?: string | null; seo?: ListingSeo }
): Promise<Listing> {
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.ProductWhereInput = {
    AND: [{ isActive: true }, baseWhere, ...buildFilterWhere(params)],
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: orderByFor(params.sort),
      skip: (page - 1) * LISTING_PAGE_SIZE,
      take: LISTING_PAGE_SIZE,
      include: { category: { select: { name: true } }, images: true },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    title: meta.title,
    description: meta.description ?? null,
    seo: meta.seo ?? NO_SEO,
    items: items.map(toCard),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / LISTING_PAGE_SIZE)),
  };
}

export async function getCategoryListing(slug: string, params: ListingParams): Promise<Listing | null> {
  const virtual = VIRTUAL[slug];
  if (virtual) {
    return runListing(virtual.where, params, { title: virtual.title });
  }
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category || !category.isActive) return null;
  // Include direct children categories.
  const children = await prisma.category.findMany({ where: { parentId: category.id }, select: { id: true } });
  const categoryIds = [category.id, ...children.map((c) => c.id)];
  return runListing({ categoryId: { in: categoryIds } }, params, {
    title: category.name,
    description: category.description,
    seo: {
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      ogImageUrl: category.ogImageUrl,
      canonicalUrl: category.canonicalUrl,
      noIndex: category.noIndex,
      image: category.imageUrl,
    },
  });
}

export async function getCollectionListing(slug: string, params: ListingParams): Promise<Listing | null> {
  const collection = await prisma.collection.findUnique({ where: { slug } });
  if (!collection || !collection.isActive) return null;
  return runListing({ collections: { some: { collectionId: collection.id } } }, params, {
    title: collection.name,
    description: collection.description,
    seo: {
      seoTitle: collection.seoTitle,
      seoDescription: collection.seoDescription,
      ogImageUrl: collection.ogImageUrl,
      canonicalUrl: collection.canonicalUrl,
      noIndex: collection.noIndex,
      image: collection.imageUrl,
    },
  });
}

export async function getSearchListing(params: ListingParams): Promise<Listing> {
  const listing = await runListing({}, params, {
    title: params.q ? `Search: “${params.q}”` : 'Search',
  });
  // Log the search for analytics (fire-and-forget).
  if (params.q) {
    prisma.searchLog.create({ data: { query: params.q, resultsCount: listing.total } }).catch(() => {});
  }
  return listing;
}

/** Parse raw URL search params into a typed ListingParams. */
export function parseListingParams(sp: Record<string, string | undefined>): ListingParams {
  const validSorts: SortKey[] = ['recommended', 'newest', 'price-low', 'price-high', 'popularity', 'best-selling'];
  const sort = sp.sort && validSorts.includes(sp.sort as SortKey) ? (sp.sort as SortKey) : undefined;
  return {
    q: sp.q?.trim() || undefined,
    metal: sp.metal || undefined,
    purity: sp.purity || undefined,
    color: sp.color || undefined,
    priceMin: sp.priceMin || undefined,
    priceMax: sp.priceMax || undefined,
    avail: sp.avail || undefined,
    occasion: sp.occasion || undefined,
    sort,
    page: sp.page ? Math.max(1, Number(sp.page) || 1) : 1,
  };
}

/** Facet options for the filter panel. */
export async function getFilterFacets() {
  const [metals, purities, occasions] = await Promise.all([
    prisma.metal.findMany({ where: { isActive: true }, select: { name: true, type: true } }),
    prisma.purity.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { order: 'asc' } }),
    prisma.product.findMany({ where: { isActive: true }, select: { occasion: true } }),
  ]);
  const occasionSet = new Set<string>();
  occasions.forEach((p) => p.occasion.forEach((o) => occasionSet.add(o)));
  return {
    metals: metals.map((m) => ({ label: m.name, value: m.type.toLowerCase() })),
    purities: Array.from(new Set(purities.map((p) => p.name))),
    occasions: Array.from(occasionSet).sort(),
  };
}
