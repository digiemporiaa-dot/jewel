/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

/**
 * The checkout email field, for the three kinds of customer who reach it.
 *
 * The defect was one missing prop: the page fetched the customer and passed
 * their name, but never their email — so the field initialised to '' with
 * nothing able to fill it, and the OTP step had already disabled it. A signed-in
 * customer therefore saw a blank locked box, and the empty string went on to
 * Razorpay's prefill and came back as "Enter a valid email" on the payment
 * screen.
 *
 * Rendered rather than unit-tested, because the whole defect lived in what the
 * customer could see: every individual value was correct.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: (p: { alt?: string }) => <span aria-label={p.alt} /> }));
vi.mock('@/app/(storefront)/checkout/actions', () => ({
  sendCheckoutOtp: vi.fn(), verifyCheckoutOtp: vi.fn(), placeOrder: vi.fn(),
  confirmCheckoutPayment: vi.fn(), previewCouponAction: vi.fn(),
}));
vi.mock('@/lib/analytics/events', () => new Proxy({}, { get: () => vi.fn() }));

import CheckoutClient from '@/app/(storefront)/checkout/CheckoutClient';

afterEach(cleanup);

const BASE = {
  summary: {
    itemCount: 1, metalTotal: '0', makingTotal: '0', stoneTotal: '0', itemPriceTotal: '50000',
    productDiscountTotal: '0', taxableTotal: '50000', gstTotal: '1500', itemsTotal: '51500',
    shipping: '0', grandTotal: '51500',
  },
  lines: [{ itemId: 'i1', name: 'Ring', variantLabel: null, image: null, quantity: 1, lineTotal: '51500' }],
  analyticsItems: [],
  savedAddresses: [],
  customerName: 'Ananya Sharma',
  panRequired: false,
  codAllowed: true,
  brandName: 'Maya Jewellers',
};

function emailInput(): HTMLInputElement {
  return screen.getByLabelText(/Email address/i) as HTMLInputElement;
}

describe('a signed-in customer whose email is verified', () => {
  const props = { ...BASE, customerEmail: 'ananya@example.com', verifiedEmail: 'ananya@example.com' };

  it('sees it already filled in', () => {
    render(<CheckoutClient {...props} />);
    expect(emailInput().value).toBe('ananya@example.com');
  });

  it('cannot change it here', () => {
    render(<CheckoutClient {...props} />);
    expect(emailInput().readOnly).toBe(true);
  });

  it('is not disabled — the value is settled, not unavailable', () => {
    // A disabled input drops out of the tab order, cannot be selected or
    // copied, and reads to a screen reader as unavailable. It also renders
    // greyed out, which looks like a broken form rather than a fixed field.
    render(<CheckoutClient {...props} />);
    expect(emailInput().disabled).toBe(false);
  });

  it('is offered a way to change it that does not derail the order', () => {
    render(<CheckoutClient {...props} />);
    const link = screen.getByRole('link', { name: /not you/i });
    expect(link.getAttribute('href')).toBe('/my-account');
  });

  it('is not asked to verify again', () => {
    render(<CheckoutClient {...props} />);
    expect(screen.queryByRole('button', { name: /Send OTP/i })).toBeNull();
  });
});

describe('a legacy phone-only customer with no email on record', () => {
  const props = { ...BASE, customerEmail: null, verifiedEmail: null };

  it('sees an empty field they can type into', () => {
    render(<CheckoutClient {...props} />);
    expect(emailInput().value).toBe('');
    expect(emailInput().readOnly).toBe(false);
    expect(emailInput().disabled).toBe(false);
  });

  it('is asked for it — the order is not blocked, the address is collected', () => {
    render(<CheckoutClient {...props} />);
    expect(emailInput().required).toBe(true);
    expect(screen.getByRole('button', { name: /Send OTP/i })).toBeTruthy();
  });
});

describe('a customer whose email is on record but never proven', () => {
  // A row that got an address at checkout before email became the identifier.
  const props = { ...BASE, customerEmail: 'legacy@example.com', verifiedEmail: null };

  it('gets it as a starting point, not as a fact', () => {
    render(<CheckoutClient {...props} />);
    expect(emailInput().value).toBe('legacy@example.com');
    // Editable: locking an unverified address would let a typo made years ago
    // become permanent at the one moment somebody could correct it.
    expect(emailInput().readOnly).toBe(false);
    expect(screen.getByRole('button', { name: /Send OTP/i })).toBeTruthy();
  });
});

describe('what reaches Razorpay', () => {
  const actions = readFileSync(join(__dirname, '..', 'app/(storefront)/checkout/actions.ts'), 'utf8');
  const page = readFileSync(join(__dirname, '..', 'app/(storefront)/checkout/page.tsx'), 'utf8');
  const client = readFileSync(join(__dirname, '..', 'app/(storefront)/checkout/CheckoutClient.tsx'), 'utf8');

  it('the page hands the stored address to the form at all', () => {
    // The whole defect, in one line that was not there.
    expect(page).toContain('customerEmail={customer?.email ?? null}');
  });

  it('the field starts from it rather than from an empty string', () => {
    expect(client).toContain("useState(customerEmail ?? '')");
    expect(client).not.toContain("const [email, setEmail] = useState('')");
  });

  it('the prefill is read from the row, not taken from the form', () => {
    expect(actions).toContain('await storedEmail(customerId, d.contactEmail)');
    expect(actions).not.toContain("email: d.contactEmail || ''");
  });

  it('the row is written before it is read back', () => {
    // An un-awaited write is a race the prefill can lose, which would put a
    // newly collected address in the record but not in front of the customer.
    const write = actions.indexOf('await prisma.customer\n      .update');
    const read = actions.indexOf('await storedEmail(customerId');
    expect(write).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(write);
  });

  it('never falls back to an empty string', () => {
    expect(actions).toContain('return row?.email?.trim() || submitted.trim();');
  });
});
