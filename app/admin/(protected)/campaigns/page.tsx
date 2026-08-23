import { requirePermission } from '@/lib/auth/guard';
import { getCampaignSettings, getAbandonedCartStats } from '@/lib/campaigns';
import { CAMPAIGNS } from '@/lib/campaigns/registry';
import { isEmailConfigured } from '@/lib/email';
import PageHeader from '@/components/admin/PageHeader';
import StatCard from '@/components/admin/StatCard';
import Link from 'next/link';
import { CampaignCard } from './CampaignForms';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  await requirePermission('settings.manage');
  const [{ campaigns }, stats] = await Promise.all([getCampaignSettings(), getAbandonedCartStats()]);
  const smtpReady = isEmailConfigured();

  return (
    <div>
      <PageHeader title="Campaigns" description="Every email the shop sends on its own. Switch one off and it stops." />

      {/* First thing on the screen, because it makes every switch below it moot.
          It was previously only on the templates page, so an operator could turn
          five campaigns on here and never learn that none of them can send. */}
      {!smtpReady && (
        <p className="mb-6 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>No mail server is configured, so none of these will send.</strong> Set
          <code className="mx-1">SMTP_HOST</code> and <code className="mx-1">SMTP_PORT</code> on the
          deployment first — the switches below are saved either way, they just have nothing to send with.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Abandoned carts" value={String(stats.abandoned)} />
        <StatCard label="Recovered" value={String(stats.recovered)} />
        <StatCard label="Reminders pending" value={String(stats.pendingReminders)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="font-heading text-lg">Automations</h2>
          {CAMPAIGNS.map((definition) => {
            const c = campaigns.find((x) => x.type === definition.type);
            return (
              <CampaignCard
                key={definition.type}
                definition={definition}
                smtpReady={smtpReady}
                campaign={c ? { id: c.id, type: c.type, name: c.name, isActive: c.isActive, config: (c.config ?? null) as Record<string, unknown> | null } : undefined}
              />
            );
          })}
        </div>

        <div className="space-y-4">
          <h2 className="font-heading text-lg">Wording</h2>
          <div className="border border-line bg-white p-4 text-sm">
            <p className="text-ink-soft">
              Each card above links straight to the email it sends. To see all of them together —
              including order confirmations and appointment emails, which always send — use the full
              list, where you can preview each one and send yourself a test.
            </p>
            <Link href="/admin/marketing/templates" className="mt-3 inline-block btn-outline text-xs">
              All email templates
            </Link>
          </div>

          <div className="border border-line bg-white p-4 text-xs text-ink-soft">
            <p className="font-medium text-ink mb-1">Scheduled runs</p>
            <p>Abandoned cart: <code>POST /api/cron/abandoned-cart</code></p>
            <p>Birthdays &amp; anniversaries: <code>POST /api/cron/campaigns</code></p>
            <p>Price drops: <code>POST /api/cron/recompute-prices</code></p>
            <p className="mt-1">All require the <code>CRON_SECRET</code> bearer token. Their last run
            is shown on the dashboard under System health.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
