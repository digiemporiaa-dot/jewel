/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CheckoutSummary from '@/app/(storefront)/checkout/CheckoutSummary';
import { resolvePayable, type SummaryTotals, type AppliedCoupon } from '@/lib/checkout/totals';

/**
 * The pay button and the Total row must show the same amount.
 *
 * This is rendered rather than unit-tested because the defect lived in the gap
 * between two correct values: the arithmetic was right, and the Total row was
 * right, but the button read a different field. Only looking at what the shopper
 * sees catches that.
 */

// next/image needs a real Next runtime; the summary only uses it for thumbnails.
vi.mock('next/image', () => ({
  default: (props: { alt?: string }) => <span data-testid="thumb" aria-label={props.alt} />,
}));

afterEach(cleanup);

const SUMMARY: SummaryTotals = {
  itemCount: 1,
  metalTotal: '1650.00',
  makingTotal: '364.00',
  stoneTotal: '204.45',
  itemPriceTotal: '0.00',
  productDiscountTotal: '0.00',
  taxableTotal: '2218.45',
  gstTotal: '66.55',
  itemsTotal: '2285.00',
  shipping: '0.00',
  grandTotal: '2285.00',
};

const COUPON: AppliedCoupon = {
  code: 'DIWALI10',
  discount: '237.00',
  freeShipping: false,
  taxableTotal: '1981.45',
  gstTotal: '59.44',
  shipping: '0.00',
  grandTotal: '2040.89',
};

const LINES = [
  {
    itemId: 'i1',
    name: 'Kundan Polki Necklace',
    variantLabel: '22K · 16in',
    image: null,
    quantity: 1,
    lineTotal: '2285.00',
  },
];

function renderSummary(coupon: AppliedCoupon | null, method: 'RAZORPAY' | 'COD' = 'RAZORPAY') {
  return render(
    <CheckoutSummary
      lines={LINES}
      totals={resolvePayable(SUMMARY, coupon)}
      itemsTotal={SUMMARY.itemsTotal}
      method={method}
      pending={false}
      canPlace
      verified
      couponInput=""
      couponPending={false}
      couponFeedback={null}
      onCouponInput={() => {}}
      onApplyCoupon={() => {}}
      onSubmit={() => {}}
    />
  );
}

/** The digits of an amount, so ₹ and spacing differences do not matter. */
function amount(text: string | null): string {
  return (text ?? '').replace(/[^\d.]/g, '');
}

describe('the pay button and the Total row', () => {
  it('agree with no coupon applied', () => {
    renderSummary(null);
    const total = amount(screen.getByTestId('summary-total').textContent);
    const button = amount(screen.getByTestId('pay-button').textContent);
    expect(total).toBe('2285.00');
    expect(button).toBe(total);
  });

  it('agree with a coupon applied', () => {
    // The reported bug: Total ₹2,285, button "Pay ₹2,522".
    renderSummary(COUPON);
    const total = amount(screen.getByTestId('summary-total').textContent);
    const button = amount(screen.getByTestId('pay-button').textContent);
    expect(total).toBe('2040.89');
    expect(button).toBe(total);
  });

  it('agree on the cash-on-delivery path too', () => {
    renderSummary(COUPON, 'COD');
    const total = amount(screen.getByTestId('summary-total').textContent);
    const button = amount(screen.getByTestId('pay-button').textContent);
    expect(button).toBe(total);
    expect(screen.getByTestId('pay-button').textContent).toContain('on delivery');
  });

  it('never shows the undiscounted amount anywhere once a code is applied', () => {
    renderSummary(COUPON);
    // ₹2,285 is still legitimate as the items subtotal, but not on the button.
    expect(amount(screen.getByTestId('pay-button').textContent)).not.toBe('2285.00');
  });
});

describe('the breakdown the shopper reads', () => {
  it('names every item with its quantity and line total', () => {
    renderSummary(null);
    expect(screen.getByText('Kundan Polki Necklace')).toBeTruthy();
    expect(screen.getByText(/22K · 16in/)).toBeTruthy();
    expect(screen.getByText(/Qty 1/)).toBeTruthy();
  });

  it('labels every component between the items and the total', () => {
    renderSummary(COUPON);
    for (const label of [/Metal \+ wastage/, /Making charges/, /Diamonds \/ stones/, /Taxable value/, /^GST$/, /Shipping/]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText(/Discount \(DIWALI10\)/)).toBeTruthy();
  });

  it('hides the stones row when there are none', () => {
    render(
      <CheckoutSummary
        lines={LINES}
        totals={resolvePayable({ ...SUMMARY, stoneTotal: '0.00' }, null)}
        itemsTotal={SUMMARY.itemsTotal}
        method="RAZORPAY" pending={false} canPlace verified
        couponInput="" couponPending={false} couponFeedback={null}
        onCouponInput={() => {}} onApplyCoupon={() => {}} onSubmit={() => {}}
      />
    );
    expect(screen.queryByText(/Diamonds \/ stones/)).toBeNull();
  });

  it('shows free shipping as "Free" rather than ₹0.00', () => {
    renderSummary(null);
    expect(screen.getByText('Free')).toBeTruthy();
  });
});
