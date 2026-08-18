import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCollectionListing, getFilterFacets, parseListingParams } from '@/lib/storefront';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import ListingView from '@/components/storefront/ListingView';

export const dynamic = 'force-dynamic';

type Params = { slug: string };
type Search = Record<string, string | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getCollectionListing(slug, {});
  if (!listing) return { title: 'Not found' };
  return {
    title: listing.title,
    description: listing.description ?? `Explore the ${listing.title} collection at Maya Jewellers.`,
    alternates: { canonical: `/collection/${slug}` },
  };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const listing = await getCollectionListing(slug, parseListingParams(sp));
  if (!listing) notFound();

  const [facets, saved] = await Promise.all([getFilterFacets(), getWishlistProductIds(await getSessionToken())]);

  return (
    <ListingView listing={listing} facets={facets} savedIds={saved} basePath={`/collection/${slug}`} searchParams={sp} />
  );
}
