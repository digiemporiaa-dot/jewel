import type { Metadata } from 'next';
import Link from 'next/link';
import { getSearchListing, getFilterFacets, parseListingParams } from '@/lib/storefront';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import ListingView from '@/components/storefront/ListingView';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | undefined>;

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false, follow: true },
};

const POPULAR = ['Gold ring', 'Diamond', 'Mangalsutra', 'Silver', 'Bridal'];

export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const params = parseListingParams(sp);
  const listing = await getSearchListing(params);
  const [facets, saved] = await Promise.all([getFilterFacets(), getWishlistProductIds(await getSessionToken())]);

  return (
    <div>
      <div className="shell pt-8">
        <form action="/search" className="max-w-xl mx-auto">
          <input
            name="q"
            defaultValue={params.q}
            autoFocus
            placeholder="Search jewellery, SKU, category…"
            aria-label="Search"
            className="w-full border border-line-strong bg-paper px-4 py-3 text-lg outline-none focus:border-brass"
          />
        </form>
        {!params.q && (
          <div className="max-w-xl mx-auto mt-4 flex flex-wrap items-center gap-2 justify-center">
            <span className="text-sm text-ink-soft">Popular:</span>
            {POPULAR.map((t) => (
              <Link key={t} href={`/search?q=${encodeURIComponent(t)}`} className="text-sm border border-line px-3 py-1 rounded-[2px] hover:border-brass">{t}</Link>
            ))}
          </div>
        )}
      </div>

      {params.q ? (
        <>
          <ListingView listing={listing} facets={facets} savedIds={saved} basePath="/search" searchParams={sp} />
          {listing.total === 0 && (
            <div className="shell -mt-8 pb-12 text-center">
              <p className="text-ink-soft">No matches for “{params.q}”. Try a broader term, or browse{' '}
                <Link href="/c/new-arrivals" className="underline underline-offset-4 hover:text-brass">new arrivals</Link>.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="shell py-16 text-center text-ink-soft">Start typing to search our collection.</div>
      )}
    </div>
  );
}
