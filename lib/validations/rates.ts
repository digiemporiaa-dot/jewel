import { z } from 'zod';
import { isTickerBackground, MIN_SPEED_SECONDS, MAX_SPEED_SECONDS } from '@/lib/rates/ticker';

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

/**
 * The storefront rate strip's configuration.
 *
 * `background` is validated against the token list rather than accepted as a
 * colour: an operator picks a name from the design system, never CSS. There is
 * deliberately no rate field — the ticker reads the same `MetalRate` rows the
 * pricing engine does.
 */
export const tickerSettingsSchema = z.object({
  isEnabled: z.boolean(),
  showTimestamp: z.boolean(),
  speedSeconds: z.coerce
    .number()
    .int()
    .min(MIN_SPEED_SECONDS, `Too fast to read — ${MIN_SPEED_SECONDS} seconds is the minimum`)
    .max(MAX_SPEED_SECONDS, `Slower than ${MAX_SPEED_SECONDS} seconds reads as broken`),
  background: z.string().refine(isTickerBackground, 'Pick one of the listed backgrounds'),
  message: z.string().max(120, 'Keep the message short — it shares one line with the rates'),
  purityIds: z.array(z.string().min(1)).max(12, 'More than a dozen rates is nobody reading any of them'),
});
