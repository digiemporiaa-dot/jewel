'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveCampaignAction } from './actions';

type Campaign = { id: string; type: string; name: string; isActive: boolean; config: Record<string, unknown> | null };

export function CampaignCard({ type, name, campaign }: { type: string; name: string; campaign?: Campaign }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const cfg = (campaign?.config ?? {}) as { abandonAfterMinutes?: number; stageDelaysMinutes?: number[]; minGapMinutes?: number };
  const stages = cfg.stageDelaysMinutes ?? [60, 1440, 4320];
  const isCart = type === 'ABANDONED_CART';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set('type', type);
    start(async () => {
      const res = await saveCampaignAction(fd);
      setMsg(res.ok ? 'Saved' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-base">{name}</h3>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="isActive" defaultChecked={campaign?.isActive ?? true} /> Active
        </label>
      </div>
      <input type="hidden" name="name" value={name} />

      {isCart && (
        <div className="grid grid-cols-2 gap-2">
          <L label="Abandon after (min)"><input name="abandonAfterMinutes" type="number" defaultValue={cfg.abandonAfterMinutes ?? 60} className="cm-inp" /></L>
          <L label="Min gap (min)"><input name="minGapMinutes" type="number" defaultValue={cfg.minGapMinutes ?? 60} className="cm-inp" /></L>
          <L label="Reminder 1 (min)"><input name="stage1" type="number" defaultValue={stages[0] ?? 60} className="cm-inp" /></L>
          <L label="Reminder 2 (min)"><input name="stage2" type="number" defaultValue={stages[1] ?? 1440} className="cm-inp" /></L>
          <L label="Final (min)"><input name="stage3" type="number" defaultValue={stages[2] ?? 4320} className="cm-inp" /></L>
        </div>
      )}

      <button disabled={pending} className="btn-outline text-xs">{pending ? '…' : 'Save'}</button>
      {msg && <span className="ml-2 text-xs text-ink-soft">{msg}</span>}
      <style>{`.cm-inp{width:100%;border:1px solid var(--line);padding:.4rem .5rem;font-size:.8rem;outline:none}.cm-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
