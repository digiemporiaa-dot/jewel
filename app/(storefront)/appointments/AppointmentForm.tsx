'use client';

import { useState, useEffect, useTransition } from 'react';
import { cn } from '@/lib/utils/cn';
import { getSlotsAction, bookAppointmentAction } from './actions';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AppointmentForm({
  products, defaultProductId,
}: {
  products: { id: string; name: string }[];
  defaultProductId?: string;
}) {
  const [type, setType] = useState<'SHOWROOM_VISIT' | 'VIDEO_CONSULTATION'>('SHOWROOM_VISIT');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState(todayIso());
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState('');
  const [productId, setProductId] = useState(defaultProductId ?? '');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Load available slots whenever the date changes.
  useEffect(() => {
    let cancelled = false;
    getSlotsAction(date).then((s) => {
      if (!cancelled) { setSlots(s); setSlot((cur) => (s.includes(cur) ? cur : '')); }
    });
    return () => { cancelled = true; };
  }, [date]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await bookAppointmentAction({ type, name, phone, email, date, slot, productId, notes });
      if (res.ok) setDone(true);
      else setError(res.error ?? 'Could not book');
    });
  }

  if (done) {
    return (
      <div className="border border-line bg-white p-8 text-center">
        <p className="eyebrow">Requested</p>
        <h2 className="mt-2 font-heading text-2xl">We&apos;ll see you soon</h2>
        <p className="mt-2 text-ink-soft text-sm">
          Your {type === 'VIDEO_CONSULTATION' ? 'video consultation' : 'showroom visit'} on {new Date(date).toDateString()} at {slot} has been requested.
          Our team will call to confirm.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-6 space-y-4">
      <div>
        <p className="text-xs tracking-[0.1em] uppercase text-ink-soft mb-2">Appointment type</p>
        <div className="grid grid-cols-2 gap-2">
          {([['SHOWROOM_VISIT', 'Showroom visit'], ['VIDEO_CONSULTATION', 'Video consultation']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setType(v)}
              className={cn('border p-3 text-sm rounded-[2px] transition-colors', type === v ? 'border-velvet bg-paper-2' : 'border-line hover:border-brass')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <F label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} required className="a-inp" /></F>
        <F label="Mobile number"><input value={phone} onChange={(e) => setPhone(e.target.value)} required className="a-inp" /></F>
      </div>
      <F label="Email (for confirmation)"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="a-inp" /></F>

      <div className="grid sm:grid-cols-2 gap-3">
        <F label="Preferred date">
          <input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required className="a-inp" />
        </F>
        <F label="Product of interest (optional)">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="a-inp">
            <option value="">Not sure yet</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </F>
      </div>

      <div>
        <p className="text-xs tracking-[0.1em] uppercase text-ink-soft mb-2">Available time slots</p>
        {slots.length === 0 ? (
          <p className="text-sm text-ink-soft">No slots available on this date — please choose another.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <button key={s} type="button" onClick={() => setSlot(s)}
                className={cn('px-3 py-2 text-sm border rounded-[2px] transition-colors', slot === s ? 'border-velvet bg-velvet text-paper' : 'border-line hover:border-brass')}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <F label="Anything we should know? (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="a-inp" />
      </F>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <button disabled={pending || !slot || !name || !phone} className="btn-primary w-full">
        {pending ? 'Booking…' : 'Request appointment'}
      </button>
      <style>{`.a-inp{width:100%;border:1px solid var(--line);padding:.6rem .75rem;font-size:.9rem;outline:none;background:#fff}.a-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
