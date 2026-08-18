'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { saveVariantAction, deleteVariantAction, adjustStockAction, type FormResult } from './actions';

type Variant = {
  id: string; sku: string; label: string | null; size: string | null; metalColor: string | null;
  netWeight: string | null; grossWeight: string | null; wastagePct: string | null; fixedPrice: string | null;
  isActive: boolean; stockQty: number; reservedQty: number; lowStockThreshold: number;
};

export default function VariantManager({ productId, variants }: { productId: string; variants: Variant[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="border border-line bg-white">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between">
        <h2 className="font-heading text-lg">Variants & inventory</h2>
        <button onClick={() => setAdding((v) => !v)} className="btn-outline text-xs py-1.5 px-3">{adding ? 'Close' : 'Add variant'}</button>
      </div>

      {adding && <VariantForm productId={productId} onDone={() => setAdding(false)} />}

      <div className="divide-y divide-line/60">
        {variants.map((v) => <VariantRow key={v.id} productId={productId} variant={v} />)}
        {variants.length === 0 && <p className="p-5 text-sm text-ink-soft">No variants yet.</p>}
      </div>
    </div>
  );
}

function VariantRow({ productId, variant }: { productId: string; variant: Variant }) {
  const [editing, setEditing] = useState(false);
  const available = variant.stockQty - variant.reservedQty;
  const low = available <= variant.lowStockThreshold;

  return (
    <div className="px-5 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-medium">{variant.label ?? variant.sku}</span>{' '}
          <span className="text-xs text-ink-soft">{variant.sku}{variant.size ? ` · ${variant.size}` : ''}</span>
          {!variant.isActive && <span className="ml-2 text-xs text-ink-soft">(inactive)</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-xs', low ? 'text-red-700' : 'text-ink-soft')}>
            avail {available} · stock {variant.stockQty} · reserved {variant.reservedQty}
          </span>
          <button onClick={() => setEditing((v) => !v)} className="btn-outline text-xs py-1 px-2">{editing ? 'Close' : 'Edit'}</button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <VariantForm productId={productId} variant={variant} onDone={() => setEditing(false)} />
          <StockForm productId={productId} variant={variant} />
        </div>
      )}
    </div>
  );
}

function VariantForm({ productId, variant, onDone }: { productId: string; variant?: Variant; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res: FormResult = await saveVariantAction(fd);
      if (res.ok) { onDone(); router.refresh(); } else setError(res.error ?? 'Failed');
    });
  }
  function remove() {
    if (!variant) return;
    start(async () => {
      const res = await deleteVariantAction(variant.id, productId);
      if (res.ok) { onDone(); router.refresh(); } else setError(res.error ?? 'Failed');
    });
  }

  return (
    <form onSubmit={submit} className="border border-line p-3 space-y-2">
      <p className="text-xs text-ink-soft">{variant ? 'Edit variant' : 'New variant'}</p>
      <input type="hidden" name="productId" value={productId} />
      {variant && <input type="hidden" name="variantId" value={variant.id} />}
      <div className="grid grid-cols-2 gap-2">
        <L label="SKU"><input name="sku" defaultValue={variant?.sku} required className="v-inp" /></L>
        <L label="Label"><input name="label" defaultValue={variant?.label ?? ''} className="v-inp" /></L>
        <L label="Size"><input name="size" defaultValue={variant?.size ?? ''} className="v-inp" /></L>
        <L label="Metal colour"><input name="metalColor" defaultValue={variant?.metalColor ?? ''} className="v-inp" /></L>
        <L label="Net weight (g)"><input name="netWeight" defaultValue={variant?.netWeight ?? ''} className="v-inp" /></L>
        <L label="Wastage %"><input name="wastagePct" defaultValue={variant?.wastagePct ?? ''} className="v-inp" /></L>
        <L label="Fixed price ₹"><input name="fixedPrice" defaultValue={variant?.fixedPrice ?? ''} className="v-inp" /></L>
        <L label="Initial stock"><input name="stockQty" type="number" min={0} defaultValue={variant?.stockQty ?? 0} className="v-inp" /></L>
        <L label="Low-stock threshold"><input name="lowStockThreshold" type="number" min={0} defaultValue={variant?.lowStockThreshold ?? 2} className="v-inp" /></L>
        <L label="Active"><input type="checkbox" name="isActive" defaultChecked={variant?.isActive ?? true} /></L>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary text-xs py-1.5">{pending ? '…' : 'Save variant'}</button>
        {variant && <button type="button" onClick={remove} disabled={pending} className="btn-outline text-xs py-1.5">Delete</button>}
      </div>
      <style>{`.v-inp{width:100%;border:1px solid var(--line);padding:.35rem .5rem;font-size:.8rem;outline:none}.v-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function StockForm({ productId, variant }: { productId: string; variant: Variant }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await adjustStockAction(fd);
      setMsg(res.ok ? 'Stock updated' : res.error ?? 'Failed');
      if (res.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="border border-line p-3 space-y-2">
      <p className="text-xs text-ink-soft">Adjust stock (absolute)</p>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variant.id} />
      <div className="grid grid-cols-2 gap-2">
        <L label="Set stock qty"><input name="stockQty" type="number" min={0} defaultValue={variant.stockQty} className="v-inp" /></L>
        <L label="Low-stock threshold"><input name="lowStockThreshold" type="number" min={0} defaultValue={variant.lowStockThreshold} className="v-inp" /></L>
      </div>
      <button disabled={pending} className="btn-outline text-xs py-1.5">{pending ? '…' : 'Update stock'}</button>
      {msg && <span className="ml-2 text-xs text-ink-soft">{msg}</span>}
      <style>{`.v-inp{width:100%;border:1px solid var(--line);padding:.35rem .5rem;font-size:.8rem;outline:none}.v-inp:focus{border-color:var(--brass)}`}</style>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="block mb-0.5 text-ink-soft">{label}</span>{children}</label>;
}
