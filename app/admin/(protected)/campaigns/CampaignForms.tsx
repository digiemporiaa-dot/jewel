'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveCampaignAction } from './actions';
import { hasSchedule, type CampaignDefinition } from '@/lib/campaigns/registry';

type Campaign = { id: string; type: string; name: string; isActive: boolean; config: Record<string, unknown> | null };

/**
 * One automation, with everything an operator needs in one place.
 *
 * The old card was a heading, a checkbox and a Save button — nothing to read,
 * nothing to open, and no way to reach the wording it sends. Staff scrolled past
 * four of them and concluded the feature was broken, which was a fair reading.
 * Now each card says when it fires, what drives it, and links straight to its
 * template.
 */
export function CampaignCard({
  definition, campaign, smtpReady,
}: {
  definition: CampaignDefinition;
  campaign?: Campaign;
  smtpReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [active, setActive] = useState(campaign?.isActive ?? true);
  const cfg = (campaign?.config ?? {}) as { abandonAfterMinutes?: number; stageDelaysMinutes?: number[]; minGapMinutes?: number };
  const stages = cfg.stageDelaysMinutes ?? [60, 1440, 4320];
  const scheduled = hasSchedule(definition.type);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set('type', definition.type);
    start(async () => {
      const res = await saveCampaignAction(fd);
      setMsg(res.ok ? 'Saved' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-4 space-y-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base">{definition.name}</h3>
          <p className="mt-0.5 text-xs text-ink-soft">{definition.description}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs">
          <input
            type="checkbox" name="isActive" checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {active ? 'On' : 'Off'}
        </label>
      </div>
      <input type="hidden" name="name" value={definition.name} />

      <p className="text-xs text-ink-soft">
        <span className="text-ink">{definition.trigger.when}.</span>{' '}
        {definition.trigger.kind === 'scheduled' ? (
          <>Runs from <code>{definition.trigger.endpoint}</code>, so nothing goes out until the scheduler is set up.</>
        ) : (
          <>Sent straight away — no scheduler needed.</>
        )}
      </p>

      {/* Two ways this can be switched on and still send nothing. Both are
          invisible from here unless the card says so. */}
      {active && !smtpReady && (
        <p className="border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          On, but no mail server is configured — nothing will be delivered.
        </p>
      )}
      {!active && definition.transactional && (
        <p className="border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Customers will not be told their order has shipped or arrived. Only turn
          this off if you tell them another way.
        </p>
      )}

      {scheduled && (
        <div className="grid grid-cols-2 gap-2">
          <L label="Abandon after (min)"><input name="abandonAfterMinutes" type="number" defaultValue={cfg.abandonAfterMinutes ?? 60} className="cm-inp" /></L>
          <L label="Min gap (min)"><input name="minGapMinutes" type="number" defaultValue={cfg.minGapMinutes ?? 60} className="cm-inp" /></L>
          <L label="Reminder 1 (min)"><input name="stage1" type="number" defaultValue={stages[0] ?? 60} className="cm-inp" /></L>
          <L label="Reminder 2 (min)"><input name="stage2" type="number" defaultValue={stages[1] ?? 1440} className="cm-inp" /></L>
          <L label="Final (min)"><input name="stage3" type="number" defaultValue={stages[2] ?? 4320} className="cm-inp" /></L>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="btn-outline text-xs">{pending ? '…' : 'Save'}</button>
        {/* The card's reason to exist beyond the switch: the wording is one tap
            away instead of on a different screen the operator has to match up
            against this list by hand. */}
        <Link
          href={`/admin/marketing/templates/${definition.templateKey}`}
          className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass"
        >
          Edit wording →
        </Link>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
      <style>{`.cm-inp{width:100%;border:1px solid var(--line);padding:.4rem .5rem;font-size:.8rem;outline:none}.cm-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block mb-1 text-xs text-ink-soft">{label}</span>{children}</label>;
}
