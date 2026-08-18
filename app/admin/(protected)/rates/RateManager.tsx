'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils/format';
import { previewRateAction, applyRateAction, type PreviewResult } from './actions';

type CurrentRate = { purityId: string; metalName: string; purityName: string; ratePerGram: string };

export default function RateManager({ rates }: { rates: CurrentRate[] }) {
  const router = useRouter();
  const [purityId, setPurityId] = useState(rates[0]?.purityId ?? '');
  const [newRate, setNewRate] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = rates.find((r) => r.purityId === purityId);

  function doPreview() {
    setMessage(null);
    startTransition(async () => {
      const res = await previewRateAction(purityId, newRate);
      setPreview(res);
    });
  }

  function doApply() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('purityId', purityId);
      fd.set('newRate', newRate);
      if (note) fd.set('note', note);
      const res = await applyRateAction(fd);
      if (res.ok) {
        setMessage(`Rate updated. ${res.affected} product${res.affected === 1 ? '' : 's'} recomputed.`);
        setPreview(null);
        setNewRate('');
        setNote('');
        router.refresh();
      } else {
        setMessage(res.error);
      }
    });
  }

  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-lg">Update a rate</h2>
      <p className="text-sm text-ink-soft mb-4">
        Preview the catalogue impact before confirming. All changes are audited.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block mb-1">Purity</span>
          <select
            value={purityId}
            onChange={(e) => {
              setPurityId(e.target.value);
              setPreview(null);
            }}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brass"
          >
            {rates.map((r) => (
              <option key={r.purityId} value={r.purityId}>
                {r.metalName} {r.purityName} — current {formatCurrency(r.ratePerGram)}/g
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block mb-1">New rate (₹ / gram)</span>
          <input
            inputMode="decimal"
            value={newRate}
            onChange={(e) => {
              setNewRate(e.target.value);
              setPreview(null);
            }}
            placeholder={selected ? selected.ratePerGram : '0.00'}
            className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brass"
          />
        </label>
      </div>
      <label className="block text-sm mt-3">
        <span className="block mb-1">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Morning MCX update"
          className="w-full border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brass"
        />
      </label>

      <div className="mt-4 flex gap-3">
        <button onClick={doPreview} disabled={pending || !newRate} className="btn-outline">
          {pending ? 'Working…' : 'Preview impact'}
        </button>
      </div>

      {preview && !preview.ok && (
        <p className="mt-3 text-sm text-red-700">{preview.error}</p>
      )}

      {preview && preview.ok && (
        <div className="mt-4 border border-line-strong bg-paper-2 p-4">
          <p className="eyebrow">Impact preview — {preview.impact.purityLabel}</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Info label="Current rate" value={preview.impact.currentRate ? `${formatCurrency(preview.impact.currentRate)}/g` : '—'} />
            <Info label="New rate" value={`${formatCurrency(preview.impact.newRate)}/g`} />
            <Info label="Products affected" value={String(preview.impact.productsAffected)} />
            <Info label="Avg price" value={`${formatCurrency(preview.impact.oldAvgPrice)} → ${formatCurrency(preview.impact.newAvgPrice)}`} />
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={doApply} disabled={pending} className="btn-primary">
              {pending ? 'Applying…' : 'Confirm & apply'}
            </button>
            <button onClick={() => setPreview(null)} disabled={pending} className="btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-sm">{message}</p>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.7rem] tracking-[0.1em] uppercase text-ink-soft">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
