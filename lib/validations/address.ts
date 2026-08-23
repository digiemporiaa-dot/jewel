import { z } from 'zod';

/**
 * What counts as a deliverable Indian address.
 *
 * Pure and free of `server-only`, so the rules can be tested directly and the
 * same schema validates a saved address and one typed at checkout — two
 * definitions would eventually disagree about what a valid pincode is.
 */
export const addressSchema = z.object({
  label: z.string().trim().max(40).optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Name is required').max(80),
  // A courier rings this number. A wrong one is a failed delivery and a return.
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  line1: z.string().trim().min(3, 'Address is required').max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'City is required').max(60),
  state: z.string().trim().min(2, 'State is required').max(60),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.infer<typeof addressSchema>;
