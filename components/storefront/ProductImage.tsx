'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Product image with a graceful monogram fallback. Seed data uses placeholder
 * paths that don't resolve; on error (or when there's no image) we show an
 * elegant monogram instead of a broken image. Uses a plain <img> so the fallback
 * can react to load errors on the client — including the SSR case where the 404
 * fires before hydration attaches onError (checked via naturalWidth on mount).
 */
export default function ProductImage({
  src,
  alt,
  monogram,
  className,
  sizes,
}: {
  src: string | null;
  alt: string;
  monogram: string;
  className?: string;
  sizes?: string;
}) {
  // The *src that failed*, not a boolean. Deriving `failed` from it means a new
  // src is automatically un-failed, with no effect to reset anything — a gallery
  // whose first image is missing no longer keeps showing the monogram after the
  // shopper picks a thumbnail that loads.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = !src || failedSrc === src;

  // A ref callback rather than an effect. The check exists for the SSR case
  // where the image 404s before hydration attaches `onError`, so it has to run
  // when the element attaches — and doing it here keeps a synchronous state
  // update out of an effect, where it would cost a second render on every
  // product card on the page.
  const measure = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0) setFailedSrc(img.getAttribute('src'));
    },
    []
  );

  if (failed || !src) {
    return (
      <div className={cn('flex items-center justify-center bg-paper-2', className)} aria-label={alt} role="img">
        <span className="font-heading text-3xl text-ink/25">{monogram}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={measure}
      src={src}
      alt={alt}
      sizes={sizes}
      loading="lazy"
      onError={() => setFailedSrc(src)}
      className={cn('object-cover', className)}
    />
  );
}
