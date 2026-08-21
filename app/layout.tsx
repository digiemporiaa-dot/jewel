import type { Metadata } from 'next';
import { Bodoni_Moda, Jost } from 'next/font/google';
import './globals.css';
import { getStoreSettings } from '@/lib/store';
import { getTagConfig } from '@/lib/marketing/config';
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
  const [store, tags] = await Promise.all([getStoreSettings(), getTagConfig()]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${store.brandName} — ${store.tagline}`,
      template: `%s · ${store.brandName}`,
    },
    description: store.tagline,
    openGraph: {
      title: store.brandName,
      description: store.tagline,
      type: 'website',
      locale: 'en_IN',
    },
    robots: { index: true, follow: true },
    // Search Console ownership. A meta tag, not a script — Next renders it into
    // <head> for us, so the stored value never touches executable markup.
    ...(tags.googleSiteVerification
      ? { verification: { google: tags.googleSiteVerification } }
      : {}),
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
  const store = await getStoreSettings();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const social = (store.socialLinks as Record<string, string> | null) ?? {};

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}#organization`,
        name: store.brandName,
        url: siteUrl,
        ...(store.logoUrl ? { logo: store.logoUrl } : {}),
        ...(store.phone
          ? { contactPoint: [{ '@type': 'ContactPoint', telephone: store.phone, contactType: 'customer service', areaServed: 'IN' }] }
          : {}),
        ...(store.addressLine
          ? {
              address: {
                '@type': 'PostalAddress',
                streetAddress: store.addressLine,
                addressLocality: store.city ?? undefined,
                addressRegion: store.state ?? undefined,
                postalCode: store.pincode ?? undefined,
                addressCountry: store.country ?? 'IN',
              },
            }
          : {}),
        sameAs: Object.values(social).filter(Boolean),
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}#website`,
        url: siteUrl,
        name: store.brandName,
        publisher: { '@id': `${siteUrl}#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/search?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />;
}
