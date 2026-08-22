import type { MetadataRoute } from 'next';
import { getSeoSettings, siteUrl } from '@/lib/seo/settings';

export const dynamic = 'force-dynamic';

/**
 * robots.txt.
 *
 * The private areas below are not configurable, deliberately: a bag, a checkout
 * and an account page must never be crawlable, and making that an editable list
 * is inviting somebody to remove `/checkout` from it. What an operator *can* add
 * is extra paths, and what they can do is turn the whole site off.
 */
const ALWAYS_DISALLOW = [
  '/admin',
  '/admin/',
  '/api/',
  '/cart',
  '/checkout',
  '/my-account',
  '/order/',
  '/wishlist',
  '/search',
];

/** Keep only what is safe to write into a robots.txt rule. */
function cleanPaths(paths: string[]): string[] {
  return paths
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.includes('\n') && !p.includes('\r'))
    .map((p) => (p.startsWith('/') ? p : `/${p}`));
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = siteUrl();
  const seo = await getSeoSettings();

  // The master switch. While a shop is being set up this keeps the whole site
  // out of search; the admin warns loudly if it is still off after launch.
  if (!seo.indexingEnabled) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      host: base,
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...ALWAYS_DISALLOW, ...cleanPaths(seo.robotsDisallow)],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
