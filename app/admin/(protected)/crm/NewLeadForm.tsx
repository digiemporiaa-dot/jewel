'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLeadAction } from './actions';

export default function NewLeadForm({ staff }: { staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    start(async () => {
      const res = await createLeadAction(fd);
      if (res.ok) { form.reset(); setOpen(false); router.refresh(); }
      else setError(res.error ?? 'Failed');
    });
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="btn-primary text-xs">New lead</button>;
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-4 space-y-3 text-sm w-full">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base">New lead</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft">Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <L label="Name"><input name="name" required className="c-inp" /></L>
        <L label="Phone"><input name="phone" required className="c-inp" /></L>
        <L label="Email"><input name="email" type="email" className="c-inp" /></L>
        <L label="Source">
          <select name="source" className="c-inp" defaultValue="PHONE">
            {['PHONE','WEBSITE','WHATSAPP','WALK_IN','REFERRAL','APPOINTMENT','ABANDONED_CART'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
          </select>
        </L>
        <L label="Estimated value (₹)"><input name="estimatedValue" inputMode="decimal" className="c-inp" /></L>
        <L label="Assign to">
          <select name="assignedToId" className="c-inp"><option value="">Me</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </L>
      </div>
      <L label="Notes"><textarea name="notes" rows={2} className="c-inp" /></L>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button disabled={pending} className="btn-primary text-xs">{pending ? 'Saving…' : 'Create lead'}</button>
      <style>{`.c-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.c-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
