import { getCurrentRates } from '@/lib/rates';
import { formatCurrency } from '@/lib/utils/format';

/**
 * Live metal-rate ticker shown in the top bar. Server component — reads the
 * current rates directly. Display only; pricing lives in lib/pricing (Phase 2).
 */
export default async function RateTicker() {
  const rates = await getCurrentRates();

  if (rates.length === 0) {
    return (
      <span className="text-[0.7rem] tracking-[0.14em] uppercase text-paper/70">
        Today&apos;s rates updating…
      </span>
    );
  }

  return (
    <div className="flex items-center gap-5 overflow-hidden">
      {rates.map((r) => (
        <span
          key={r.purityId}
          className="whitespace-nowrap text-[0.7rem] tracking-[0.12em] uppercase text-paper/80"
        >
          <span className="text-paper/55">
            {r.metalName} {r.purityName}
          </span>{' '}
          <span className="font-medium text-paper">
            {formatCurrency(r.ratePerGram)}/g
          </span>
        </span>
      ))}
    </div>
  );
}
