import 'server-only';
import { prisma } from '@/lib/prisma';
import type { Prisma, PricingMode } from '@prisma/client';
import { productSchema, variantSchema, splitList, type ProductInput } from '@/lib/validations/products';

const PAGE_SIZE = 20;

export type ProductListParams = {
  q?: string;
  categoryId?: string;
  pricingMode?: PricingMode;
  status?: 'active' | 'inactive';
  page?: number;
};

export async function listProducts(params: ProductListParams) {
  const page = Math.max(1, params.page ?? 1);
  const where: Prisma.ProductWhereInput = {};
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { sku: { contains: params.q, mode: 'insensitive' } },
      { slug: { contains: params.q, mode: 'insensitive' } },
    ];
  }
  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.pricingMode) where.pricingMode = params.pricingMode;
  if (params.status) where.isActive = params.status === 'active';

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        category: { select: { name: true } },
        _count: { select: { variants: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      slug: p.slug,
      categoryName: p.category.name,
      pricingMode: p.pricingMode,
      fulfilmentType: p.fulfilmentType,
      isActive: p.isActive,
      priceFrom: p.priceFrom ? p.priceFrom.toString() : null,
      priceTo: p.priceTo ? p.priceTo.toString() : null,
      variantCount: p._count.variants,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Reference data for the product form (categories, metals, purities, making rules). */
export async function getProductFormRefs() {
  const [categories, metals, purities, makingRules] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.metal.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.purity.findMany({ where: { isActive: true }, include: { metal: { select: { name: true, id: true } } }, orderBy: { order: 'asc' } }),
    prisma.makingChargeRule.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { priority: 'desc' } }),
  ]);
  return {
    categories,
    metals,
    purities: purities.map((p) => ({ id: p.id, name: `${p.metal.name} ${p.name}`, metalId: p.metal.id })),
    makingRules,
  };
}

export async function getProductForEdit(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      variants: { include: { inventory: true }, orderBy: { createdAt: 'asc' } },
      images: { orderBy: { order: 'asc' } },
      diamonds: true,
      stones: true,
    },
  });
}

function toData(input: ProductInput): Prisma.ProductCreateInput {
  const isFixed = input.pricingMode === 'FIXED';
  return {
    name: input.name,
    slug: input.slug,
    sku: input.sku,
    shortDescription: input.shortDescription || null,
    description: input.description || null,
    category: { connect: { id: input.categoryId } },
    pricingMode: input.pricingMode,
    metal: !isFixed && input.metalId ? { connect: { id: input.metalId } } : undefined,
    purity: !isFixed && input.purityId ? { connect: { id: input.purityId } } : undefined,
    metalColor: input.metalColor || null,
    netWeight: input.netWeight,
    grossWeight: input.grossWeight,
    wastagePct: input.wastagePct ?? '0',
    makingChargeRule: input.makingChargeRuleId ? { connect: { id: input.makingChargeRuleId } } : undefined,
    fixedPrice: isFixed ? input.fixedPrice : null,
    gstPercent: input.gstPercent,
    gstInclusive: input.gstInclusive,
    fulfilmentType: input.fulfilmentType,
    leadTimeDays: input.leadTimeDays ?? null,
    advancePercent: input.advancePercent,
    certification: input.certification || null,
    hsnCode: input.hsnCode || '7113',
    isActive: input.isActive,
    isFeatured: input.isFeatured,
    isBestSeller: input.isBestSeller,
    isNewArrival: input.isNewArrival,
    occasion: splitList(input.occasion),
    tags: splitList(input.tags),
    seoTitle: input.seoTitle || null,
    seoDescription: input.seoDescription || null,
    publishedAt: input.isActive ? new Date() : null,
  };
}

export async function createProduct(raw: unknown) {
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // Uniqueness checks (friendly errors instead of a Prisma throw).
  const clash = await prisma.product.findFirst({
    where: { OR: [{ slug: parsed.data.slug }, { sku: parsed.data.sku }] },
    select: { slug: true, sku: true },
  });
  if (clash) {
    return { ok: false as const, error: clash.slug === parsed.data.slug ? 'Slug already in use' : 'SKU already in use' };
  }

  const product = await prisma.product.create({ data: toData(parsed.data) });
  // Create a default variant so the product is orderable immediately.
  await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `${parsed.data.sku}-V1`,
      label: 'Default',
      inventory: { create: { stockQty: 0, lowStockThreshold: 2 } },
    },
  });
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices([product.id]);
  return { ok: true as const, id: product.id };
}

export async function updateProduct(id: string, raw: unknown) {
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const clash = await prisma.product.findFirst({
    where: { AND: [{ id: { not: id } }, { OR: [{ slug: parsed.data.slug }, { sku: parsed.data.sku }] }] },
    select: { slug: true },
  });
  if (clash) return { ok: false as const, error: 'Slug or SKU already in use by another product' };

  const before = await prisma.product.findUnique({ where: { id }, select: { slug: true } });

  const isFixed = parsed.data.pricingMode === 'FIXED';
  await prisma.product.update({
    where: { id },
    data: {
      ...toData(parsed.data),
      // Ensure metal/purity are cleared for FIXED products.
      metal: isFixed ? { disconnect: true } : parsed.data.metalId ? { connect: { id: parsed.data.metalId } } : { disconnect: true },
      purity: isFixed ? { disconnect: true } : parsed.data.purityId ? { connect: { id: parsed.data.purityId } } : { disconnect: true },
      makingChargeRule: parsed.data.makingChargeRuleId ? { connect: { id: parsed.data.makingChargeRuleId } } : { disconnect: true },
    },
  });
  // Renaming a product breaks every link to it that already exists — in
  // Google's index, in a customer's WhatsApp history, and in whatever the shop
  // paid to advertise. This is the case the redirect table exists for.
  const { recordSlugChange } = await import('@/lib/redirects');
  await recordSlugChange({ prefix: '/p', oldSlug: before?.slug ?? '', newSlug: parsed.data.slug });

  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices([id]);
  return { ok: true as const, id };
}

export async function deleteProduct(id: string) {
  await prisma.product.delete({ where: { id } });
  return { ok: true as const };
}

// ── Variants ─────────────────────────────────────────────────────────────────

export async function upsertVariant(raw: unknown, variantId?: string) {
  const parsed = variantSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const skuClash = await prisma.productVariant.findFirst({
    where: { sku: d.sku, ...(variantId ? { id: { not: variantId } } : {}) },
    select: { id: true },
  });
  if (skuClash) return { ok: false as const, error: 'Variant SKU already in use' };

  if (variantId) {
    await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        sku: d.sku, label: d.label || null, size: d.size || null, metalColor: d.metalColor || null,
        netWeight: d.netWeight, grossWeight: d.grossWeight, wastagePct: d.wastagePct, fixedPrice: d.fixedPrice,
        isActive: d.isActive,
        inventory: {
          upsert: {
            create: { stockQty: d.stockQty, lowStockThreshold: d.lowStockThreshold },
            update: { lowStockThreshold: d.lowStockThreshold },
          },
        },
      },
    });
  } else {
    await prisma.productVariant.create({
      data: {
        productId: d.productId, sku: d.sku, label: d.label || null, size: d.size || null, metalColor: d.metalColor || null,
        netWeight: d.netWeight, grossWeight: d.grossWeight, wastagePct: d.wastagePct, fixedPrice: d.fixedPrice, isActive: d.isActive,
        inventory: { create: { stockQty: d.stockQty, lowStockThreshold: d.lowStockThreshold } },
      },
    });
  }
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices([d.productId]);
  return { ok: true as const };
}

export async function deleteVariant(variantId: string) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { productId: true } });
  if (!variant) return { ok: false as const, error: 'Variant not found' };
  const count = await prisma.productVariant.count({ where: { productId: variant.productId } });
  if (count <= 1) return { ok: false as const, error: 'A product must have at least one variant' };
  await prisma.productVariant.delete({ where: { id: variantId } });
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices([variant.productId]);
  return { ok: true as const };
}
