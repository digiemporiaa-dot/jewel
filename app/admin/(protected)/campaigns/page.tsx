import { requirePermission } from '@/lib/auth/guard';
import { getCampaignSettings, getAbandonedCartStats } from '@/lib/campaigns';
import PageHeader from '@/components/admin/PageHeader';
import StatCard from '@/components/admin/StatCard';
import Link from 'next/link';
import { CampaignCard } from './CampaignForms';

export const dynamic = 'force-dynamic';

const CAMPAIGN_TYPES: [string, string][] = [
  ['ABANDONED_CART', 'Abandoned cart'],
  ['BIRTHDAY', 'Birthday greetings'],
  ['ANNIVERSARY', 'Anniversary greetings'],
  ['NEW_CUSTOMER', 'New customer welcome'],
  ['BACK_IN_STOCK', 'Back in stock'],
  ['PRICE_DROP', 'Price drop'],
  ['ORDER_UPDATE', 'Order updates'],
];

export default async function CampaignsPage() {
  await requirePermission('settings.manage');
  const [{ campaigns }, stats] = await Promise.all([getCampaignSettings(), getAbandonedCartStats()]);

  return (
    <div>
      <PageHeader title="Campaigns" description="When automated emails go out. Their wording lives under Marketing → Email Templates." />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard label="Abandoned carts" value={String(stats.abandoned)} />
        <StatCard label="Recovered" value={String(stats.recovered)} />
        <StatCard label="Reminders pending" value={String(stats.pendingReminders)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="font-heading text-lg">Automations</h2>
          {CAMPAIGN_TYPES.map(([type, name]) => (
            <CampaignCard
              key={type} type={type} name={name}
              campaign={(() => {
                const c = campaigns.find((x) => x.type === type);
                return c ? { id: c.id, type: c.type, name: c.name, isActive: c.isActive, config: (c.config ?? null) as Record<string, unknown> | null } : undefined;
              })()}
            />
          ))}
        </div>

        <div>
          <h2 className="font-heading text-lg mb-4">Wording</h2>
          <div className="border border-line bg-white p-4 text-sm">
            <p className="text-ink-soft">
              The wording of every email — order confirmations, reminders, birthday greetings — is
              edited under <strong>Marketing → Email Templates</strong>, where you can preview each
              one and send yourself a test.
            </p>
            <Link href="/admin/marketing/templates" className="mt-3 inline-block btn-outline text-xs">
              Edit email templates
            </Link>
          </div>

          <div className="mt-4 border border-line bg-white p-4 text-xs text-ink-soft">
            <p className="font-medium text-ink mb-1">Scheduled runs</p>
            <p>Abandoned cart: <code>POST /api/cron/abandoned-cart</code></p>
            <p>Birthdays &amp; anniversaries: <code>POST /api/cron/campaigns</code></p>
            <p className="mt-1">Both require the <code>CRON_SECRET</code> bearer token.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
