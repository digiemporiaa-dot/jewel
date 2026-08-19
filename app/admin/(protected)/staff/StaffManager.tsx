'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { createStaffAction, updateStaffAction, resetStaffPasswordAction } from './actions';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'CATALOG_MANAGER', 'SALES_EXECUTIVE', 'DISPATCH'];

type Staff = { id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null };

export default function StaffManager({ staff }: { staff: Staff[] }) {
  return (
    <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
      <NewStaffForm />
      <div className="border border-line bg-white divide-y divide-line/60">
        <div className="px-4 py-3"><h2 className="font-heading text-lg">Staff accounts</h2></div>
        {staff.map((s) => <StaffRow key={s.id} member={s} />)}
      </div>
    </div>
  );
}

function NewStaffForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null); setError(null);
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    start(async () => {
      const res = await createStaffAction(fd);
      if (res.ok) { setMsg('Staff account created'); form.reset(); router.refresh(); }
      else setError(res.error ?? 'Failed');
    });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-5 space-y-3 text-sm h-fit">
      <h2 className="font-heading text-lg">Add staff</h2>
      <F label="Name"><input name="name" required className="st-inp" /></F>
      <F label="Email"><input name="email" type="email" required className="st-inp" /></F>
      <F label="Temporary password"><input name="password" type="password" required minLength={10} className="st-inp" /></F>
      <F label="Role">
        <select name="role" defaultValue="SALES_EXECUTIVE" className="st-inp">
          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
      </F>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {msg && <p className="text-xs text-velvet">{msg}</p>}
      <button disabled={pending} className="btn-primary text-xs">{pending ? 'Creating…' : 'Create account'}</button>
      <p className="text-xs text-ink-soft">Ask the new member to change this password after their first sign-in.</p>
      <style>{`.st-inp{width:100%;border:1px solid var(--line);padding:.5rem .625rem;font-size:.875rem;outline:none}.st-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function StaffRow({ member }: { member: Staff }) {
  const router = useRouter();
  const [role, setRole] = useState(member.role);
  const [isActive, setIsActive] = useState(member.isActive);
  const [newPassword, setNewPassword] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = role !== member.role || isActive !== member.isActive;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateStaffAction(member.id, role, isActive);
      setMsg(res.ok ? 'Saved' : res.error ?? 'Failed');
      if (res.ok) router.refresh(); else { setRole(member.role); setIsActive(member.isActive); }
    });
  }
  function reset() {
    setMsg(null);
    start(async () => {
      const res = await resetStaffPasswordAction(member.id, newPassword);
      setMsg(res.ok ? 'Password reset' : res.error ?? 'Failed');
      if (res.ok) setNewPassword('');
    });
  }

  return (
    <div className="px-4 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{member.name}</p>
          <p className="text-xs text-ink-soft">{member.email}</p>
        </div>
        <span className={cn('text-xs px-2 py-0.5 border rounded-[2px]', isActive ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}>
          {isActive ? 'Active' : 'Disabled'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-line px-2 py-1.5 text-xs outline-none focus:border-brass">
          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active
        </label>
        <button onClick={save} disabled={pending || !dirty} className="btn-outline text-xs py-1 px-3 disabled:opacity-40">Save</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 10)" className="border border-line px-2 py-1.5 text-xs outline-none focus:border-brass"
        />
        <button onClick={reset} disabled={pending || newPassword.length < 10} className="btn-outline text-xs py-1 px-3 disabled:opacity-40">Reset password</button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
