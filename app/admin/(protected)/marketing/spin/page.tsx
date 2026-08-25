import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import PageHeader from '@/components/admin/PageHeader';
import StatCard from '@/components/admin/StatCard';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { parseSegments, DEFAULT_SEGMENTS } from '@/lib/spin/segments';
import SpinCampaignForm from './SpinCampaignForm';

export const dynamic = 'force-dynamic';

function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function SpinAdminPage() {
  await requirePermission('settings.manage');

  const campaign = await prisma.spinCampaign.findFirst({ orderBy: { createdAt: 'desc' } });
  const stored = campaign ? parseSegments(campaign.segments) : null;

  const results = campaign
    ? await prisma.spinResult.findMany({
        where: { campaignId: campaign.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, segmentLabel: true, createdAt: true,
          customer: { select: { phone: true, name: true } },
          coupon: { select: { code: true, usageCount: true, endsAt: true } },
        },
      })
    : [];

  const [spins, wins, redeemed] = campaign
    ? await Promise.all([
        prisma.spinResult.count({ where: { campaignId: campaign.id } }),
        prisma.spinResult.count({ where: { campaignId: campaign.id, couponId: { not: null } } }),
        // Redemption is counted on the coupon, not guessed from the order table:
        // `usageCount` is incremented inside the order transaction, so it is the
        // one number that cannot drift from what was actually honoured.
        prisma.spinResult.count({ where: { campaignId: campaign.id, coupon: { usageCount: { gt: 0 } } } }),
      ])
    : [0, 0, 0];

  return (
    <div>
      <PageHeader
        title="Spin to win"
        description="A wheel offering a first-order discount. Prizes are real coupon codes, scoped to making charges."
      />

      {campaign && stored && !stored.ok && (
        <p className="mb-5 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>This wheel is not running.</strong> Its prize table is invalid ({stored.error}), so the
          storefront is treating it as switched off. Fix the segments below and save.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Spins" value={String(spins)} />
        <StatCard label="Prizes won" value={String(wins)} />
        <StatCard label="Codes redeemed" value={String(redeemed)} />
        {/* Redeemed over won, not over spins: the question an operator is asking
            is whether the prizes are bringing anyone back, and a losing spin was
            never going to. */}
        <StatCard label="Prize conversion" value={wins > 0 ? `${Math.round((redeemed / wins) * 100)}%` : '—'} />
      </div>

      <SpinCampaignForm
        defaults={{
          id: campaign?.id,
          name: campaign?.name ?? 'First-order spin',
          isActive: campaign?.isActive ?? false,
          perPhoneLimit: campaign?.perPhoneLimit ?? 1,
          couponValidityDays: campaign?.couponValidityDays ?? 30,
          startsAt: toLocalInput(campaign?.startsAt ?? null),
          endsAt: toLocalInput(campaign?.endsAt ?? null),
          segments: stored?.ok ? stored.segments : DEFAULT_SEGMENTS,
        }}
      />

      <h2 className="font-heading text-lg mt-8 mb-3">Recent spins</h2>
      {results.length === 0 ? (
        <div className="border border-line bg-white p-8 text-center text-sm text-ink-soft">
          Nobody has spun yet.
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-soft">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Landed on</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Redeemed</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2 text-ink-soft">{formatDate(r.createdAt)}</td>
                  <td className="px-4 py-2">
                    {r.customer.name ?? '—'}
                    <span className="block text-xs text-ink-soft">{r.customer.phone}</span>
                  </td>
                  <td className="px-4 py-2">{r.segmentLabel}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.coupon?.code ?? '—'}</td>
                  <td className="px-4 py-2">
                    {!r.coupon ? (
                      <span className="text-ink-soft">No prize</span>
                    ) : (
                      <span className={cn('text-xs px-2 py-0.5 border rounded-[2px]',
                        r.coupon.usageCount > 0 ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}>
                        {r.coupon.usageCount > 0 ? 'Yes' : 'Not yet'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
