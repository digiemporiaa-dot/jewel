'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProductImage from '@/components/storefront/ProductImage';
import { formatCurrency } from '@/lib/utils/format';
import { updateCartItemAction, removeCartItemAction } from './actions';
import type { CartLine } from '@/lib/cart';

export default function CartItemRow({ line }: { line: CartLine }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(qty: number) {
    setError(null);
    start(async () => {
      const res = await updateCartItemAction(line.itemId, qty);
      if (!res.ok) setError(res.error ?? 'Could not update');
      router.refresh();
    });
  }
  function remove() {
    start(async () => {
      await removeCartItemAction(line.itemId);
      router.refresh();
    });
  }

  const maxReached = !line.madeToOrder && line.quantity >= line.available;

  return (
    <div className="flex gap-4 py-5 border-b border-line">
      <Link href={`/p/${line.slug}`} className="shrink-0">
        <div className="w-20 h-24 sm:w-24 sm:h-28 border border-line overflow-hidden">
          <ProductImage src={line.image} alt={line.name} monogram={line.name.charAt(0)} className="w-full h-full" />
        </div>
      </Link>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/p/${line.slug}`} className="text-sm hover:text-brass line-clamp-1">{line.name}</Link>
            {line.variantLabel && <p className="text-xs text-ink-soft">{line.variantLabel}</p>}
            <p className="text-xs text-ink-soft mt-0.5">{line.madeToOrder ? 'Made to order' : `${line.available} in stock`}</p>
          </div>
          <button onClick={remove} disabled={pending} className="text-xs text-ink-soft hover:text-red-700 shrink-0">Remove</button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="inline-flex items-center border border-line">
            <button aria-label="Decrease" onClick={() => change(line.quantity - 1)} disabled={pending} className="px-3 py-1.5 hover:bg-paper-2">−</button>
            <span className="px-3 py-1.5 text-sm min-w-[2.5rem] text-center">{line.quantity}</span>
            <button aria-label="Increase" onClick={() => change(line.quantity + 1)} disabled={pending || maxReached} className="px-3 py-1.5 hover:bg-paper-2 disabled:opacity-40">+</button>
          </div>
          <div className="text-right">
            {line.error ? (
              <span className="text-sm text-red-700">{line.error}</span>
            ) : (
              <>
                <p className="text-sm font-medium">{formatCurrency(line.lineTotal)}</p>
                {line.quantity > 1 && <p className="text-xs text-ink-soft">{formatCurrency(line.unitPrice)} each</p>}
              </>
            )}
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
