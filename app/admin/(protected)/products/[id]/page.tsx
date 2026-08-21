import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getProductForEdit, getProductFormRefs } from '@/lib/admin/products';
import { getProductPricing } from '@/lib/pricing/resolve';
import { formatCurrency } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import ProductForm, { type ProductDefaults } from '../ProductForm';
import VariantManager from '../VariantManager';
import ImageManager from '../ImageManager';
import DeleteProductButton from './DeleteProductButton';
import { updateProductAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('products.manage');
  const { id } = await params;
  const [product, refs, pricing] = await Promise.all([
    getProductForEdit(id),
    getProductFormRefs(),
    getProductPricing({ id }),
  ]);
  if (!product) notFound();

  const defaults: ProductDefaults = {
    name: product.name, slug: product.slug, sku: product.sku,
    shortDescription: product.shortDescription ?? '', description: product.description ?? '',
    categoryId: product.categoryId, pricingMode: product.pricingMode,
    metalId: product.metalId ?? '', purityId: product.purityId ?? '', metalColor: product.metalColor ?? '',
    netWeight: product.netWeight?.toString() ?? '', grossWeight: product.grossWeight?.toString() ?? '',
    wastagePct: product.wastagePct.toString(), makingChargeRuleId: product.makingChargeRuleId ?? '',
    fixedPrice: product.fixedPrice?.toString() ?? '', gstPercent: product.gstPercent.toString(),
    gstInclusive: product.gstInclusive, fulfilmentType: product.fulfilmentType,
    leadTimeDays: product.leadTimeDays?.toString() ?? '', advancePercent: product.advancePercent?.toString() ?? '',
    certification: product.certification ?? '', hsnCode: product.hsnCode ?? '7113', isActive: product.isActive, isFeatured: product.isFeatured,
    isBestSeller: product.isBestSeller, isNewArrival: product.isNewArrival,
    occasion: product.occasion.join(', '), tags: product.tags.join(', '),
    seoTitle: product.seoTitle ?? '', seoDescription: product.seoDescription ?? '',
  };

  const variants = product.variants.map((v) => ({
    id: v.id, sku: v.sku, label: v.label, size: v.size, metalColor: v.metalColor,
    netWeight: v.netWeight?.toString() ?? null, grossWeight: v.grossWeight?.toString() ?? null,
    wastagePct: v.wastagePct?.toString() ?? null, fixedPrice: v.fixedPrice?.toString() ?? null,
    isActive: v.isActive, stockQty: v.inventory?.stockQty ?? 0, reservedQty: v.inventory?.reservedQty ?? 0,
    lowStockThreshold: v.inventory?.lowStockThreshold ?? 2,
  }));

  const updateAction = updateProductAction.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader title={product.name} description={product.sku} action={{ label: 'Back to products', href: '/admin/products' }} />

      {/* Live price preview */}
      <div className="border border-line bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Live price (engine)</p>
            <p className="mt-1 font-heading text-xl">
              {pricing?.priceFrom
                ? pricing.priceFrom === pricing.priceTo
                  ? formatCurrency(pricing.priceFrom)
                  : `${formatCurrency(pricing.priceFrom)} – ${formatCurrency(pricing.priceTo)}`
                : 'Price on request'}
            </p>
            {pricing?.rateUsed && <p className="text-xs text-ink-soft">rate {formatCurrency(pricing.rateUsed)}/g</p>}
          </div>
          <Link href={`/p/${product.slug}`} className="btn-outline text-xs">View on storefront</Link>
        </div>
        {pricing && pricing.variants.some((v) => v.error) && (
          <p className="mt-2 text-xs text-red-700">Some variants can’t be priced — check rate/making configuration.</p>
        )}
      </div>

      <ProductForm action={updateAction} refs={refs} defaults={defaults} submitLabel="Save changes" />

      <VariantManager productId={id} variants={variants} />
      <ImageManager
        productId={id}
        images={product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, isPrimary: i.isPrimary, order: i.order, device: i.device, type: i.type }))}
      />

      <div className="border border-line bg-white p-5 flex items-center justify-between">
        <div>
          <p className="font-heading text-lg">Danger zone</p>
          <p className="text-sm text-ink-soft">Deleting a product removes its variants, images and inventory.</p>
        </div>
        <DeleteProductButton id={id} />
      </div>
    </div>
  );
}
