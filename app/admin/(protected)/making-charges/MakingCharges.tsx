'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { createMakingRuleAction, updateMakingRuleAction, previewMakingAction } from './actions';
import type { MakingChargeType } from '@prisma/client';

type Opt = { id: string; name: string };
type Rule = {
  id: string; name: string; scope: string; type: string; value: string;
  minCharge: string | null; priority: number; isActive: boolean;
  metalName: string | null; categoryName: string | null; purityName: string | null;
};

const SCOPES = ['GLOBAL', 'METAL', 'CATEGORY_METAL', 'CATEGORY_METAL_PURITY', 'VARIANT'] as const;
const TYPES: MakingChargeType[] = ['PERCENTAGE', 'PER_GRAM', 'FLAT'];

export default function MakingCharges({
  rules, metals, categories, purities,
}: {
  rules: Rule[]; metals: Opt[]; categories: Opt[]; purities: Opt[];
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <CreateForm metals={metals} categories={categories} purities={purities} />
      <RuleList rules={rules} />
    </div>
  );
}

function CreateForm({ metals, categories, purities }: { metals: Opt[]; categories: Opt[]; purities: Opt[] }) {
  const router = useRouter();
  const [scope, setScope] = useState<string>('GLOBAL');
  const [type, setType] = useState<MakingChargeType>('PERCENTAGE');
  const [value, setValue] = useState('12');
  const [minCharge, setMinCharge] = useState('');
  const [sampleRate, setSampleRate] = useState('7000');
  const [sampleWeight, setSampleWeight] = useState('5');
  const [preview, setPreview] = useState<{ making: string; total: string; metalValue: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const needMetal = ['METAL', 'CATEGORY_METAL', 'CATEGORY_METAL_PURITY'].includes(scope);
  const needCategory = ['CATEGORY_METAL', 'CATEGORY_METAL_PURITY'].includes(scope);
  const needPurity = scope === 'CATEGORY_METAL_PURITY';

  // Live sample preview whenever inputs change.
  useEffect(() => {
    if (!value || !sampleRate || !sampleWeight) return;
    let cancelled = false;
    const t = setTimeout(() => {
      previewMakingAction({ type, value, minCharge: minCharge || null, sampleRatePerGram: sampleRate, sampleWeight })
        .then((res) => {
          if (!cancelled) setPreview(res.ok ? res.sample : null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [type, value, minCharge, sampleRate, sampleWeight]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await createMakingRuleAction(fd);
      if (res.ok) {
        setMsg('Rule created and catalogue recomputed.');
        router.refresh();
      } else setMsg(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="border border-line bg-white p-5 space-y-3">
      <h2 className="font-heading text-lg">New making-charge rule</h2>

      <Field label="Name">
        <input name="name" required className="inp" placeholder="e.g. Gold rings per-gram" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Scope">
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="inp">
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select name="type" value={type} onChange={(e) => setType(e.target.value as MakingChargeType)} className="inp">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label={type === 'PERCENTAGE' ? 'Value (%)' : 'Value (₹)'}>
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required className="inp" />
        </Field>
        <Field label="Min charge (₹)">
          <input name="minCharge" value={minCharge} onChange={(e) => setMinCharge(e.target.value)} inputMode="decimal" className="inp" placeholder="optional" />
        </Field>
        <Field label="Priority">
          <input name="priority" defaultValue="0" inputMode="numeric" className="inp" />
        </Field>
      </div>

      {(needMetal || needCategory || needPurity) && (
        <div className="grid grid-cols-3 gap-3">
          {needMetal && (
            <Field label="Metal">
              <select name="metalId" className="inp"><option value="">—</option>{metals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </Field>
          )}
          {needCategory && (
            <Field label="Category">
              <select name="categoryId" className="inp"><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
          )}
          {needPurity && (
            <Field label="Purity">
              <select name="purityId" className="inp"><option value="">—</option>{purities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </Field>
          )}
        </div>
      )}

      {/* Live sample preview */}
      <div className="border border-line-strong bg-paper-2 p-3">
        <p className="eyebrow">Live sample</p>
        <div className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label>Rate/g <input value={sampleRate} onChange={(e) => setSampleRate(e.target.value)} className="inp w-24 inline-block" /></label>
          <label>Weight g <input value={sampleWeight} onChange={(e) => setSampleWeight(e.target.value)} className="inp w-20 inline-block" /></label>
        </div>
        {preview && (
          <p className="mt-2 text-sm">
            Metal {formatCurrency(preview.metalValue)} · <strong>Making {formatCurrency(preview.making)}</strong> · Total {formatCurrency(preview.total)}
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? 'Saving…' : 'Create rule'}
      </button>
      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      <style>{`.inp{width:100%;border:1px solid var(--line);background:#fff;padding:.5rem .625rem;font-size:.875rem;outline:none}.inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function RuleList({ rules }: { rules: Rule[] }) {
  return (
    <div className="border border-line bg-white">
      <div className="px-5 py-3 border-b border-line"><h2 className="font-heading text-lg">Rules</h2></div>
      <div className="divide-y divide-line/60">
        {rules.map((r) => <RuleRow key={r.id} rule={r} />)}
        {rules.length === 0 && <p className="p-5 text-sm text-ink-soft">No rules yet.</p>}
      </div>
    </div>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const router = useRouter();
  const [value, setValue] = useState(rule.value);
  const [minCharge, setMinCharge] = useState(rule.minCharge ?? '');
  const [priority, setPriority] = useState(String(rule.priority));
  const [isActive, setIsActive] = useState(rule.isActive);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const scopeDetail = [rule.categoryName, rule.metalName, rule.purityName].filter(Boolean).join(' · ');

  function save() {
    start(async () => {
      const fd = new FormData();
      fd.set('id', rule.id); fd.set('value', value); fd.set('minCharge', minCharge);
      fd.set('priority', priority); fd.set('isActive', String(isActive));
      const res = await updateMakingRuleAction(fd);
      setMsg(res.ok ? 'Saved' : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="px-5 py-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{rule.name}</p>
          <p className="text-xs text-ink-soft">{rule.scope}{scopeDetail ? ` — ${scopeDetail}` : ''} · {rule.type}</p>
        </div>
        <button
          onClick={() => setIsActive((v) => !v)}
          className={cn('text-xs px-2 py-1 border rounded-[2px]', isActive ? 'border-velvet text-velvet' : 'border-line text-ink-soft')}
        >
          {isActive ? 'Active' : 'Inactive'}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs">Value<input value={value} onChange={(e) => setValue(e.target.value)} className="block border border-line px-2 py-1 w-24 outline-none focus:border-brass" /></label>
        <label className="text-xs">Min ₹<input value={minCharge} onChange={(e) => setMinCharge(e.target.value)} className="block border border-line px-2 py-1 w-24 outline-none focus:border-brass" /></label>
        <label className="text-xs">Priority<input value={priority} onChange={(e) => setPriority(e.target.value)} className="block border border-line px-2 py-1 w-16 outline-none focus:border-brass" /></label>
        <button onClick={save} disabled={pending} className="btn-outline text-xs py-1 px-3">{pending ? '…' : 'Save'}</button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
