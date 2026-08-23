import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategoryListing, getFilterFacets, parseListingParams } from '@/lib/storefront';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import ListingView from '@/components/storefront/ListingView';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

type Params = { category: string };
type Search = Record<string, string | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const listing = await getCategoryListing(category, {});
  // `notFound()` here, not a "Not found" metadata object.
  //
  // `generateMetadata` resolving successfully commits the response headers, so
  // a `notFound()` later in the page body renders the not-found UI inside a
  // body that has already been sent as **200**. Google indexes those as thin
  // duplicate pages, and every renamed slug quietly becomes one. Throwing from
  // metadata sets the status before anything is flushed.
  if (!listing) notFound();
  return buildMetadata({
    path: `/c/${category}`,
    fallbackTitle: listing.title,
    seoTitle: listing.seo.seoTitle,
    seoDescription: listing.seo.seoDescription,
    fallbackDescription: listing.description,
    ogImageUrl: listing.seo.ogImageUrl,
    fallbackImage: listing.seo.image,
    canonicalUrl: listing.seo.canonicalUrl,
    noIndex: listing.seo.noIndex,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { category } = await params;
  const sp = await searchParams;
  const listing = await getCategoryListing(category, parseListingParams(sp));
  if (!listing) notFound();

  const [facets, saved] = await Promise.all([getFilterFacets(), getWishlistProductIds(await getSessionToken())]);

  return (
    <ListingView listing={listing} facets={facets} savedIds={saved} basePath={`/c/${category}`} searchParams={sp} />
  );
}
