import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublishedPage } from '@/lib/cms';
import BlockRenderer from '@/components/cms/BlockRenderer';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: 'Not found' };
  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription ?? undefined,
    alternates: { canonical: `/pages/${slug}` },
  };
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
