import Link from 'next/link';
import type { ProductCardData } from '@/lib/storefront';
import ProductCard from '@/components/storefront/ProductCard';

export default function ProductGrid({
  products,
  savedIds,
}: {
  products: ProductCardData[];
  savedIds?: Set<string>;
}) {
  if (products.length === 0) {
    return (
      <div className="border border-line bg-paper py-16 text-center">
        <p className="font-heading text-xl">No pieces found</p>
        <p className="mt-2 text-ink-soft text-sm">Try adjusting or clearing your filters.</p>
        <Link href="/c/new-arrivals" className="btn-outline mt-6 inline-flex">Browse new arrivals</Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} saved={savedIds?.has(p.id)} />
      ))}
    </div>
  );
}
