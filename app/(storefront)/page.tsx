import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import { getHomePage } from '@/lib/cms';
import { HOME_BLUEPRINT } from '@/lib/cms/home';
import BlockRenderer from '@/components/cms/BlockRenderer';
import { getSessionToken } from '@/lib/session';
import { getWishlistProductIds } from '@/lib/wishlist';

export const dynamic = 'force-dynamic';

/**
 * The homepage.
 *
 * It is a CMS page — reserved slug `home` — so a shop can change its own hero
 * picture, headline and buttons without a developer and without a deploy. Until
 * someone opens the CMS there is no such page, so the same design renders from
 * the blueprint in lib/cms/home.ts instead. One design, two sources: the
 * database when it has an answer, the blueprint when it does not.
 *
 * Nothing here is client-specific, which is the point — the build gets
 * redeployed for other jewellers, and their homepage is content, not a diff.
 */
async function homeBlocks() {
  const page = await getHomePage();
  if (!page || page.blocks.length === 0) {
    return { page: null, blocks: HOME_BLUEPRINT.map((b, i) => ({ id: `blueprint-${i}`, type: b.type, data: b.data })) };
  }
  return { page, blocks: page.blocks };
}

/**
 * The home page needs its own metadata for one reason: the canonical.
 *
 * Inheriting from the root layout gave it a title and a description but no
 * `<link rel="canonical">`, so `/`, `/?utm_source=…` and any other query string
 * were all indexable as separate URLs of the busiest page on the site.
 */
export async function generateMetadata(): Promise<Metadata> {
  const page = await getHomePage();
  // `absoluteTitle` because the site default title already names the brand;
  // letting the template add it again gives "Maya Jewellers — … · Maya Jewellers".
  return buildMetadata(
    {
      path: '/',
      // Falling back to '' keeps the site-wide default title when the homepage
      // has no SEO title of its own — the page's *internal* name ("Homepage")
      // must never become a browser tab title.
      fallbackTitle: '',
      seoTitle: page?.seoTitle ?? null,
      seoDescription: page?.seoDescription ?? null,
      ogImageUrl: page?.ogImageUrl ?? null,
      // `noIndex` is honoured but the canonical override is not: `/` is the
      // canonical home of the site by definition, and letting a typo in that
      // field point the front door somewhere else is not a risk worth taking.
      noIndex: page?.noIndex ?? false,
    },
    { absoluteTitle: true }
  );
}

export default async function HomePage() {
  const [{ blocks }, savedIds] = await Promise.all([
    homeBlocks(),
    getWishlistProductIds(await getSessionToken()),
  ]);

  return (
    <>
      {blocks.map((b) => (
        <BlockRenderer key={b.id} type={b.type} data={b.data} savedIds={savedIds} />
      ))}
    </>
  );
}
