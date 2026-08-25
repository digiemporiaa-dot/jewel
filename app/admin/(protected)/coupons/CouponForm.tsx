'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export type CouponRefs = {
  categories: { id: string; name: string }[];
  collections: { id: string; name: string }[];
  metals: string[];
  purities: string[];
};

export type CouponDefaults = {
  code: string; description: string; type: string; appliesTo: string; value: string;
  minOrder: string; maxDiscount: string; usageLimit: string; perUserLimit: string;
  minWeightGrams: string; maxWeightGrams: string; startsAt: string; endsAt: string;
  isActive: boolean; excludeDiscounted: boolean; firstOrderOnly: boolean; stackable: boolean;
  categoryIds: string[]; collectionIds: string[]; metalTypes: string[]; purities: string[];
};

const EMPTY: CouponDefaults = {
  code: '', description: '', type: 'PERCENTAGE', appliesTo: 'MAKING_CHARGES', value: '',
  minOrder: '', maxDiscount: '', usageLimit: '', perUserLimit: '',
  minWeightGrams: '', maxWeightGrams: '', startsAt: '', endsAt: '',
  isActive: true, excludeDiscounted: false, firstOrderOnly: false, stackable: false,
  categoryIds: [], collectionIds: [], metalTypes: [], purities: [],
};

/**
 * What each scope means, in the terms the shop owner thinks in.
 *
 * The warning on ORDER_TOTAL is the most important text on this screen: it is
 * the difference between discounting ₹3,600 of margin and ₹40,000 that is
 * mostly gold sold at cost.
 */
const SCOPES: { value: string; label: string; help: string; warn?: boolean }[] = [
  {
    value: 'MAKING_CHARGES',
    label: 'Making charges (recommended)',
    help: 'Discounts only the labour component — where your margin actually is.',
  },
  {
    value: 'STONE_VALUE',
    label: 'Stones and diamonds',
    help: 'Discounts the stones set into the piece, leaving metal and making untouched.',
  },
  {
    value: 'METAL_VALUE',
    label: 'Metal value',
    help: 'Discounts gold or silver sold at the live rate. There is almost no margin here.',
    warn: true,
  },
  {
    value: 'ORDER_TOTAL',
    label: 'Whole order total',
    help: 'Discounts everything including metal. On a ₹4,00,000 necklace, 10% is ₹40,000 — against roughly ₹3,600 if the same coupon applied to making charges only.',
    warn: true,
  },
];

export default function CouponForm({
  action, refs, defaults = EMPTY, submitLabel,
}: {
  action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  refs: CouponRefs;
  defaults?: CouponDefaults;
  submitLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState(defaults.type);
  const [scope, setScope] = useState(defaults.appliesTo);

  const scopeInfo = SCOPES.find((s) => s.value === scope);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await action(fd);
      if (res.ok) router.refresh();
      else setError(res.error ?? 'Failed');
    });
  }

  return (
    <form action={submit} className="space-y-5 max-w-3xl">
      <section className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-lg">The code</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <L label="Code">
            <input name="code" defaultValue={defaults.code} required maxLength={40} placeholder="DIWALI10" className="c-inp uppercase" />
          </L>
          <L label="Internal description">
            <input name="description" defaultValue={defaults.description} maxLength={200} placeholder="Diwali making-charge offer" className="c-inp" />
          </L>
          <L label="Type">
            <select name="type" value={type} onChange={(e) => setType(e.target.value)} className="c-inp">
              <option value="PERCENTAGE">Percentage off</option>
              <option value="FLAT">Flat amount off</option>
              <option value="FREE_SHIPPING">Free shipping</option>
            </select>
          </L>
          {type !== 'FREE_SHIPPING' && (
            <L label={type === 'PERCENTAGE' ? 'Percentage' : 'Amount (₹)'}>
              <input name="value" defaultValue={defaults.value} required inputMode="decimal" placeholder={type === 'PERCENTAGE' ? '10' : '2000'} className="c-inp" />
            </L>
          )}
        </div>
      </section>

      {type !== 'FREE_SHIPPING' && (
        <section className="border border-line bg-white p-4 space-y-3">
          <h2 className="font-heading text-lg">What it discounts</h2>
          <L label="Applies to">
            <select name="appliesTo" value={scope} onChange={(e) => setScope(e.target.value)} className="c-inp">
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </L>
          {scopeInfo && (
            <p className={cn(
              'text-sm px-3 py-2 border',
              scopeInfo.warn ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-line bg-paper-2 text-ink-soft'
            )}>
              {scopeInfo.warn && <strong>Careful. </strong>}
              {scopeInfo.help}
            </p>
          )}
          <p className="text-xs text-ink-soft">
            The discount is calculated per qualifying item, on that component only — never as a
            percentage of the bag total.
          </p>
        </section>
      )}

      <section className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-lg">Who and what qualifies</h2>
        <p className="text-xs text-ink-soft">
          Leave a list empty for no restriction. An item must match every list you do set.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Multi label="Categories" name="categoryIds" options={refs.categories.map((c) => ({ value: c.id, label: c.name }))} selected={defaults.categoryIds} />
          <Multi label="Collections" name="collectionIds" options={refs.collections.map((c) => ({ value: c.id, label: c.name }))} selected={defaults.collectionIds} />
          <Multi label="Metals" name="metalTypes" options={refs.metals.map((m) => ({ value: m, label: m }))} selected={defaults.metalTypes} />
          <Multi label="Purities" name="purities" options={refs.purities.map((p) => ({ value: p, label: p }))} selected={defaults.purities} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <L label="Minimum weight (g)">
            <input name="minWeightGrams" defaultValue={defaults.minWeightGrams} inputMode="decimal" className="c-inp" />
          </L>
          <L label="Maximum weight (g)">
            <input name="maxWeightGrams" defaultValue={defaults.maxWeightGrams} inputMode="decimal" className="c-inp" />
          </L>
        </div>
        <p className="text-xs text-ink-soft">
          Weight is compared per piece, not per line — &ldquo;above 10g&rdquo; means a 10g piece, not two 5g ones.
        </p>
        <Check name="excludeDiscounted" defaultChecked={defaults.excludeDiscounted} label="Exclude items that are already discounted" />
      </section>

      <section className="border border-line bg-white p-4 space-y-3">
        <h2 className="font-heading text-lg">Limits</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <L label="Minimum order (₹)"><input name="minOrder" defaultValue={defaults.minOrder} inputMode="decimal" className="c-inp" /></L>
          <L label="Maximum discount (₹)"><input name="maxDiscount" defaultValue={defaults.maxDiscount} inputMode="decimal" className="c-inp" /></L>
          <L label="Total uses"><input name="usageLimit" defaultValue={defaults.usageLimit} inputMode="numeric" placeholder="Unlimited" className="c-inp" /></L>
          <L label="Uses per customer"><input name="perUserLimit" defaultValue={defaults.perUserLimit} inputMode="numeric" placeholder="Unlimited" className="c-inp" /></L>
          <L label="Starts (IST)"><input type="datetime-local" name="startsAt" defaultValue={defaults.startsAt} className="c-inp" /></L>
          <L label="Ends (IST)"><input type="datetime-local" name="endsAt" defaultValue={defaults.endsAt} className="c-inp" /></L>
        </div>
        <Check name="firstOrderOnly" defaultChecked={defaults.firstOrderOnly} label="First order only" />
        <Check
          name="stackable"
          defaultChecked={defaults.stackable}
          label="Can be combined with another code"
          help="Off by default. Two stacked codes on a high-value piece can discount more than the margin on it."
        />
        <Check name="isActive" defaultChecked={defaults.isActive} label="Active" />
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary text-xs">{submitLabel}</button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>

      <style>{`.c-inp{width:100%;border:1px solid var(--line);padding:.5rem .65rem;font-size:.875rem;outline:none;background:#fff}.c-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Check({ name, defaultChecked, label, help }: { name: string; defaultChecked: boolean; label: string; help?: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} />
        <span>{label}</span>
      </label>
      {help && <p className="mt-0.5 ml-6 text-xs text-ink-soft">{help}</p>}
    </div>
  );
}

/** Small multi-select. A native list beats a dependency for four short lists. */
function Multi({
  label, name, options, selected,
}: {
  label: string; name: string; options: { value: string; label: string }[]; selected: string[];
}) {
  return (
    <label className="block">
      <span className="block mb-1 text-xs text-ink-soft">{label}</span>
      <select name={name} multiple defaultValue={selected} size={Math.min(options.length || 1, 5)} className="c-inp">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
