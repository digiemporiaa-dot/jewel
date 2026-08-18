import { z } from 'zod';

// A positive money/amount string with up to 2 decimals.
export const amountString = z
  .string()
  .trim()
  .min(1, 'Required')
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount (max 2 decimals)')
  .refine((v) => Number(v) > 0, 'Must be greater than zero');

export const rateChangeSchema = z.object({
  purityId: z.string().min(1),
  newRate: amountString,
  note: z.string().max(200).optional(),
});

export const diamondRateChangeSchema = z.object({
  diamondRateId: z.string().min(1),
  newRate: amountString,
});
