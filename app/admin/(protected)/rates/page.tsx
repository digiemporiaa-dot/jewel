import { requirePermission } from '@/lib/auth/guard';
import { getRatesOverview } from '@/lib/admin/rates';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import RateManager from './RateManager';
import DiamondRateManager from './DiamondRateManager';

export const dynamic = 'force-dynamic';

export default async function RatesPage() {
  await requirePermission('rates.manage');
  const overview = await getRatesOverview();

  return (
    <div>
      <PageHeader
        title="Metal Rates"
        description="Update live rates with a catalogue impact preview. Prices recompute automatically."
      />

      {/* Current rates */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {overview.current.map((r) => (
          <div key={r.purityId} className="border border-line bg-white p-4">
            <p className="text-[0.7rem] tracking-[0.12em] uppercase text-ink-soft">
              {r.metalName} {r.purityName}
            </p>
            <p className="mt-1 font-heading text-xl">{formatCurrency(r.ratePerGram)}<span className="text-sm text-ink-soft">/g</span></p>
            <p className="text-xs text-ink-soft mt-0.5">since {formatDate(r.effectiveFrom)}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <RateManager rates={overview.current} />
        <DiamondRateManager rates={overview.diamondRates} />
      </div>

      {/* History */}
      <div className="mt-6 border border-line bg-white">
        <div className="px-5 py-3 border-b border-line">
          <h2 className="font-heading text-lg">Rate history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-5 py-2 font-medium">Metal / Purity</th>
                <th className="px-5 py-2 font-medium">Rate</th>
                <th className="px-5 py-2 font-medium">Previous</th>
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-5 py-2 font-medium">Changed by</th>
              </tr>
            </thead>
            <tbody>
              {overview.history.map((h) => (
                <tr key={h.id} className="border-b border-line/60">
                  <td className="px-5 py-2">{h.metalName} {h.purityName}</td>
                  <td className="px-5 py-2">{formatCurrency(h.ratePerGram)}/g</td>
                  <td className="px-5 py-2 text-ink-soft">{h.previousRate ? `${formatCurrency(h.previousRate)}/g` : '—'}</td>
                  <td className="px-5 py-2 text-ink-soft">{formatDate(h.effectiveFrom)}</td>
                  <td className="px-5 py-2 text-ink-soft">{h.changedBy ?? 'system'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
