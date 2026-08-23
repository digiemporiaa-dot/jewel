import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getPublishedPage } from '@/lib/cms';
import { isHomeSlug } from '@/lib/cms/home';
import BlockRenderer from '@/components/cms/BlockRenderer';
import { buildMetadata } from '@/lib/seo/metadata';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // The homepage lives at `/`. Redirecting from metadata rather than from the
  // body sets the status before anything is flushed — same reason as the
  // `notFound()` below.
  if (isHomeSlug(slug)) permanentRedirect('/');
  const page = await getPublishedPage(slug);
  // `notFound()` here, not a "Not found" metadata object.
  //
  // `generateMetadata` resolving successfully commits the response headers, so
  // a `notFound()` later in the page body renders the not-found UI inside a
  // body that has already been sent as **200**. Google indexes those as thin
  // duplicate pages, and every renamed slug quietly becomes one. Throwing from
  // metadata sets the status before anything is flushed.
  if (!page) notFound();
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
  // One page, one address. `/pages/home` and `/` would otherwise be duplicate
  // content competing with each other in search results.
  if (isHomeSlug(slug)) permanentRedirect('/');

  const [page, savedIds] = await Promise.all([
    getPublishedPage(slug),
    getWishlistProductIds(await getSessionToken()),
  ]);
  if (!page) notFound();

  return (
    <article>
      {page.blocks.length === 0 ? (
        <div className="shell py-16 text-center">
          <h1 className="text-3xl">{page.title}</h1>
          <p className="mt-2 text-ink-soft">This page has no content yet.</p>
        </div>
      ) : (
        page.blocks.map((b) => <BlockRenderer key={b.id} type={b.type} data={b.data} savedIds={savedIds} />)
      )}
    </article>
  );
}
