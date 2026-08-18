import Link from 'next/link';
import type { Listing } from '@/lib/storefront';
import ProductGrid from '@/components/storefront/ProductGrid';
import FilterSort from '@/components/storefront/FilterSort';

type Facets = { metals: { label: string; value: string }[]; purities: string[]; occasions: string[] };

export default function ListingView({
  listing,
  facets,
  savedIds,
  basePath,
  searchParams,
}: {
  listing: Listing;
  facets: Facets;
  savedIds?: Set<string>;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  return (
    <div className="shell py-8 sm:py-12">
      <header className="mb-2">
        <p className="eyebrow">Maya Jewellers</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">{listing.title}</h1>
        {listing.description && <p className="mt-2 max-w-xl text-ink-soft">{listing.description}</p>}
      </header>

      <FilterSort facets={facets} total={listing.total} />

      <ProductGrid products={listing.items} savedIds={savedIds} />

      {listing.totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {listing.page > 1 && <PageLink basePath={basePath} searchParams={searchParams} page={listing.page - 1} label="← Previous" />}
          <span className="text-ink-soft">Page {listing.page} of {listing.totalPages}</span>
          {listing.page < listing.totalPages && <PageLink basePath={basePath} searchParams={searchParams} page={listing.page + 1} label="Next →" />}
        </nav>
      )}
    </div>
  );
}

function PageLink({
  basePath, searchParams, page, label,
}: {
  basePath: string; searchParams: Record<string, string | undefined>; page: number; label: string;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) if (v && k !== 'page') params.set(k, v);
  params.set('page', String(page));
  return <Link href={`${basePath}?${params.toString()}`} className="btn-outline text-xs">{label}</Link>;
}
