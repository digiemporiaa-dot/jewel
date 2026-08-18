'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils/format';
import { updateDiamondRateAction } from './actions';

type DiamondRate = { id: string; label: string; ratePerCarat: string };

export default function DiamondRateManager({ rates }: { rates: DiamondRate[] }) {
  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-lg">Diamond rates (₹ / carat)</h2>
      <p className="text-sm text-ink-soft mb-4">Updates recompute affected component-priced products.</p>
      <div className="space-y-2">
        {rates.map((r) => (
          <Row key={r.id} rate={r} />
        ))}
        {rates.length === 0 && <p className="text-sm text-ink-soft">No diamond rates configured.</p>}
      </div>
    </div>
  );
}

function Row({ rate }: { rate: { id: string; label: string; ratePerCarat: string } }) {
  const router = useRouter();
  const [value, setValue] = useState(rate.ratePerCarat);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const fd = new FormData();
      fd.set('diamondRateId', rate.id);
      fd.set('newRate', value);
      const res = await updateDiamondRateAction(fd);
      setMsg(res.ok ? 'Saved' : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0">{rate.label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-32 border border-line px-2 py-1.5 outline-none focus:border-brass"
      />
      <span className="text-ink-soft">current {formatCurrency(rate.ratePerCarat)}</span>
      <button onClick={save} disabled={pending || value === rate.ratePerCarat} className="btn-outline text-xs py-1.5 px-3">
        {pending ? '…' : 'Save'}
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
