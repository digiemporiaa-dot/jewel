'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateLeadAction, addFollowUpAction, logCallAction, completeFollowUpAction, deleteLeadAction } from '../actions';
import TypedConfirm from '@/components/admin/TypedConfirm';

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'NEGOTIATION', 'CONVERTED', 'LOST'];

export default function LeadActions({
  lead, staff,
}: {
  lead: {
    id: string; status: string; assignedToId: string | null; estimatedValue: string | null; notes: string | null;
    name: string | null; phone: string | null;
  };
  staff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      setMsg(res.ok ? ok : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  function submitUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('id', lead.id);
    run(() => updateLeadAction(fd), 'Lead updated');
  }
  function submitFollowUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('leadId', lead.id);
    const form = e.currentTarget;
    run(async () => { const r = await addFollowUpAction(fd); if (r.ok) form.reset(); return r; }, 'Follow-up scheduled');
  }
  function submitCall(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('leadId', lead.id);
    const form = e.currentTarget;
    run(async () => { const r = await logCallAction(fd); if (r.ok) form.reset(); return r; }, 'Call logged');
  }

  return (
    <div className="space-y-4 text-sm">
      <form onSubmit={submitUpdate} className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-base">Update lead</h2>
        <L label="Stage">
          <select name="status" defaultValue={lead.status} className="c-inp">
            {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </L>
        <L label="Assigned to">
          <select name="assignedToId" defaultValue={lead.assignedToId ?? ''} className="c-inp">
            <option value="">— unchanged —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </L>
        <L label="Estimated value (₹)"><input name="estimatedValue" defaultValue={lead.estimatedValue ?? ''} inputMode="decimal" className="c-inp" /></L>
        <L label="Notes"><textarea name="notes" defaultValue={lead.notes ?? ''} rows={3} className="c-inp" /></L>
        <button disabled={pending} className="btn-primary text-xs">Save</button>
      </form>

      <form onSubmit={submitFollowUp} className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-base">Schedule follow-up</h2>
        <L label="Due"><input name="dueAt" type="datetime-local" required className="c-inp" /></L>
        <L label="Note"><input name="note" className="c-inp" /></L>
        <button disabled={pending} className="btn-outline text-xs">Schedule</button>
      </form>

      <form onSubmit={submitCall} className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-base">Log a call</h2>
        <L label="Outcome">
          <select name="outcome" className="c-inp">
            {['Connected', 'No answer', 'Busy', 'Wrong number', 'Interested', 'Not interested', 'Callback requested'].map((o) => <option key={o}>{o}</option>)}
          </select>
        </L>
        <L label="Notes"><textarea name="notes" rows={2} className="c-inp" /></L>
        <button disabled={pending} className="btn-outline text-xs">Log call</button>
      </form>

      {/* The only genuine delete in the application: a lead carries no invoice
          and no accounting consequence, so keeping a soft-deleted copy of
          somebody's phone number forever would be hoarding, not caution. */}
      <div className="border-t border-line pt-4">
        <TypedConfirm
          label="Delete this lead"
          expected={lead.phone ?? lead.name ?? lead.id}
          expectedLabel={lead.phone ? 'phone number' : lead.name ? 'name' : 'id'}
          confirmLabel="Delete lead"
          description={
            <>
              <p>This one really is deleted — a lead has no invoice and no payment behind it.</p>
              <p className="mt-1 text-ink-soft">
                Its follow-ups and call logs go with it. The audit log keeps a record of what was removed.
              </p>
            </>
          }
          onConfirm={(typed) => deleteLeadAction(lead.id, typed)}
        />
      </div>

      {msg && <p className="text-xs text-ink-soft">{msg}</p>}
      <style>{`.c-inp{width:100%;border:1px solid var(--line);padding:.45rem .6rem;font-size:.85rem;outline:none}.c-inp:focus{border-color:var(--brass)}`}</style>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}

/** Marks a pending follow-up complete. Rendered inline next to each follow-up. */
export function CompleteFollowUpButton({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => {
        const res = await completeFollowUpAction(followUpId);
        if (res.ok) router.refresh();
      })}
      className="text-xs underline underline-offset-2 hover:text-brass"
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}
