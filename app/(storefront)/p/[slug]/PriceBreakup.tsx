'use client';

import { useState } from 'react';
import { formatCurrency, formatWeight } from '@/lib/utils/format';
import { ChevronDownIcon } from '@/components/icons';
import { cn } from '@/lib/utils/cn';
import type { PriceBreakup as Breakup } from '@/lib/pricing';

/**
 * Expandable "How this price is calculated" breakdown (brief §13). Shows every
 * component, the gold rate used, weight, purity and the rate timestamp.
 */
export default function PriceBreakup({
  breakup,
  weight,
  purity,
}: {
  breakup: Breakup;
  weight: string | null;
  purity: string | null;
}) {
  const [open, setOpen] = useState(false);
  const hasMetal = Number(breakup.metalValue) > 0;
  const hasStones = Number(breakup.diamondValue) + Number(breakup.stoneValue) > 0;

  return (
    <div className="border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
        aria-expanded={open}
      >
        <span className="tracking-[0.06em]">How this price is calculated</span>
        <ChevronDownIcon className={cn('transition-transform', open && 'rotate-180')} width={18} height={18} />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <dl className="text-sm divide-y divide-line/60">
            {hasMetal && <Row label="Metal value" value={formatCurrency(breakup.metalValue)} />}
            {Number(breakup.wastage) > 0 && <Row label="Wastage" value={formatCurrency(breakup.wastage)} />}
            {Number(breakup.making) > 0 && <Row label="Making charges" value={formatCurrency(breakup.making)} />}
            {Number(breakup.diamondValue) > 0 && <Row label="Diamond value" value={formatCurrency(breakup.diamondValue)} />}
            {Number(breakup.stoneValue) > 0 && <Row label="Stone value" value={formatCurrency(breakup.stoneValue)} />}
            {Number(breakup.discount) > 0 && <Row label="Discount" value={`− ${formatCurrency(breakup.discount)}`} />}
            <Row label={`GST (${breakup.gstPercent}%)`} value={formatCurrency(breakup.gst)} />
            <Row label="Total" value={formatCurrency(breakup.unitTotal)} strong />
          </dl>

          <div className="mt-3 pt-3 border-t border-line text-xs text-ink-soft space-y-1">
            {breakup.rateUsed && <p>Metal rate used: <span className="text-ink">{formatCurrency(breakup.rateUsed)}/g</span></p>}
            {weight && <p>Weight: <span className="text-ink">{formatWeight(weight)}</span></p>}
            {purity && <p>Purity: <span className="text-ink">{purity}</span></p>}
            {!hasMetal && !hasStones && <p>Fixed price item.</p>}
            <p>Rate as of {new Date(breakup.computedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between py-2', strong && 'font-medium text-base')}>
      <dt className={strong ? 'text-ink' : 'text-ink-soft'}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
