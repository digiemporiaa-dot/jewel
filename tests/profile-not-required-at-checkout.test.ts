import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { placeOrderSchema } from '@/lib/validations/checkout';
import { profileGaps } from '@/lib/validations/signup';

/**
 * Profile completion belongs on /signup and /my-account, never at checkout.
 *
 * A customer with a ₹70,000 cart being asked for their date of birth before
 * paying is an abandoned cart, and every existing customer predates the profile
 * form — so an incomplete profile must never stand between somebody and an
 * order. These assertions are the guard rail: they fail the moment a required
 * profile field is added to the checkout path.
 *
 * The line moved once, deliberately. **Email and phone are now required here**
 * — they are the identifier a customer signs back in with and the number a
 * courier calls, both of which checkout genuinely needs. Gender, date of birth
 * and anniversary are still refused, and that is what these tests defend.
 */

const VALID_CHECKOUT = {
  contactName: 'Ananya Sharma',
  contactPhone: '9810012345',
  contactEmail: 'ananya@example.com',
  pan: '',
  couponCode: '',
  paymentMethod: 'RAZORPAY' as const,
  shippingAddress: {
    name: 'Ananya Sharma',
    phone: '9810012345',
    line1: '24 Karol Bagh',
    line2: '',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110005',
    country: 'India',
  },
};

describe('checkout asks for phone and address, and nothing else', () => {
  it('accepts an order with no gender, date of birth or anniversary', () => {
    expect(placeOrderSchema.safeParse(VALID_CHECKOUT).success).toBe(true);
  });

  it('now requires an email, because that is how the customer signs back in', () => {
    // This assertion used to say the opposite. Email became the verified
    // identifier, so an order with no address leaves a customer who cannot get
    // back into the account the order is attached to.
    expect(placeOrderSchema.safeParse({ ...VALID_CHECKOUT, contactEmail: '' }).success).toBe(false);
  });

  it('requires a phone that could actually be dialled', () => {
    // Nothing verifies it, so the shape check is the only thing between a typo
    // and a courier calling a stranger.
    for (const bad of ['', '1234567890', '9999999999', '9876543210', '98100']) {
      expect(placeOrderSchema.safeParse({ ...VALID_CHECKOUT, contactPhone: bad }).success, bad).toBe(false);
    }
  });

  it('stores the phone as the ten digits everything else looks it up by', () => {
    const parsed = placeOrderSchema.safeParse({ ...VALID_CHECKOUT, contactPhone: '+91 98100 12345' });
    expect(parsed.success && parsed.data.contactPhone).toBe('9810012345');
  });

  it('has no profile fields in its schema at all', () => {
    const keys = Object.keys(placeOrderSchema.shape);
    for (const profileField of ['gender', 'dob', 'dateOfBirth', 'anniversary', 'marketingOptIn']) {
      expect(keys, profileField).not.toContain(profileField);
    }
  });

  it('ignores an attempt to smuggle profile fields in', () => {
    const parsed = placeOrderSchema.safeParse({ ...VALID_CHECKOUT, gender: 'MALE', dob: '1990-05-14' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('gender');
      expect(parsed.data).not.toHaveProperty('dob');
    }
  });
});

describe('an incomplete profile never blocks an order', () => {
  it('a customer created by the checkout OTP has gaps but is still a customer', () => {
    // This is exactly the shape of every record made before the profile form
    // existed: a verified phone and nothing else.
    const legacy = { name: null, email: null, dob: null, gender: null };
    expect(profileGaps(legacy).length).toBeGreaterThan(0);
  });

  it('the order path never reads a profile field', () => {
    // Read as source rather than executed — `lib/orders.ts` is `server-only`
    // and pulls in Prisma. The assertion is the one that matters: nothing in
    // the order pipeline consults gender or date of birth, so a null one
    // cannot refuse an order.
    const source = readFileSync('lib/orders.ts', 'utf8');
    for (const field of ['gender', '.dob', 'anniversary']) {
      expect(source, field).not.toContain(field);
    }
  });

  it('the checkout action never reads a profile field', () => {
    const source = readFileSync('app/(storefront)/checkout/actions.ts', 'utf8');
    for (const field of ['gender', '.dob', 'anniversary', 'profileGaps']) {
      expect(source, field).not.toContain(field);
    }
  });
});
