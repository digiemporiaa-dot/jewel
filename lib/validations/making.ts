import { z } from 'zod';

const decimalString = z
  .string()
  .trim()
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Enter a valid number');

export const makingRuleSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(80),
    scope: z.enum(['VARIANT', 'CATEGORY_METAL_PURITY', 'CATEGORY_METAL', 'METAL', 'GLOBAL']),
    type: z.enum(['PERCENTAGE', 'PER_GRAM', 'FLAT']),
    value: decimalString,
    minCharge: z.string().trim().optional().nullable(),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    metalId: z.string().optional().nullable(),
    purityId: z.string().optional().nullable(),
    categoryId: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // Scope-required references (brief §32 resolution order).
    const needsMetal = ['METAL', 'CATEGORY_METAL', 'CATEGORY_METAL_PURITY'].includes(data.scope);
    const needsCategory = ['CATEGORY_METAL', 'CATEGORY_METAL_PURITY'].includes(data.scope);
    const needsPurity = data.scope === 'CATEGORY_METAL_PURITY';
    if (needsMetal && !data.metalId) ctx.addIssue({ code: 'custom', path: ['metalId'], message: 'Metal is required for this scope' });
    if (needsCategory && !data.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Category is required for this scope' });
    if (needsPurity && !data.purityId) ctx.addIssue({ code: 'custom', path: ['purityId'], message: 'Purity is required for this scope' });
  });

export const makingRuleUpdateSchema = z.object({
  id: z.string().min(1),
  value: decimalString,
  minCharge: z.string().trim().optional().nullable(),
  priority: z.coerce.number().int().min(0).max(1000),
  isActive: z.coerce.boolean(),
});
