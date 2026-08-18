'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

type Facets = { metals: { label: string; value: string }[]; purities: string[]; occasions: string[] };

const SORTS: { value: string; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
  { value: 'best-selling', label: 'Best Selling' },
];

export default function FilterSort({ facets, total }: { facets: Facets; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page'); // reset pagination on any filter change
    router.push(`${pathname}?${next.toString()}`);
  }

  const activeCount = ['metal', 'purity', 'avail', 'occasion', 'priceMin', 'priceMax'].filter((k) => params.get(k)).length;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 border-y border-line py-3">
        <button onClick={() => setOpen((v) => !v)} className="text-sm tracking-[0.08em] uppercase flex items-center gap-2">
          Filters {activeCount > 0 && <span className="bg-velvet text-paper text-xs px-1.5 rounded-[2px]">{activeCount}</span>}
        </button>
        <span className="hidden sm:block text-sm text-ink-soft">{total} pieces</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft hidden sm:inline">Sort</span>
          <select
            value={params.get('sort') ?? 'recommended'}
            onChange={(e) => setParam('sort', e.target.value)}
            className="border border-line px-2 py-1.5 outline-none focus:border-brass bg-paper"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {open && (
        <div className="border-b border-line py-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FacetGroup title="Metal">
            {facets.metals.map((m) => (
              <Chip key={m.value} active={params.get('metal') === m.value} onClick={() => setParam('metal', params.get('metal') === m.value ? null : m.value)}>{m.label}</Chip>
            ))}
          </FacetGroup>
          <FacetGroup title="Purity">
            {facets.purities.map((p) => (
              <Chip key={p} active={params.get('purity') === p} onClick={() => setParam('purity', params.get('purity') === p ? null : p)}>{p}</Chip>
            ))}
          </FacetGroup>
          <FacetGroup title="Availability">
            <Chip active={params.get('avail') === 'ready'} onClick={() => setParam('avail', params.get('avail') === 'ready' ? null : 'ready')}>Ready to Ship</Chip>
            <Chip active={params.get('avail') === 'made'} onClick={() => setParam('avail', params.get('avail') === 'made' ? null : 'made')}>Made to Order</Chip>
          </FacetGroup>
          <FacetGroup title="Price (₹)">
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric" placeholder="Min" defaultValue={params.get('priceMin') ?? ''}
                onBlur={(e) => setParam('priceMin', e.target.value || null)}
                className="w-20 border border-line px-2 py-1.5 text-sm outline-none focus:border-brass"
              />
              <span className="text-ink-soft">–</span>
              <input
                inputMode="numeric" placeholder="Max" defaultValue={params.get('priceMax') ?? ''}
                onBlur={(e) => setParam('priceMax', e.target.value || null)}
                className="w-20 border border-line px-2 py-1.5 text-sm outline-none focus:border-brass"
              />
            </div>
          </FacetGroup>

          {facets.occasions.length > 0 && (
            <FacetGroup title="Occasion">
              {facets.occasions.map((o) => (
                <Chip key={o} active={params.get('occasion') === o} onClick={() => setParam('occasion', params.get('occasion') === o ? null : o)}>{o}</Chip>
              ))}
            </FacetGroup>
          )}

          {activeCount > 0 && (
            <div className="flex items-end">
              <button onClick={() => router.push(pathname)} className="text-sm underline underline-offset-4 hover:text-brass">Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.7rem] tracking-[0.14em] uppercase text-ink-soft mb-2">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn('text-xs px-3 py-1.5 border rounded-[2px] transition-colors', active ? 'border-velvet bg-velvet text-paper' : 'border-line hover:border-brass')}
    >
      {children}
    </button>
  );
}
