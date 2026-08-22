import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductDetail, getRelatedProducts } from '@/lib/product-detail';
import { getStoreSettings } from '@/lib/store';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import { getCustomerId } from '@/lib/customer-session';
import { getApprovedReviews, canReview } from '@/lib/reviews';
import Reviews from './Reviews';
import { formatCurrency } from '@/lib/utils/format';
import ProductGrid from '@/components/storefront/ProductGrid';
import Gallery from './Gallery';
import BuyBox from './BuyBox';
import { parseTenures } from '@/lib/emi';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProductDetail(slug);
  if (!p) return { title: 'Not found' };
  const title = p.seoTitle ?? p.name;
  const description = p.seoDescription ?? p.shortDescription ?? `${p.name} — ${p.categoryName} at Maya Jewellers.`;
  const image = p.images[0]?.url;
  return {
    title,
    description,
    alternates: { canonical: `/p/${slug}` },
    openGraph: {
      title, description, type: 'website', url: `${SITE_URL}/p/${slug}`,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getProductDetail(slug);
  if (!detail) notFound();

  const customerId = await getCustomerId();
  const [store, related, savedIds, reviews, reviewEligibility] = await Promise.all([
    getStoreSettings(),
    getRelatedProducts(detail.categorySlug, detail.id, 4),
    getWishlistProductIds(await getSessionToken()),
    getApprovedReviews(detail.id),
    canReview(customerId, detail.id),
  ]);

  // EMI is store configuration, read once here and evaluated per variant inside
  // the buy box rather than round-tripping for each selection.
  const emiConfig = {
    enabled: store.emiEnabled,
    minAmount: store.emiMinAmount ? store.emiMinAmount.toString() : null,
    tenures: parseTenures(store.emiTenures),
  };

  const priceForSchema = detail.priceFrom ?? detail.variants.find((v) => v.breakup)?.breakup?.unitTotal ?? null;
  const inStock = detail.variants.some((v) => v.inStock);

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: detail.name,
    description: detail.shortDescription ?? detail.description ?? undefined,
    sku: detail.sku,
    image: detail.images.map((i) => i.url).filter(Boolean),
    brand: { '@type': 'Brand', name: store.brandName },
    ...(detail.reviewCount > 0 && detail.reviewAverage
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: detail.reviewAverage.toFixed(1), reviewCount: detail.reviewCount } }
      : {}),
    offers: priceForSchema
      ? {
          '@type': 'Offer',
          priceCurrency: store.currency,
          price: priceForSchema,
          availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: `${SITE_URL}/p/${slug}`,
        }
      : undefined,
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: detail.categoryName, item: `${SITE_URL}/c/${detail.categorySlug}` },
      { '@type': 'ListItem', position: 3, name: detail.name, item: `${SITE_URL}/p/${slug}` },
    ],
  };

  return (
    <div className="shell py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      {/* Breadcrumb */}
      <nav className="text-xs text-ink-soft mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-brass">Home</Link> <span className="mx-1">/</span>
        <Link href={`/c/${detail.categorySlug}`} className="hover:text-brass">{detail.categoryName}</Link> <span className="mx-1">/</span>
        <span className="text-ink">{detail.name}</span>
      </nav>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Gallery */}
        <div>
          <Gallery images={detail.images.filter((i) => i.type === 'IMAGE')} name={detail.name} />
        </div>

        {/* Buy box */}
        <div>
          <p className="eyebrow">{detail.categoryName}{detail.metalName ? ` · ${detail.metalName} ${detail.purityName ?? ''}` : ''}</p>
          <h1 className="mt-2 text-2xl sm:text-3xl">{detail.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-ink-soft">
            <span>SKU: {detail.sku}</span>
            {detail.reviewCount > 0 && detail.reviewAverage && (
              <span aria-label={`Rated ${detail.reviewAverage.toFixed(1)} out of 5`}>★ {detail.reviewAverage.toFixed(1)} ({detail.reviewCount})</span>
            )}
          </div>
          {detail.shortDescription && <p className="mt-3 text-ink-soft">{detail.shortDescription}</p>}

          <div className="mt-6">
            <BuyBox
              emiConfig={emiConfig}
              product={{
                id: detail.id, name: detail.name, sku: detail.sku, slug: detail.slug,
                variants: detail.variants, defaultVariantId: detail.defaultVariantId,
                purityName: detail.purityName, metalColor: detail.metalColor, certification: detail.certification,
                fulfilmentType: detail.fulfilmentType, leadTimeDays: detail.leadTimeDays, gstInclusive: detail.gstInclusive,
                savedInitial: savedIds.has(detail.id),
                whatsappNumber: store.whatsappNumber, brandName: store.brandName, siteUrl: SITE_URL,
              }}
            />
          </div>
        </div>
      </div>

      {/* Description & specs */}
      <div className="mt-12 grid lg:grid-cols-2 gap-8">
        {detail.description && (
          <section>
            <h2 className="font-heading text-xl mb-3">Description</h2>
            <p className="text-ink-soft leading-relaxed">{detail.description}</p>
          </section>
        )}
        <section>
          <h2 className="font-heading text-xl mb-3">Specifications</h2>
          <dl className="text-sm divide-y divide-line/60 border-t border-line">
            {detail.metalName && <Spec label="Metal" value={`${detail.metalName}${detail.purityName ? ` ${detail.purityName}` : ''}`} />}
            {detail.metalColor && <Spec label="Colour" value={detail.metalColor} />}
            {detail.variants[0]?.weight && <Spec label="Weight" value={`${detail.variants[0].weight} g (approx)`} />}
            <Spec label="Fulfilment" value={detail.fulfilmentType === 'MADE_TO_ORDER' ? `Made to order${detail.leadTimeDays ? ` (~${detail.leadTimeDays} days)` : ''}` : 'Ready to ship'} />
            {detail.certification && <Spec label="Certification" value={detail.certification} />}
            {detail.occasion.length > 0 && <Spec label="Occasion" value={detail.occasion.join(', ')} />}
          </dl>
        </section>
      </div>

      {/* Reviews */}
      <Reviews
        productId={detail.id}
        slug={detail.slug}
        reviews={reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        average={detail.reviewAverage}
        count={detail.reviewCount}
        canReview={reviewEligibility.allowed}
        reason={reviewEligibility.reason}
      />

      {/* Related */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-heading text-2xl mb-6">You may also like</h2>
          <ProductGrid products={related} savedIds={savedIds} />
        </section>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2.5">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-ink text-right">{value}</dd>
    </div>
  );
}
