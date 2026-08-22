'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteProductAction, restoreProductAction } from '../actions';

/**
 * Removing a product, in two deliberate steps.
 *
 * The SKU has to be typed. "Are you sure?" is answered yes by reflex — it is a
 * speed bump, not a decision. Typing `MJ-RING-0042` requires reading which
 * product is actually on screen, which is the whole point when the previous
 * screen was a list of forty similar rings.
 *
 * The wording says what really happens, too: the product is taken off sale and
 * kept, because its order lines still point at it. Promising a permanent delete
 * and performing something else would be worse than either.
 */
export default function DeleteProductButton({
  id, sku, deletedAt,
}: {
  id: string;
  sku: string;
  deletedAt: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deletedAt) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-ink-soft">
          Deleted {new Date(deletedAt).toLocaleDateString('en-IN')}. Its orders and invoices are unaffected.
        </span>
        <button
          disabled={pending}
          onClick={() => start(async () => {
            const res = await restoreProductAction(id);
            if (!res.ok) setError(res.error ?? 'Failed');
            else router.refresh();
          })}
          className="btn-outline text-xs py-1"
        >
          {pending ? '…' : 'Restore'}
        </button>
        <span className="text-xs text-ink-soft">Restores as a draft, not back on sale.</span>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="btn-outline text-xs text-red-700 border-red-300">
        Delete product
      </button>
    );
  }

  const matches = typed.trim().toUpperCase() === sku.toUpperCase();

  return (
    <div className="border border-red-300 p-3 space-y-2 max-w-md">
      <p className="text-sm">
        This takes <strong>{sku}</strong> off the storefront and out of the admin lists. It is kept, not
        erased — orders that include it still resolve, and you can restore it from the archive.
      </p>
      <label className="block">
        <span className="block mb-1 text-xs text-ink-soft">Type <strong>{sku}</strong> to confirm</span>
        <input
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setError(null); }}
          autoFocus
          className="w-full border border-line px-2 py-1.5 text-sm outline-none focus:border-brass"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          disabled={pending || !matches}
          onClick={() => start(async () => {
            const res = await deleteProductAction(id, typed);
            if (res && !res.ok) setError(res.error ?? 'Failed');
            else router.refresh();
          })}
          className="btn-primary text-xs py-1 bg-red-700 hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? '…' : 'Delete product'}
        </button>
        <button onClick={() => { setConfirming(false); setTyped(''); setError(null); }} className="btn-outline text-xs py-1">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
