import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCategoryListing, getFilterFacets, parseListingParams } from '@/lib/storefront';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import ListingView from '@/components/storefront/ListingView';

export const dynamic = 'force-dynamic';

type Params = { category: string };
type Search = Record<string, string | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { category } = await params;
  const listing = await getCategoryListing(category, {});
  if (!listing) return { title: 'Not found' };
  return {
    title: listing.title,
    description: listing.description ?? `Shop ${listing.title} at Maya Jewellers.`,
    alternates: { canonical: `/c/${category}` },
  };
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
