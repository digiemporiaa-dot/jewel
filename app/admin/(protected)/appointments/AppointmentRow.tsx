'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateAppointmentAction } from './actions';

const STATUSES = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export default function AppointmentRow({
  appointment, staff,
}: {
  appointment: { id: string; status: string; staffId: string | null };
  staff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(appointment.status);
  const [staffId, setStaffId] = useState(appointment.staffId ?? '');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateAppointmentAction(appointment.id, status, staffId);
      setMsg(res.ok ? 'Saved' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  const dirty = status !== appointment.status || staffId !== (appointment.staffId ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-line px-2 py-1.5 text-xs outline-none focus:border-brass">
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
      </select>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="border border-line px-2 py-1.5 text-xs outline-none focus:border-brass">
        <option value="">Unassigned</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button onClick={save} disabled={pending || !dirty} className="btn-outline text-xs py-1 px-3 disabled:opacity-40">
        {pending ? '…' : 'Save'}
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
