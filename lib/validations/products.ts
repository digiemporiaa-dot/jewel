import { z } from 'zod';
import { checkImageUrl } from '@/lib/uploads/constraints';
import { parseVideo } from '@/lib/video/parse';

const optionalDecimal = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v === '' || v === undefined || v === null ? null : v))
  .refine((v) => v === null || /^\d+(\.\d{1,4})?$/.test(v), 'Enter a valid number');

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const productSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(160),
    slug: z.string().trim().min(2).max(180).regex(slugRegex, 'Use lowercase letters, numbers and hyphens'),
    sku: z.string().trim().min(2, 'SKU is required').max(64),
    shortDescription: z.string().trim().max(300).optional().nullable(),
    description: z.string().trim().max(5000).optional().nullable(),
    categoryId: z.string().min(1, 'Category is required'),
    pricingMode: z.enum(['WEIGHT_BASED', 'COMPONENT_BASED', 'FIXED']),
    metalId: z.string().optional().nullable(),
    purityId: z.string().optional().nullable(),
    metalColor: z.string().trim().max(40).optional().nullable(),
    netWeight: optionalDecimal,
    grossWeight: optionalDecimal,
    wastagePct: optionalDecimal,
    makingChargeRuleId: z.string().optional().nullable(),
    fixedPrice: optionalDecimal,
    gstPercent: z.string().trim().refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid GST %'),
    gstInclusive: z.coerce.boolean().default(false),
    fulfilmentType: z.enum(['READY_TO_SHIP', 'MADE_TO_ORDER']),
    leadTimeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
    advancePercent: optionalDecimal,
    certification: z.string().trim().max(120).optional().nullable(),
    // HSN classification for the GST invoice. 4–8 digits per the GST schedule.
    hsnCode: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits, e.g. 7113')
      .optional()
      .nullable()
      .or(z.literal('')),
    isActive: z.coerce.boolean().default(true),
    isFeatured: z.coerce.boolean().default(false),
    isBestSeller: z.coerce.boolean().default(false),
    isNewArrival: z.coerce.boolean().default(false),
    occasion: z.string().trim().optional().default(''), // comma-separated in the form
    tags: z.string().trim().optional().default(''),
    /**
     * A YouTube or Vimeo address, never an embed snippet.
     *
     * Validated by the same parser the CMS block uses, so the rejection message
     * an operator sees is identical wherever they paste the wrong thing.
     */
    videoUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .superRefine((value, ctx) => {
        if (!value) return;
        const res = parseVideo(value);
        if (!res.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: res.error });
      }),
    seoTitle: z.string().trim().max(160).optional().nullable(),
    seoDescription: z.string().trim().max(320).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.pricingMode === 'FIXED') {
      if (!data.fixedPrice) ctx.addIssue({ code: 'custom', path: ['fixedPrice'], message: 'Fixed price is required for FIXED pricing' });
    } else {
      // WEIGHT_BASED / COMPONENT_BASED need a metal + purity to price against a rate.
      if (!data.metalId) ctx.addIssue({ code: 'custom', path: ['metalId'], message: 'Metal is required for weight/component pricing' });
      if (!data.purityId) ctx.addIssue({ code: 'custom', path: ['purityId'], message: 'Purity is required for weight/component pricing' });
    }
    if (data.fulfilmentType === 'MADE_TO_ORDER' && (data.leadTimeDays === null || data.leadTimeDays === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['leadTimeDays'], message: 'Lead time is required for made-to-order' });
    }
  });

export type ProductInput = z.infer<typeof productSchema>;

export const variantSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().trim().min(2, 'SKU is required').max(64),
  label: z.string().trim().max(80).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  metalColor: z.string().trim().max(40).optional().nullable(),
  netWeight: optionalDecimal,
  grossWeight: optionalDecimal,
  wastagePct: optionalDecimal,
  fixedPrice: optionalDecimal,
  stockQty: z.coerce.number().int().min(0).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(2),
  isActive: z.coerce.boolean().default(true),
});

export const imageSchema = z.object({
  productId: z.string().min(1),
  // Site-relative paths are legitimate here, so this is not `.url()`. The shared
  // check is what refuses `javascript:` and `data:` — a URL an operator pastes
  // ends up in a `src`, and that is an XSS vector wearing a picture frame.
  url: z
    .string()
    .trim()
    .min(1, 'Add an image')
    .max(500)
    .superRefine((value, ctx) => {
      const verdict = checkImageUrl(value);
      if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.error });
    }),
  // Required, not optional. An unlabelled product photo is invisible to a screen
  // reader and to image search, and the previous upload path quietly filled this
  // with the file name — "IMG_4823.jpg" is worse than nothing, because it looks
  // like the field was filled in.
  alt: z.string().trim().min(1, 'Alt text is required').max(160),
  device: z.enum(['ALL', 'DESKTOP', 'MOBILE']).default('ALL'),
  type: z.enum(['IMAGE', 'VIDEO']).default('IMAGE'),
});

/** Split a comma-separated string into a clean string[]. */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
