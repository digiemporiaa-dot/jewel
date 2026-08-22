import Link from 'next/link';
import { assertPermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { getSeoSettings } from '@/lib/seo/settings';
import { buildSeoReport } from '@/lib/seo/report';
import SeoForm from './SeoForm';
import { saveSeoSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'SEO' };

export default async function SeoPage() {
  await assertPermission('settings.manage');
  const [settings, report] = await Promise.all([getSeoSettings(), buildSeoReport()]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl">SEO</h1>
        <p className="mt-1 text-sm text-ink-soft">
          How this shop appears in search results and when a link is shared.
        </p>
      </header>

      {!report.indexingEnabled && (
        <p className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Search engines are being told to ignore this entire site.</strong> Nothing here
          will appear on Google until indexing is switched back on below.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pages checked" value={report.counts.total} />
        <Stat label="No description" value={report.counts.missingDescription} warn={report.counts.missingDescription > 0} />
        <Stat label="No social image" value={report.counts.missingImage} warn={report.counts.missingImage > 0} />
        <Stat label="Hidden from search" value={report.counts.hidden} warn={report.counts.hidden > 0} />
      </section>

      <SeoForm
        defaults={{
          titleTemplate: settings.titleTemplate ?? '',
          defaultTitle: settings.defaultTitle ?? '',
          defaultDescription: settings.defaultDescription ?? '',
          defaultOgImageUrl: settings.defaultOgImageUrl ?? '',
          indexingEnabled: settings.indexingEnabled,
          robotsDisallow: settings.robotsDisallow.join('\n'),
          localBusinessEnabled: settings.localBusinessEnabled,
          businessType: settings.businessType ?? '',
          priceRange: settings.priceRange ?? '',
          latitude: settings.latitude ?? '',
          longitude: settings.longitude ?? '',
          bingVerification: settings.bingVerification ?? '',
          pinterestVerification: settings.pinterestVerification ?? '',
        }}
        save={saveSeoSettingsAction}
      />

      {report.duplicates.length > 0 && (
        <section className="border border-line bg-white p-4">
          <h2 className="font-heading text-lg">Pages sharing a title</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Pages with the same title compete with each other for the same search. Give each one a
            title that says what makes it different.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {report.duplicates.slice(0, 10).map((d) => (
              <li key={d.title} className="border-t border-line/60 pt-2">
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-ink-soft">
                  {d.paths.length} pages — {d.paths.slice(0, 4).join(', ')}
                  {d.paths.length > 4 ? ` and ${d.paths.length - 4} more` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-heading text-lg">Pages needing attention</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {report.pages.length === 0
              ? 'Nothing to fix — every page has a title, a description and a social image.'
              : 'Worst first. Edit each page to fix these.'}
          </p>
        </div>
        {report.pages.length > 0 && (
          <ul className="divide-y divide-line">
            {report.pages.slice(0, 50).map((page) => (
              <li key={page.path} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">{page.kind}</span>
                  <span className="font-medium text-sm">{page.label}</span>
                  <Link href={page.path} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
                    {page.path}
                  </Link>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {page.warnings.map((w, i) => (
                    <li
                      key={i}
                      className={w.severity === 'error' ? 'text-xs text-red-700' : 'text-xs text-ink-soft'}
                    >
                      {w.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {report.pages.length > 50 && (
          <p className="border-t border-line px-4 py-2 text-xs text-ink-soft">
            Showing the first 50 of {report.pages.length}.
          </p>
        )}
      </section>

      <SitemapNote />
    </div>
  );
}

async function SitemapNote() {
  const [products, posts] = await Promise.all([
    prisma.product.count({ where: { isActive: true, deletedAt: null, noIndex: false } }),
    prisma.blogPost.count({ where: { status: 'PUBLISHED', noIndex: false } }),
  ]);

  return (
    <section className="border border-line bg-paper-2 p-4 text-xs text-ink-soft">
      <p className="mb-1 font-medium text-ink">Sitemap and robots</p>
      <p>
        Both are generated from live data — <code>/sitemap.xml</code> currently lists {products}{' '}
        products and {posts} journal posts, plus categories, collections and pages. A page marked
        &ldquo;hidden from search&rdquo; is left out of it, so the sitemap never advertises
        something the page itself tells crawlers to ignore.
      </p>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`border p-3 ${warn ? 'border-amber-300 bg-amber-50' : 'border-line bg-white'}`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="font-heading text-xl">{value}</p>
    </div>
  );
}
