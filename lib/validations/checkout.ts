import { z } from 'zod';

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s|-/g, ''))
  .refine((v) => /^(\+91)?[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');

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
  contactEmail: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  pan: z.string().trim().max(10).optional().or(z.literal('')),
  shippingAddress: addressSchema,
  paymentMethod: z.enum(['RAZORPAY', 'COD', 'BANK_TRANSFER']),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
