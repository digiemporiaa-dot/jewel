'use client';

import { useState } from 'react';
import Image from 'next/image';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { PayableTotals } from '@/lib/checkout/totals';

/**
 * The order summary, shared by the bag and checkout.
 *
 * One component for both on purpose: a shopper who sees one breakdown in the bag
 * and a different one at checkout stops trusting either. Two implementations
 * would drift the first time one of them was edited.
 *
 * Two blocks, and the distinction matters:
 *
 *  - **Items** identify what is being bought. Their line totals are inclusive of
 *    GST, which is how the price appeared on the product page, so the figures
 *    are the ones the shopper recognises. This block is labelled as inclusive.
 *  - **The breakdown** explains the total, and every row in it adds up in one
 *    direction: metal + making + stones − discount = taxable, then + GST +
 *    shipping = the total. No unlabelled gap anywhere.
 *
 * The two blocks are two views of the same money, never summed together — which
 * is why the items block carries its own subtotal rather than feeding into the
 * column below it.
 */

/**
 * Every figure in this summary shows paise.
 *
 * `formatCurrency` rounds to whole rupees by default, which is right for a
 * product tile and wrong here: rounded independently, the rows stop adding up
 * (₹1,650 + ₹364 + ₹204 − ₹237 + ₹59 lands on ₹2,040 beside a total rounded to
 * ₹2,041). At these order values shoppers check, and a summary that is out by a
 * rupee reads as a mistake.
 */
function money(value: string): string {
  return formatCurrency(value, { withDecimals: true });
}

export type SummaryLine = {
  itemId: string;
  name: string;
  variantLabel: string | null;
  image: string | null;
  quantity: number;
  lineTotal: string;
};

export default function OrderSummary({
  title = 'Order Summary', lines, totals, itemsTotal, note, children, className,
}: {
  title?: string;
  lines: SummaryLine[];
  totals: PayableTotals;
  /** Sum of the item rows, inclusive of GST, before any discount or shipping. */
  itemsTotal: string;
  note?: React.ReactNode;
  /** Coupon field, EMI note, pay button — whatever the host page adds below. */
  children?: React.ReactNode;
  className?: string;
}) {
  // Collapsed on mobile so the payment step stays reachable without scrolling
  // past a long list; always open from `sm` up, where there is room for both.
  const [open, setOpen] = useState(false);
  const hasMetal = Number(totals.metalTotal) > 0;
  const hasMaking = Number(totals.makingTotal) > 0;
  const hasStones = Number(totals.stoneTotal) > 0;
  const hasItemPrice = Number(totals.itemPriceTotal) > 0;
  const hasProductDiscount = Number(totals.productDiscountTotal) > 0;
  const hasDiscount = Number(totals.discount) > 0;
  // The taxable line is only worth its space once something has moved the
  // components away from it; on a plain bag it would just repeat the row above.
  const showTaxable = hasDiscount || hasProductDiscount;

  return (
    <div className={cn('border border-line bg-paper p-6', className)}>
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-xl">{title}</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="order-summary-detail"
          className="sm:hidden text-xs underline underline-offset-4 text-ink-soft hover:text-ink"
        >
          {open ? 'Hide details' : `${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'} · details`}
        </button>
      </div>

      {note}

      <div id="order-summary-detail" className={cn('mt-4', open ? 'block' : 'hidden sm:block')}>
        <ul className="space-y-3">
          {lines.map((line) => (
            <li key={line.itemId} className="flex gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden border border-line bg-paper-2">
                {line.image && (
                  <Image src={line.image} alt="" fill sizes="56px" className="object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{line.name}</p>
                <p className="text-xs text-ink-soft">
                  {line.variantLabel ? `${line.variantLabel} · ` : ''}Qty {line.quantity}
                </p>
              </div>
              <p className="text-sm shrink-0 tabular-nums">{money(line.lineTotal)}</p>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-ink-soft">Items ({totals.itemCount}) incl. GST</span>
          <span className="tabular-nums">{money(itemsTotal)}</span>
        </div>
      </div>

      {/* The breakdown. Every row here is additive, top to bottom. */}
      <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
        {hasMetal && <Row label="Metal + wastage" value={money(totals.metalTotal)} />}
        {hasMaking && <Row label="Making charges" value={money(totals.makingTotal)} />}
        {hasStones && <Row label="Diamonds / stones" value={money(totals.stoneTotal)} />}
        {/* Flat-priced pieces have no metal or making of their own; without this
            row their value would appear in the total with nothing explaining it. */}
        {hasItemPrice && <Row label="Item price" value={money(totals.itemPriceTotal)} />}

        {hasProductDiscount && (
          <div className="flex justify-between text-velvet">
            <dt>Item discount</dt>
            <dd className="tabular-nums">− {money(totals.productDiscountTotal)}</dd>
          </div>
        )}

        {hasDiscount && (
          <div className="flex justify-between text-velvet">
            <dt>Discount{totals.discountCode ? ` (${totals.discountCode})` : ''}</dt>
            <dd className="tabular-nums">− {money(totals.discount)}</dd>
          </div>
        )}

        {/* Shown only when a discount makes it differ from the rows above, so an
            uncomplicated bag is not padded with a row that repeats itself. */}
        {showTaxable && (
          <div className="flex justify-between border-t border-line/60 pt-2 text-ink-soft">
            <dt>Taxable value</dt>
            <dd className="tabular-nums text-ink">{money(totals.taxableTotal)}</dd>
          </div>
        )}

        <Row label="GST" value={money(totals.gstTotal)} />
        <Row label="Shipping" value={totals.freeShipping ? 'Free' : money(totals.shipping)} />

        <div className="flex justify-between border-t border-line pt-3 text-base font-medium">
          <dt>Total</dt>
          <dd data-testid="summary-total" className="tabular-nums">
            {money(totals.grandTotal)}
          </dd>
        </div>
      </dl>

      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-soft">
      <dt>{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
