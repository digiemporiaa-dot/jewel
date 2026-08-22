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
import { buildMetadata } from '@/lib/seo/metadata';
import { productLd, breadcrumbLd, serialiseJsonLd } from '@/lib/seo/jsonld';
import VideoEmbed from '@/components/storefront/VideoEmbed';
import TrustSignals from '@/components/storefront/TrustSignals';
import { fromStored } from '@/lib/video/parse';
import { sizeGuideFor } from '@/lib/products/size-guide';
import { siteUrl } from '@/lib/seo/settings';

export const dynamic = 'force-dynamic';

// Runtime, so a domain change does not need a rebuild — see lib/seo/settings.
const SITE_URL = siteUrl();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProductDetail(slug);
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } };

  // The canonical is always the bare product path. Variant choice lives in
  // component state rather than the URL, so one product is one canonical and
  // its ranking is never split across `?variant=` permutations.
  return buildMetadata({
    path: `/p/${slug}`,
    fallbackTitle: p.name,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    fallbackDescription: p.shortDescription ?? `${p.name} — ${p.categoryName}.`,
    ogImageUrl: p.ogImageUrl,
    fallbackImage: p.images[0]?.url ?? null,
    canonicalUrl: p.canonicalUrl,
    noIndex: p.noIndex,
  });
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

  const productVideo = fromStored(detail.videoUrl);

  // Which size chart, if any, this piece should offer. Derived from the
  // category and the name rather than a column, so it works for the catalogue
  // that already exists instead of one somebody has to backfill first.
  const sizeGuide = sizeGuideFor({
    categorySlug: detail.categorySlug,
    categoryName: detail.categoryName,
    productName: detail.name,
  });

  const certifications = [detail.certification, ...detail.diamondCertifications];

  const priceForSchema = detail.priceFrom ?? detail.variants.find((v) => v.breakup)?.breakup?.unitTotal ?? null;
  const inStock = detail.variants.some((v) => v.inStock);

  const ld = productLd({
    siteUrl: SITE_URL,
    brandName: store.brandName,
    currency: store.currency,
    path: `/p/${slug}`,
    name: detail.name,
    description: detail.shortDescription ?? detail.description,
    sku: detail.sku,
    images: detail.images.map((i) => i.url),
    price: priceForSchema,
    inStock,
    reviewCount: detail.reviewCount,
    reviewAverage: detail.reviewAverage,
    category: detail.categoryName,
  });

  const crumbs = breadcrumbLd(SITE_URL, [
    { name: 'Home', path: '/' },
    { name: detail.categoryName, path: `/c/${detail.categorySlug}` },
    { name: detail.name, path: `/p/${slug}` },
  ]);

  return (
    <div className="shell py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialiseJsonLd(ld) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialiseJsonLd(crumbs) }} />

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
          {/* Re-parsed rather than trusted from the row: a value edited straight
              into the database faces the same validation an operator's does. */}
          {productVideo && (
            <VideoEmbed
              video={productVideo}
              title={`${detail.name} — video`}
              className="mt-4"
            />
          )}
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
                sizeGuide,
              }}
            />
          </div>

          {/* Hallmark and certificate, next to the price rather than buried in
              the spec table — this is a purchase-decision factor here. */}
          <TrustSignals values={certifications} className="mt-6" />
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
