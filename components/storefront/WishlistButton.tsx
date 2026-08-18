'use client';

import { useState, useTransition } from 'react';
import { HeartIcon } from '@/components/icons';
import { cn } from '@/lib/utils/cn';
import { toggleWishlistAction } from '@/app/(storefront)/wishlist/actions';

export default function WishlistButton({
  productId,
  initialSaved = false,
  variant = 'icon',
  className,
}: {
  productId: string;
  initialSaved?: boolean;
  variant?: 'icon' | 'full';
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, start] = useTransition();

  function toggle() {
    // Optimistic.
    setSaved((v) => !v);
    start(async () => {
      const res = await toggleWishlistAction(productId);
      if (res.ok && typeof res.saved === 'boolean') setSaved(res.saved);
      else setSaved((v) => !v); // revert on failure
    });
  }

  if (variant === 'full') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={cn('btn-outline', className)}
      >
        <HeartIcon className={cn(saved && 'fill-brass text-brass')} />
        {saved ? 'Saved' : 'Add to Wishlist'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
      aria-pressed={saved}
      className={cn(
        'grid place-items-center h-9 w-9 bg-paper/90 border border-line hover:border-brass transition-colors',
        className
      )}
    >
      <HeartIcon width={18} height={18} className={cn(saved ? 'fill-brass text-brass' : 'text-ink')} />
    </button>
  );
}
