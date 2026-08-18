import Link from 'next/link';
import type { ProductCardData } from '@/lib/storefront';
import ProductCard from '@/components/storefront/ProductCard';

/**
 * Homepage product row — horizontal scroll-snap on mobile, grid on desktop.
 */
export default function ProductRow({
  title,
  products,
  viewAllHref,
  savedIds,
  eyebrow,
}: {
  title: string;
  products: ProductCardData[];
  viewAllHref?: string;
  savedIds?: Set<string>;
  eyebrow?: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className="shell py-12">
      <div className="flex items-end justify-between mb-6">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="mt-1 text-2xl sm:text-3xl">{title}</h2>
        </div>
        {viewAllHref && (
          <Link href={viewAllHref} className="text-sm underline decoration-line-strong underline-offset-4 hover:text-brass shrink-0">
            View all
          </Link>
        )}
      </div>

      {/* Mobile: horizontal snap. Desktop: grid. */}
      <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-4 overflow-x-auto snap-x scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
        {products.map((p) => (
          <div key={p.id} className="snap-start shrink-0 w-[60%] sm:w-auto">
            <ProductCard product={p} saved={savedIds?.has(p.id)} />
          </div>
        ))}
      </div>
    </section>
  );
}
