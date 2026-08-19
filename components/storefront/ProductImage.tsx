'use client';

import { useState, useRef, useEffect } from 'react';
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
  const [failed, setFailed] = useState(!src);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Reset on every src change. Without this a single failed image latches the
    // fallback on for good, so a gallery whose first image is missing keeps
    // showing the monogram even after the shopper picks a thumbnail that loads.
    setFailed(!src);
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

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
      ref={imgRef}
      src={src}
      alt={alt}
      sizes={sizes}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
    />
  );
}
