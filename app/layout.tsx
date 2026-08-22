import type { Metadata } from 'next';
import { Bodoni_Moda, Jost } from 'next/font/google';
import './globals.css';
import { getStoreSettings } from '@/lib/store';
import { getTagConfig } from '@/lib/marketing/config';
import { seoDefaults, getSeoSettings, siteUrl } from '@/lib/seo/settings';
import { siteGraphLd, serialiseJsonLd } from '@/lib/seo/jsonld';
import TagScripts from '@/components/marketing/TagScripts';
import ConsentBanner from '@/components/marketing/ConsentBanner';

const bodoni = Bodoni_Moda({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-bodoni',
  display: 'swap',
});

const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-jost',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const [defaults, seo, tags] = await Promise.all([seoDefaults(), getSeoSettings(), getTagConfig()]);

  // The title template is applied by Next from here, which is why `buildMetadata`
  // returns each page's own untemplated title — applying it in both places would
  // suffix the brand name twice.
  const template = defaults.titleTemplate?.includes('%s') ? defaults.titleTemplate : '%s';

  return {
    metadataBase: new URL(defaults.siteUrl),
    title: { default: defaults.defaultTitle ?? defaults.brandName, template },
    description: defaults.defaultDescription ?? undefined,
    openGraph: {
      title: defaults.defaultTitle ?? defaults.brandName,
      description: defaults.defaultDescription ?? undefined,
      siteName: defaults.brandName,
      type: 'website',
      locale: 'en_IN',
      ...(defaults.defaultOgImageUrl ? { images: [{ url: defaults.defaultOgImageUrl }] } : {}),
    },
    // The site-wide switch. A shop still being set up should not be indexed, and
    // this is the one place that can turn the whole site off.
    robots: defaults.indexingEnabled
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    // Ownership verification. Meta tags, not scripts — Next renders them into
    // <head> for us, so a stored value never touches executable markup.
    verification: {
      ...(tags.googleSiteVerification ? { google: tags.googleSiteVerification } : {}),
      // Both go in one `other` map. Spreading two `other` keys would silently
      // drop the first, so a shop that verified with Bing and Pinterest would
      // lose one of them.
      other: {
        ...(seo.bingVerification ? { 'msvalidate.01': seo.bingVerification } : {}),
        ...(seo.pinterestVerification ? { 'p:domain_verify': seo.pinterestVerification } : {}),
      },
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tags = await getTagConfig();

  return (
    <html lang="en-IN" className={`${bodoni.variable} ${jost.variable}`}>
      <body>
        {/* Skip link — first focusable element, for keyboard and screen readers. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:left-4 focus:top-4 focus:bg-velvet focus:text-paper focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <OrganizationSchema />
        {children}
        {/* Analytics last: nothing here may compete with first paint. */}
        <TagScripts config={tags} />
        <ConsentBanner config={tags} />
      </body>
    </html>
  );
}

/** Organization + WebSite structured data, emitted site-wide (brief §28). */
async function OrganizationSchema() {
  const [store, seo] = await Promise.all([getStoreSettings(), getSeoSettings()]);
  const social = (store.socialLinks as Record<string, string> | null) ?? {};

  const ld = siteGraphLd({
    siteUrl: siteUrl(),
    brandName: store.brandName,
    logoUrl: store.logoUrl,
    phone: store.phone,
    email: store.email,
    addressLine: store.addressLine,
    city: store.city,
    state: store.state,
    pincode: store.pincode,
    country: store.country,
    socialLinks: Object.values(social).filter(Boolean),
    localBusinessEnabled: seo.localBusinessEnabled,
    businessType: seo.businessType,
    priceRange: seo.priceRange,
    latitude: seo.latitude,
    longitude: seo.longitude,
    openingHours: seo.openingHours,
  });

  // serialiseJsonLd, not JSON.stringify: a shop name containing "</script>"
  // would otherwise close the tag early and be parsed as HTML.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialiseJsonLd(ld) }} />;
}
