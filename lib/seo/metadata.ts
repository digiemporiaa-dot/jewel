import 'server-only';
import type { Metadata } from 'next';
import { resolveSeo, type SeoInput } from '@/lib/seo/resolve';
import { seoDefaults } from '@/lib/seo/settings';

/**
 * One `generateMetadata` implementation, used by every public route.
 *
 * Before this, each page assembled its own `Metadata` object, which meant the
 * canonical, the OG image fallback and the robots directive were re-decided —
 * and re-got-wrong — sixteen times. Now a route describes its page and this
 * decides what that means.
 *
 * Anything a route does not supply falls back through the chain in
 * `lib/seo/resolve.ts`, so a new page cannot ship with no description by
 * omission.
 */
export async function buildMetadata(
  input: SeoInput,
  options: { absoluteTitle?: boolean } = {}
): Promise<Metadata> {
  const defaults = await seoDefaults();
  const seo = resolveSeo(input, defaults);

  return {
    // `title` is the page's own; the template in the root layout supplies the
    // brand suffix. Passing `fullTitle` here would apply it twice.
    //
    // The home page opts out: its title is already the site's full title, so
    // templating it produces "Maya Jewellers — … · Maya Jewellers".
    title: options.absoluteTitle ? { absolute: seo.title } : seo.title,
    description: seo.description ?? undefined,
    alternates: { canonical: seo.canonical },
    openGraph: {
      title: options.absoluteTitle ? seo.title : seo.fullTitle,
      description: seo.description ?? undefined,
      url: seo.canonical,
      siteName: defaults.brandName,
      type: 'website',
      locale: 'en_IN',
      images: seo.ogImage ? [{ url: seo.ogImage }] : undefined,
    },
    twitter: {
      card: seo.ogImage ? 'summary_large_image' : 'summary',
      title: options.absoluteTitle ? seo.title : seo.fullTitle,
      description: seo.description ?? undefined,
      images: seo.ogImage ? [seo.ogImage] : undefined,
    },
    robots: seo.noIndex
      ? // `nocache` and the image/snippet limits matter too: a page can stay out
        // of results and still have its images and snippets shown without them.
        { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } }
      : { index: true, follow: true },
  };
}

/**
 * Metadata for a page that must never be indexed — the bag, checkout, the
 * account area, an order confirmation.
 *
 * A separate function rather than a flag, so it is obvious at the call site that
 * a page is deliberately private, and so a private page cannot accidentally
 * inherit `indexingEnabled` and become crawlable.
 */
export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
  };
}
