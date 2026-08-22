import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublishedPosts } from '@/lib/cms';
import { formatDate } from '@/lib/utils/format';
import ProductImage from '@/components/storefront/ProductImage';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: '/blog',
    fallbackTitle: 'Journal',
    fallbackDescription: 'Jewellery guides, craft stories and buying advice.',
  });
}

export default async function BlogIndex() {
  const posts = await listPublishedPosts(24);

  return (
    <div className="shell py-10 sm:py-14">
      <header className="mb-10 text-center">
        <p className="eyebrow">Journal</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Stories &amp; guides</h1>
      </header>

      {posts.length === 0 ? (
        <p className="text-center text-ink-soft">No articles published yet.</p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <article key={p.id}>
              <Link href={`/blog/${p.slug}`} className="group block">
                <div className="aspect-[3/2] border border-line overflow-hidden">
                  <ProductImage src={p.featuredImage} alt={p.title} monogram={p.title.charAt(0)} className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
                </div>
                {p.category && <p className="eyebrow mt-3">{p.category}</p>}
                <h2 className="mt-1.5 font-heading text-xl group-hover:text-brass transition-colors">{p.title}</h2>
                {p.excerpt && <p className="mt-1.5 text-sm text-ink-soft line-clamp-2">{p.excerpt}</p>}
                <p className="mt-2 text-xs text-ink-soft">{p.author} · {formatDate(p.publishedAt)}</p>
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
