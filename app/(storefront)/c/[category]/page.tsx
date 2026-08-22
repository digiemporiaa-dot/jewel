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
  if (!listing) return { title: 'Not found', robots: { index: false, follow: false } };
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
