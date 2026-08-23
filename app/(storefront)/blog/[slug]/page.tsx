import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublishedPost } from '@/lib/cms';
import { getStoreSettings } from '@/lib/store';
import { formatDate } from '@/lib/utils/format';
import ProductImage from '@/components/storefront/ProductImage';
import { buildMetadata } from '@/lib/seo/metadata';
import Prose from '@/components/storefront/Prose';
import { serialiseJsonLd } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  // `notFound()` here, not a "Not found" metadata object.
  //
  // `generateMetadata` resolving successfully commits the response headers, so
  // a `notFound()` later in the page body renders the not-found UI inside a
  // body that has already been sent as **200**. Google indexes those as thin
  // duplicate pages, and every renamed slug quietly becomes one. Throwing from
  // metadata sets the status before anything is flushed.
  if (!post) notFound();

  const meta = await buildMetadata({
    path: `/blog/${slug}`,
    fallbackTitle: post.title,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    fallbackDescription: post.excerpt,
    ogImageUrl: post.ogImageUrl,
    fallbackImage: post.featuredImage,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
  });

  // An article carries a publication date and an author; the shared builder
  // only knows about pages, so those are layered on here rather than adding a
  // per-type branch to something every route depends on.
  return {
    ...meta,
    openGraph: {
      ...meta.openGraph,
      type: 'article',
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: post.author ? [post.author] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, store] = await Promise.all([getPublishedPost(slug), getStoreSettings()]);
  if (!post) notFound();

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: post.featuredImage ? [post.featuredImage] : undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: post.author },
    publisher: { '@type': 'Organization', name: store.brandName },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/blog/${slug}` },
  };

  return (
    <article className="shell py-10 sm:py-14">
      {/* serialiseJsonLd, not JSON.stringify: a post title or author name
          containing "</script>" would otherwise close the tag early and the
          rest would be parsed as HTML. The other three JSON-LD sites already
          used it; this one was missed. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialiseJsonLd(articleLd) }} />

      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-soft mb-4">
          <Link href="/blog" className="hover:text-brass">Journal</Link> <span className="mx-1">/</span>
          <span className="text-ink">{post.title}</span>
        </nav>

        {post.category && <p className="eyebrow">{post.category}</p>}
        <h1 className="mt-2 text-3xl sm:text-4xl">{post.title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{post.author} · {formatDate(post.publishedAt)}</p>

        {post.featuredImage && (
          <div className="mt-6 aspect-[3/2] border border-line overflow-hidden">
            <ProductImage src={post.featuredImage} alt={post.title} monogram={post.title.charAt(0)} className="w-full h-full" />
          </div>
        )}

        {/* A line that is nothing but a YouTube or Vimeo address becomes a
            player; everything else stays a paragraph. */}
        <Prose
          content={post.content}
          title={post.title}
          className="mt-8"
          paragraphClassName="text-ink-soft"
        />

        {post.tags.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <span key={t} className="text-xs border border-line px-3 py-1 rounded-[2px] text-ink-soft">{t}</span>
            ))}
          </div>
        )}

        <div className="mt-10 border-t border-line pt-6">
          <Link href="/blog" className="btn-outline text-sm">More from the journal</Link>
        </div>
      </div>
    </article>
  );
}
