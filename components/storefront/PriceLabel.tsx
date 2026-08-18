import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/**
 * Canonical storefront price display. For dynamic products with a variant range,
 * shows "From ₹X". Never renders ₹0 / ₹NaN — falls back to "Price on request"
 * (brief §65). Prices always originate from the pricing engine's cached range.
 */
export default function PriceLabel({
  priceFrom,
  priceTo,
  size = 'md',
  className,
}: {
  priceFrom: string | null;
  priceTo: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const cls = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base';

  if (!priceFrom) {
    return <span className={cn('text-ink-soft', size === 'sm' ? 'text-sm' : 'text-base', className)}>Price on request</span>;
  }

  const isRange = priceTo && priceTo !== priceFrom;
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      {isRange && <span className="text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">From</span>}
      <span className={cn('font-medium text-ink', cls)}>{formatCurrency(priceFrom)}</span>
    </span>
  );
}
