import Link from 'next/link';
import { getStoreSettings } from '@/lib/store';
import {
  getTopCategories, getActiveCollections,
  getFeaturedProducts, getNewArrivals, getBestSellers,
} from '@/lib/catalog';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';
import ProductRow from '@/components/storefront/ProductRow';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [store, categories, collections, featured, newArrivals, bestSellers, savedIds] = await Promise.all([
    getStoreSettings(),
    getTopCategories(8),
    getActiveCollections(3),
    getFeaturedProducts(8),
    getNewArrivals(8),
    getBestSellers(8),
    getWishlistProductIds(await getSessionToken()),
  ]);

  return (
    <>
      {/* Hero */}
      <section className="relative bg-paper-2">
        <div className="shell grid lg:grid-cols-2 gap-8 items-center py-16 lg:py-24">
          <div>
            <p className="eyebrow">The {new Date().getFullYear()} Bridal Edit</p>
            <h1 className="mt-4 text-4xl sm:text-5xl lg:text-6xl">
              Heirloom gold, <span className="italic">reimagined</span> for today.
            </h1>
            <p className="mt-5 max-w-md text-ink-soft">
              Hallmarked gold, certified diamonds and handcrafted silver — priced
              transparently against today&apos;s live metal rates.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/c/new-arrivals" className="btn-primary">
                Shop New Arrivals
              </Link>
              <Link href="/appointments" className="btn-outline">
                Book a Showroom Visit
              </Link>
            </div>
          </div>
          <div className="aspect-[4/5] w-full bg-velvet/90 flex items-center justify-center">
            <span className="font-heading text-3xl text-paper/40">
              {store.brandName}
            </span>
          </div>
        </div>
      </section>

      {/* Shop by category */}
      <section className="shell py-16">
        <div className="flex items-end justify-between">
          <div>
            <p className="eyebrow">Explore</p>
            <h2 className="mt-2 text-3xl">Shop by Category</h2>
          </div>
          <Link href="/collections" className="hidden sm:inline text-sm underline decoration-line-strong underline-offset-4 hover:text-brass">
            View all
          </Link>
        </div>

        {categories.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="group block border border-line hover:border-line-strong transition-colors"
              >
                <div className="aspect-square bg-paper-2 flex items-center justify-center">
                  <span className="font-heading text-2xl text-ink/30 group-hover:text-brass transition-colors">
                    {c.name.charAt(0)}
                  </span>
                </div>
                <div className="p-3 text-center">
                  <span className="text-sm tracking-[0.08em] uppercase text-ink-soft group-hover:text-ink">
                    {c.name}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-8 text-ink-soft">Categories coming soon.</p>
        )}
      </section>

      {/* New arrivals */}
      <ProductRow eyebrow="Just in" title="New Arrivals" products={newArrivals} viewAllHref="/c/new-arrivals" savedIds={savedIds} />

      {/* Featured */}
      <ProductRow eyebrow="Handpicked" title="Featured Pieces" products={featured} viewAllHref="/collections" savedIds={savedIds} />

      {/* Editorial band */}
      <section className="bg-velvet text-paper">
        <div className="shell py-16 grid lg:grid-cols-2 gap-8 items-center">
          <div className="aspect-[5/4] bg-velvet-2 flex items-center justify-center order-2 lg:order-1">
            <span className="font-heading text-2xl text-paper/30">Editorial</span>
          </div>
          <div className="order-1 lg:order-2">
            <p className="eyebrow text-paper/60">Crafted to last generations</p>
            <h2 className="mt-3 text-3xl sm:text-4xl text-paper">
              Transparent pricing, honest craftsmanship
            </h2>
            <p className="mt-4 max-w-md text-paper/70">
              Every dynamic price is calculated live from the day&apos;s metal
              rate, weight, wastage, making charges and GST — the same breakup we
              show you on every product.
            </p>
            <Link href="/pages/about" className="mt-7 inline-block btn-outline border-paper/40 text-paper hover:text-brass hover:border-brass">
              Our Craft
            </Link>
          </div>
        </div>
      </section>

      {/* Best sellers */}
      <ProductRow eyebrow="Loved by customers" title="Best Sellers" products={bestSellers} viewAllHref="/c/new-arrivals?sort=best-selling" savedIds={savedIds} />

      {/* Collections */}
      {collections.length > 0 && (
        <section className="shell py-16">
          <p className="eyebrow">Curations</p>
          <h2 className="mt-2 text-3xl">Featured Collections</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((col) => (
              <Link
                key={col.id}
                href={`/collection/${col.slug}`}
                className="group relative block aspect-[4/3] bg-paper-2 overflow-hidden border border-line"
              >
                <div className="absolute inset-0 flex flex-col justify-end p-5">
                  <span className="font-heading text-2xl group-hover:text-brass transition-colors">
                    {col.name}
                  </span>
                  {col.description && (
                    <span className="text-sm text-ink-soft line-clamp-1">
                      {col.description}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Trust row */}
      <section className="border-t border-line">
        <div className="shell py-12 grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          {[
            ['BIS Hallmarked', 'Certified purity on every gold piece'],
            ['Certified Diamonds', 'IGI / GIA graded stones'],
            ['Live Rate Pricing', 'Priced on today’s metal rate'],
            ['Pan-India Delivery', 'Insured & fully tracked'],
          ].map(([title, sub]) => (
            <div key={title}>
              <p className="font-heading text-lg">{title}</p>
              <p className="mt-1 text-sm text-ink-soft">{sub}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
