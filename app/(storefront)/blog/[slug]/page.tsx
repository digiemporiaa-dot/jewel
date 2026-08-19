import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublishedPost } from '@/lib/cms';
import { getStoreSettings } from '@/lib/store';
import { formatDate } from '@/lib/utils/format';
import ProductImage from '@/components/storefront/ProductImage';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return { title: 'Not found' };
  return {
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt ?? undefined,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      type: 'article',
      publishedTime: post.publishedAt?.toISOString(),
      images: post.featuredImage ? [{ url: post.featuredImage }] : undefined,
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />

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

        <div className="mt-8">
          {post.content.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className="text-ink-soft leading-relaxed mb-4">{para}</p>
          ))}
        </div>

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
