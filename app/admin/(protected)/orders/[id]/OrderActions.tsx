'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { transitionOrderAction, verifyOrderAction, confirmPaymentAction, addNoteAction } from '../actions';

export default function OrderActions({
  orderId, allowedTransitions, hasPendingPayment, showVerify,
}: {
  orderId: string; allowedTransitions: string[]; hasPendingPayment: boolean; showVerify: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [next, setNext] = useState(allowedTransitions[0] ?? '');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [vResult, setVResult] = useState('Passed');
  const [vNotes, setVNotes] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? ok : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="border border-line bg-white p-5 space-y-5 text-sm">
      <h2 className="font-heading text-lg">Actions</h2>

      {allowedTransitions.length > 0 && (
        <div>
          <p className="text-xs text-ink-soft mb-1">Change status</p>
          <div className="flex gap-2">
            <select value={next} onChange={(e) => setNext(e.target.value)} className="border border-line px-2 py-1.5 flex-1 outline-none focus:border-brass">
              {allowedTransitions.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <button disabled={pending} onClick={() => run(() => transitionOrderAction(orderId, next), 'Status updated')} className="btn-primary text-xs">Apply</button>
          </div>
        </div>
      )}

      {hasPendingPayment && (
        <div className="border-t border-line pt-4">
          <p className="text-xs text-ink-soft mb-1">Confirm manual payment (bank / token)</p>
          <div className="flex gap-2">
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference / UTR" className="border border-line px-2 py-1.5 flex-1 outline-none focus:border-brass" />
            <button disabled={pending} onClick={() => run(() => confirmPaymentAction(orderId, ref), 'Payment confirmed')} className="btn-outline text-xs">Confirm</button>
          </div>
        </div>
      )}

      {showVerify && (
        <div className="border-t border-line pt-4">
          <p className="text-xs text-ink-soft mb-1">High-value verification</p>
          <div className="flex gap-2 mb-2">
            <select value={vResult} onChange={(e) => setVResult(e.target.value)} className="border border-line px-2 py-1.5 outline-none focus:border-brass">
              <option>Passed</option><option>Failed</option><option>Unreachable</option>
            </select>
            <input value={vNotes} onChange={(e) => setVNotes(e.target.value)} placeholder="Notes" className="border border-line px-2 py-1.5 flex-1 outline-none focus:border-brass" />
          </div>
          <button disabled={pending} onClick={() => run(() => verifyOrderAction(orderId, vResult, vNotes), 'Verification recorded')} className="btn-outline text-xs">Record verification</button>
        </div>
      )}

      <div className="border-t border-line pt-4">
        <p className="text-xs text-ink-soft mb-1">Internal note</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full border border-line px-2 py-1.5 outline-none focus:border-brass" />
        <button disabled={pending || !note.trim()} onClick={() => run(async () => { const r = await addNoteAction(orderId, note); if (r.ok) setNote(''); return r; }, 'Note added')} className="btn-outline text-xs mt-2">Add note</button>
      </div>

      {msg && <p className="text-ink-soft">{msg}</p>}
    </div>
  );
}
