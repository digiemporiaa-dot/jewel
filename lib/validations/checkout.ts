import { z } from 'zod';
import { phoneField } from '@/lib/validations/phone';

/**
 * The one phone rule, imported rather than restated.
 *
 * This file used to carry a third copy — a regex that accepted `+91` and
 * stripped spaces but had no idea what a real number looks like, so it passed
 * `9999999999` and stored whatever shape it was given. `phoneField` normalises
 * to the ten digits the column holds and refuses the placeholder numbers.
 */
export const phoneSchema = phoneField;

export const addressSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Address is required').max(160),
  line2: z.string().trim().max(160).optional().default(''),
  city: z.string().trim().min(2, 'City is required').max(60),
  state: z.string().trim().min(2, 'State is required').max(60),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  country: z.string().trim().default('India'),
});

export const placeOrderSchema = z.object({
  // A code only. The discount is computed server-side; a browser-sent amount is
  // never trusted (RULE 1).
  couponCode: z.string().trim().max(40).optional().or(z.literal('')),
  contactName: z.string().trim().min(2, 'Name is required').max(80),
  contactPhone: phoneSchema,
  /**
   * Required at checkout now, not optional.
   *
   * It is the identifier a customer signs back in with, and the only address an
   * order confirmation or a delivery update can reach. Note what is *not* here:
   * gender, date of birth and anniversary stay off the checkout form, where a
   * customer holding a ₹70,000 cart is not asked for their birthday.
   */
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address').max(160),
  pan: z.string().trim().max(10).optional().or(z.literal('')),
  shippingAddress: addressSchema,
  paymentMethod: z.enum(['RAZORPAY', 'COD', 'BANK_TRANSFER']),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
