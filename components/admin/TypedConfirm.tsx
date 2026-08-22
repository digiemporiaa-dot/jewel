'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * A destructive action that has to be typed out.
 *
 * "Are you sure?" is answered yes by reflex — it is a speed bump, not a
 * decision. Typing the SKU or the phone number forces somebody to read which
 * record is actually on screen, which is exactly the check that matters when the
 * previous page was a list of forty similar rows.
 *
 * The server checks the typed value again. A confirmation only the browser
 * enforces is not a confirmation.
 */
export default function TypedConfirm({
  label, description, expected, expectedLabel, confirmLabel, onConfirm, tone = 'danger',
}: {
  /** The button that opens the confirmation. */
  label: string;
  description: React.ReactNode;
  /** The exact text that must be typed. */
  expected: string;
  /** What to call it in the prompt, e.g. "SKU" or "phone number". */
  expectedLabel: string;
  confirmLabel: string;
  onConfirm: (typed: string) => Promise<{ ok: boolean; error?: string }>;
  tone?: 'danger' | 'neutral';
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const matches = typed.trim().toLowerCase() === expected.trim().toLowerCase();

  if (done) return <p className="text-sm text-ink-soft">Done.</p>;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn('btn-outline text-xs', tone === 'danger' && 'text-red-700 border-red-300')}
      >
        {label}
      </button>
    );
  }

  return (
    <div className={cn('border p-3 space-y-2 max-w-md', tone === 'danger' ? 'border-red-300' : 'border-line')}>
      <div className="text-sm">{description}</div>
      <label className="block">
        <span className="block mb-1 text-xs text-ink-soft">
          Type the {expectedLabel} <strong>{expected}</strong> to confirm
        </span>
        <input
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setError(null); }}
          autoFocus
          className="w-full border border-line px-2 py-1.5 text-sm outline-none focus:border-brass"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          disabled={pending || !matches}
          onClick={() => start(async () => {
            const res = await onConfirm(typed);
            if (!res.ok) setError(res.error ?? 'Failed');
            else setDone(true);
          })}
          className={cn(
            'btn-primary text-xs py-1 disabled:opacity-50',
            tone === 'danger' && 'bg-red-700 hover:bg-red-800'
          )}
        >
          {pending ? '…' : confirmLabel}
        </button>
        <button onClick={() => { setOpen(false); setTyped(''); setError(null); }} className="btn-outline text-xs py-1">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
