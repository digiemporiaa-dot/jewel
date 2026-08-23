/**
 * Skeleton for search only (brief §52 — skeletons over spinners).
 *
 * This used to sit at the storefront group level, where it did two things
 * wrong. It showed a product-grid skeleton in front of a single product page
 * and a blog post, which are not grids. And more seriously, a `loading.tsx`
 * creates a Suspense boundary that flushes the response shell — committing a
 * **200** — before the page below it has finished its database work. Every
 * `notFound()` on a product, category, CMS page or blog post then rendered the
 * not-found screen inside an already-successful response. Google indexes those
 * as thin duplicate pages, and with slugs now editable, every stale link became
 * one.
 *
 * Search is the right home for it: it is a genuine grid, and it cannot 404 — a
 * query with no matches is a valid page saying so.
 */
export default function Loading() {
  return (
    <div className="shell py-16 animate-pulse">
      <div className="h-8 w-48 bg-paper-2" />
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-square bg-paper-2" />
            <div className="mt-3 h-4 w-2/3 bg-paper-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
