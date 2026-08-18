'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProductImage from '@/components/storefront/ProductImage';
import PriceLabel from '@/components/storefront/PriceLabel';
import { CloseIcon } from '@/components/icons';
import type { ProductCardData } from '@/lib/storefront';
import { moveToBagAction, toggleWishlistAction } from './actions';

export default function WishlistCard({ product }: { product: ProductCardData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function move() {
    setMsg(null);
    start(async () => {
      const res = await moveToBagAction(product.id);
      if (res.ok) router.refresh();
      else setMsg(res.error ?? 'Failed');
    });
  }
  function remove() {
    start(async () => {
      await toggleWishlistAction(product.id);
      router.refresh();
    });
  }

  return (
    <div className="group relative">
      <button onClick={remove} disabled={pending} aria-label="Remove" className="absolute right-2 top-2 z-10 grid place-items-center h-8 w-8 bg-paper/90 border border-line hover:border-brass">
        <CloseIcon width={16} height={16} />
      </button>
      <Link href={`/p/${product.slug}`}>
        <div className="aspect-[4/5] border border-line overflow-hidden">
          <ProductImage src={product.image} alt={product.name} monogram={product.name.charAt(0)} className="w-full h-full" />
        </div>
      </Link>
      <div className="pt-3">
        <p className="text-[0.7rem] tracking-[0.1em] uppercase text-ink-soft">{product.categoryName}</p>
        <Link href={`/p/${product.slug}`} className="mt-1 block text-sm line-clamp-1 hover:text-brass">{product.name}</Link>
        <PriceLabel priceFrom={product.priceFrom} priceTo={product.priceTo} size="sm" className="mt-1" />
        <button onClick={move} disabled={pending} className="btn-outline w-full text-xs mt-3">{pending ? '…' : 'Move to Bag'}</button>
        {msg && <p className="text-xs text-red-700 mt-1">{msg}</p>}
      </div>
    </div>
  );
}
