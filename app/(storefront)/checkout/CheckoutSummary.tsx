'use client';

import { formatCurrency } from '@/lib/utils/format';
import OrderSummary, { type SummaryLine } from '@/components/storefront/OrderSummary';
import type { PayableTotals } from '@/lib/checkout/totals';

/**
 * The checkout summary and its pay button.
 *
 * Split out of `CheckoutClient` deliberately: this file imports no server
 * actions, so a test can render it and read what the shopper actually sees.
 * That matters here more than usual — the defect this replaces was a Total row
 * and a button label disagreeing about the amount, which no unit test of the
 * arithmetic alone would have caught.
 *
 * The button label is derived from `totals.grandTotal`, the same field the Total
 * row renders. There is no other amount in scope to get it wrong with.
 */

/** What a coupon reduced, in the shopper's words rather than the schema's. */
const SCOPE_LABELS: Record<string, string> = {
  MAKING_CHARGES: 'making charges',
  METAL_VALUE: 'metal value',
  STONE_VALUE: 'stones',
  ORDER_TOTAL: 'your order',
};

export type CouponFeedback =
  | { ok: true; freeShipping: boolean; discount: string; appliesTo: string }
  | { ok: false; error: string }
  | null;

export default function CheckoutSummary({
  lines, totals, itemsTotal, method, pending, canPlace, verified,
  couponInput, couponPending, couponFeedback,
  onCouponInput, onApplyCoupon, onSubmit,
}: {
  lines: SummaryLine[];
  totals: PayableTotals;
  itemsTotal: string;
  method: 'RAZORPAY' | 'COD' | 'BANK_TRANSFER';
  pending: boolean;
  canPlace: boolean;
  verified: boolean;
  couponInput: string;
  couponPending: boolean;
  couponFeedback: CouponFeedback;
  onCouponInput: (value: string) => void;
  onApplyCoupon: () => void;
  onSubmit: () => void;
}) {
  // One derivation, one figure. Paise included so it matches the Total row
  // exactly — see OrderSummary's money(). Cash on delivery still shows the
  // amount: the shopper is agreeing to hand it over at the door, so hiding it
  // there would be the same omission in a different place.
  const payable = formatCurrency(totals.grandTotal, { withDecimals: true });
  const label = pending
    ? 'Processing…'
    : method === 'COD'
      ? `Place Order · ${payable} on delivery`
      : `Pay ${payable}`;

  return (
    <aside className="lg:sticky lg:top-6 self-start h-fit">
      <OrderSummary lines={lines} totals={totals} itemsTotal={itemsTotal}>
        <div className="mt-4 border-t border-line pt-4">
          <label htmlFor="coupon" className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-ink-soft">
            Discount code
          </label>
          <div className="flex gap-2">
            <input
              id="coupon"
              value={couponInput}
              onChange={(e) => onCouponInput(e.target.value.toUpperCase())}
              placeholder="Enter code"
              maxLength={40}
              className="flex-1 border border-line px-3 py-2 text-sm uppercase outline-none focus:border-brass"
            />
            <button
              type="button"
              onClick={onApplyCoupon}
              disabled={couponPending || couponInput.trim() === ''}
              className="btn-outline px-4 text-xs"
            >
              {couponPending ? '…' : 'Apply'}
            </button>
          </div>
          {couponFeedback && !couponFeedback.ok && (
            <p className="mt-2 text-sm text-red-700">{couponFeedback.error}</p>
          )}
          {couponFeedback?.ok && (
            <p className="mt-2 text-sm text-velvet">
              {couponFeedback.freeShipping
                ? 'Free shipping applied.'
                : `${formatCurrency(couponFeedback.discount)} off ${SCOPE_LABELS[couponFeedback.appliesTo] ?? 'your order'}.`}
            </p>
          )}
        </div>

        <button
          onClick={onSubmit}
          disabled={!canPlace || pending}
          data-testid="pay-button"
          className="btn-primary mt-5 w-full"
        >
          {label}
        </button>
        {!verified && <p className="mt-2 text-center text-xs text-ink-soft">Verify your phone to continue.</p>}
        <p className="mt-3 text-center text-xs text-ink-soft">
          Prices locked at today&rsquo;s rate · Secure checkout
        </p>
      </OrderSummary>
    </aside>
  );
}
