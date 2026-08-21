import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { toPublicTagConfig, activeTags, gtmSupersedes, maskSecret, TAG_FIELDS } from '@/lib/marketing/tags';
import PageHeader from '@/components/admin/PageHeader';
import TagsForm from './TagsForm';

export const dynamic = 'force-dynamic';

export default async function MarketingTagsPage() {
  await requirePermission('settings.manage');

  const row = await prisma.marketingTags.findUnique({ where: { id: 'default' } });
  const config = toPublicTagConfig(row as Record<string, unknown> | null);
  const live = activeTags(config);
  const superseded = gtmSupersedes(config);

  return (
    <div>
      <PageHeader
        title="Tracking & Pixels"
        description="Paste the IDs from each platform. Nothing here accepts a script — anything unusual belongs in GTM."
      />

      {/* What's live right now — so "is tracking on?" is answerable at a glance. */}
      <section className="mb-6 border border-line bg-white p-4">
        <h2 className="font-heading text-lg">What&apos;s live right now</h2>
        {live.length === 0 ? (
          <p className="mt-1.5 text-sm text-ink-soft">
            Nothing is tracking. The storefront loads no third-party scripts at all, and its security
            policy stays at the strict default.
          </p>
        ) : (
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {live.map((tag) => (
              <li
                key={tag.key}
                className="border border-velvet/30 bg-velvet/5 px-2.5 py-1 text-xs"
                title={tag.value}
              >
                <span className="text-velvet">{tag.label}</span>
              </li>
            ))}
          </ul>
        )}

        {superseded.length > 0 && (
          <p className="mt-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>Google Tag Manager is handling tracking.</strong>{' '}
            {superseded.map((k) => TAG_FIELDS[k].label).join(', ')}{' '}
            {superseded.length === 1 ? 'is' : 'are'} saved below but <strong>not loaded</strong>, because
            running a tag directly <em>and</em> through GTM counts every conversion twice — which
            quietly inflates the ROAS you use to set ad spend. Configure {superseded.length === 1 ? 'it' : 'them'} inside
            your GTM container instead.
          </p>
        )}

        <p className="mt-3 text-xs text-ink-soft">
          Changes reach the live site within about 30 seconds. No redeploy needed.
        </p>
      </section>

      <TagsForm
        defaults={{
          gtmId: config.gtmId ?? '',
          ga4MeasurementId: config.ga4MeasurementId ?? '',
          googleAdsId: config.googleAdsId ?? '',
          googleAdsLabel: config.googleAdsLabel ?? '',
          googleSiteVerification: config.googleSiteVerification ?? '',
          metaPixelId: config.metaPixelId ?? '',
          clarityProjectId: config.clarityProjectId ?? '',
          hotjarSiteId: config.hotjarSiteId ?? '',
          pinterestTagId: config.pinterestTagId ?? '',
          tiktokPixelId: config.tiktokPixelId ?? '',
          snapPixelId: config.snapPixelId ?? '',
          consentMode: config.consentMode,
          consentBannerText: config.consentBannerText ?? '',
          metaCapiEnabled: row?.metaCapiEnabled ?? false,
        }}
        capiTokenMask={maskSecret(row?.metaCapiToken)}
      />
    </div>
  );
}
