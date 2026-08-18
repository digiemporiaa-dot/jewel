'use client';

import { useState } from 'react';
import ProductImage from '@/components/storefront/ProductImage';
import { cn } from '@/lib/utils/cn';

/**
 * Product gallery. Desktop: thumbnail column + large image. Mobile: swipeable
 * horizontal snap carousel (brief §64).
 */
export default function Gallery({
  images,
  name,
}: {
  images: { url: string; alt: string | null }[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  const list = images.length > 0 ? images : [{ url: '', alt: name }];

  return (
    <div className="lg:flex lg:gap-4">
      {/* Desktop thumbnails */}
      <div className="hidden lg:flex lg:flex-col gap-2 w-20 shrink-0">
        {list.map((img, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={cn('aspect-square border overflow-hidden', i === active ? 'border-brass' : 'border-line')}
            aria-label={`View image ${i + 1}`}
          >
            <ProductImage src={img.url || null} alt={img.alt ?? name} monogram={name.charAt(0)} className="w-full h-full" />
          </button>
        ))}
      </div>

      {/* Desktop main image */}
      <div className="hidden lg:block flex-1">
        <div className="aspect-[4/5] border border-line overflow-hidden">
          <ProductImage src={list[active]?.url || null} alt={list[active]?.alt ?? name} monogram={name.charAt(0)} className="w-full h-full" />
        </div>
      </div>

      {/* Mobile swipe carousel */}
      <div className="lg:hidden">
        <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none -mx-4 px-4 gap-3">
          {list.map((img, i) => (
            <div key={i} className="snap-center shrink-0 w-[82%] aspect-[4/5] border border-line overflow-hidden">
              <ProductImage src={img.url || null} alt={img.alt ?? name} monogram={name.charAt(0)} className="w-full h-full" />
            </div>
          ))}
        </div>
        {list.length > 1 && (
          <p className="mt-2 text-center text-xs text-ink-soft">Swipe to see more · {list.length} images</p>
        )}
      </div>
    </div>
  );
}
