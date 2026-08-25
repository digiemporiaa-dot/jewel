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
 */

const VALID_CHECKOUT = {
  contactName: 'Ananya Sharma',
  contactPhone: '9810012345',
  contactEmail: '',
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

  it('accepts an order with no email either', () => {
    // Email is required to complete a *profile*, not to buy something.
    expect(placeOrderSchema.safeParse({ ...VALID_CHECKOUT, contactEmail: '' }).success).toBe(true);
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
