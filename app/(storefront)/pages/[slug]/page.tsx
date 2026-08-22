import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublishedPage } from '@/lib/cms';
import BlockRenderer from '@/components/cms/BlockRenderer';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
  return buildMetadata({
    path: `/pages/${slug}`,
    fallbackTitle: page.title,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
  });
}

export default async function CmsPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) notFound();

  return (
    <article>
      {page.blocks.length === 0 ? (
        <div className="shell py-16 text-center">
          <h1 className="text-3xl">{page.title}</h1>
          <p className="mt-2 text-ink-soft">This page has no content yet.</p>
        </div>
      ) : (
        page.blocks.map((b) => <BlockRenderer key={b.id} type={b.type} data={b.data} />)
      )}
    </article>
  );
}
