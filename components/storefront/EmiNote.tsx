'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils/format';
import { DISCLAIMER, type EmiOption } from '@/lib/emi';

/**
 * "EMI from ₹X/month", with the full tenure table behind a disclosure.
 *
 * The headline is the cheapest monthly figure. It is always accompanied by the
 * disclaimer: the bank sets the real tenure and rate at checkout, and a firm
 * quote it then refuses is a support problem and a trust problem.
 *
 * Renders nothing when `best` is null — below the bank minimum, no tenures
 * configured, or EMI switched off.
 */
export default function EmiNote({
  best,
  options,
  className,
}: {
  best: EmiOption | null;
  options: EmiOption[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!best) return null;

  return (
    <div className={className}>
      <p className="text-sm text-ink-soft">
        EMI from <strong className="text-ink">{formatCurrency(best.monthly)}</strong>/month
        {options.length > 1 && (
          <>
            {' · '}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="underline decoration-line-strong underline-offset-2 hover:text-brass"
            >
              {open ? 'Hide plans' : 'View plans'}
            </button>
          </>
        )}
      </p>

      {open && (
        <div className="mt-2 border border-line bg-paper-2/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="px-3 py-2 font-normal">Tenure</th>
                <th className="px-3 py-2 font-normal">Per month</th>
                <th className="px-3 py-2 font-normal">Interest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {options.map((o) => (
                <tr key={o.months}>
                  <td className="px-3 py-2">{o.months} months</td>
                  <td className="px-3 py-2">{formatCurrency(o.monthly)}</td>
                  <td className="px-3 py-2 text-ink-soft">
                    {Number(o.interest) === 0 ? 'No cost' : formatCurrency(o.interest)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-1 text-xs text-ink-soft">{DISCLAIMER}</p>
    </div>
  );
}
