import type { Metadata } from 'next';
import Link from 'next/link';
import { getActiveCollections } from '@/lib/catalog';
import ProductImage from '@/components/storefront/ProductImage';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: '/collections',
    fallbackTitle: 'Collections',
    fallbackDescription: 'Curated jewellery collections.',
  });
}

export default async function CollectionsPage() {
  const collections = await getActiveCollections(24);

  return (
    <div className="shell py-8 sm:py-12">
      <header className="mb-8">
        <p className="eyebrow">Curations</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Collections</h1>
      </header>

      {collections.length === 0 ? (
        <p className="text-ink-soft">No collections yet.</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => (
            <Link key={c.id} href={`/collection/${c.slug}`} className="group block">
              <div className="relative aspect-[4/3] overflow-hidden border border-line">
                <ProductImage
                  src={c.imageUrl}
                  alt={c.name}
                  monogram={c.name.charAt(0)}
                  className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <h2 className="mt-3 font-heading text-xl group-hover:text-brass transition-colors">{c.name}</h2>
              {c.description && <p className="text-sm text-ink-soft line-clamp-1">{c.description}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
