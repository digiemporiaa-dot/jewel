'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkImageUrl } from '@/lib/uploads/constraints';
import { resolveStateCode } from '@/lib/tax/gst';
import { parseTenures, DEFAULT_TENURES } from '@/lib/emi';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const money = z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid amount');

const imageAddress = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(''))
  .superRefine((value, ctx) => {
    const verdict = checkImageUrl(value ?? '');
    if (!verdict.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.error });
  });

const settingsSchema = z.object({
  brandName: z.string().trim().min(2, 'Brand name is required').max(80),
  tagline: z.string().trim().max(160),
  // Both columns have existed since the schema was written and both are read —
  // the logo by the header and by Organization structured data, the favicon by
  // the root layout — but neither had a field, so no shop could set either.
  logoUrl: imageAddress,
  faviconUrl: imageAddress,
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  whatsappNumber: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().max(120).optional().or(z.literal('')),
  supportEmail: z.string().trim().max(120).optional().or(z.literal('')),
  addressLine: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(60).optional().or(z.literal('')),
  state: z.string().trim().max(60).optional().or(z.literal('')),
  pincode: z.string().trim().max(10).optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional().or(z.literal('')),
  emiEnabled: z.boolean().optional(),
  emiMinAmount: z.string().trim().optional().or(z.literal('')),
  // A textarea of "months@rate" lines. Parsed strictly and anything malformed
  // is rejected rather than saved, so a bad row cannot reach a product page.
  emiTenures: z.string().trim().optional().or(z.literal('')),
  // Two-digit GST state code. Validated against the real list, because an
  // unrecognised code makes every invoice's tax split underivable.
  sellerStateCode: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || resolveStateCode(v) !== null, 'Enter a valid GST state code, e.g. 07 for Delhi'),
  gstPercentDefault: z.string().trim().refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter a valid GST %'),
  freeShippingAbove: money.optional(),
  flatShippingFee: money.optional(),
  codMaxOrderValue: money.optional(),
  codTokenAmount: money.optional(),
  verificationCallAbove: money.optional(),
  panThreshold: money.optional(),
  rateLockMinutes: z.coerce.number().int().min(1).max(1440),
  instagram: z.string().trim().max(200).optional().or(z.literal('')),
  facebook: z.string().trim().max(200).optional().or(z.literal('')),
  youtube: z.string().trim().max(200).optional().or(z.literal('')),
  returnPolicy: z.string().trim().max(500).optional().or(z.literal('')),
  footerNote: z.string().trim().max(300).optional().or(z.literal('')),
});

const nullIfEmpty = (v: string | undefined) => (v && v !== '' ? v : null);

/**
 * Update the singleton StoreSetting row. This is the white-label configuration
 * surface — every store-specific value the app uses lives here, never in code.
 */
export async function updateSettingsAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('settings.manage');
  const parsed = settingsSchema.safeParse(Object.fromEntries(fd.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const before = await prisma.storeSetting.findUnique({ where: { id: 'default' } });

  await prisma.storeSetting.upsert({
    where: { id: 'default' },
    create: { id: 'default', brandName: d.brandName, tagline: d.tagline },
    update: {},
  });

  await prisma.storeSetting.update({
    where: { id: 'default' },
    data: {
      brandName: d.brandName,
      tagline: d.tagline,
      logoUrl: nullIfEmpty(d.logoUrl),
      faviconUrl: nullIfEmpty(d.faviconUrl),
      phone: nullIfEmpty(d.phone),
      whatsappNumber: nullIfEmpty(d.whatsappNumber),
      email: nullIfEmpty(d.email),
      supportEmail: nullIfEmpty(d.supportEmail),
      addressLine: nullIfEmpty(d.addressLine),
      city: nullIfEmpty(d.city),
      state: nullIfEmpty(d.state),
      pincode: nullIfEmpty(d.pincode),
      gstin: nullIfEmpty(d.gstin),
      emiEnabled: d.emiEnabled === true,
      emiMinAmount: nullIfEmpty(d.emiMinAmount),
      emiTenures: parseEmiTenureLines(d.emiTenures),
      sellerStateCode: d.sellerStateCode ? resolveStateCode(d.sellerStateCode) : null,
      gstPercentDefault: d.gstPercentDefault,
      freeShippingAbove: nullIfEmpty(d.freeShippingAbove),
      flatShippingFee: d.flatShippingFee && d.flatShippingFee !== '' ? d.flatShippingFee : '0',
      codMaxOrderValue: nullIfEmpty(d.codMaxOrderValue),
      codTokenAmount: d.codTokenAmount && d.codTokenAmount !== '' ? d.codTokenAmount : '0',
      verificationCallAbove: nullIfEmpty(d.verificationCallAbove),
      panThreshold: nullIfEmpty(d.panThreshold),
      rateLockMinutes: d.rateLockMinutes,
      socialLinks: { instagram: d.instagram ?? '', facebook: d.facebook ?? '', youtube: d.youtube ?? '' },
      returnPolicy: nullIfEmpty(d.returnPolicy),
      footerNote: nullIfEmpty(d.footerNote),
    },
  });

  await writeAudit({
    userId: staff.id, action: 'SETTINGS_UPDATE', entity: 'StoreSetting', entityId: 'default',
    before: before ? { brandName: before.brandName, rateLockMinutes: before.rateLockMinutes, codMaxOrderValue: before.codMaxOrderValue?.toString() ?? null } : null,
    after: { brandName: d.brandName, rateLockMinutes: d.rateLockMinutes, codMaxOrderValue: d.codMaxOrderValue ?? null },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  return { ok: true };
}


/**
 * Parse the EMI tenure textarea: one `months@annualRate` per line, e.g.
 * `12@14`. Falls back to the shipped defaults when the field is left empty, so
 * switching EMI on without configuring anything still produces sensible plans.
 */
function parseEmiTenureLines(raw: string | undefined): Prisma.InputJsonValue {
  if (!raw || raw.trim() === '') return DEFAULT_TENURES as unknown as Prisma.InputJsonValue;

  const rows = raw
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [months, rate] = line.split('@').map((v) => v.trim());
      return { months: Number(months), annualRatePercent: Number(rate) };
    });

  // `parseTenures` drops anything malformed; if that leaves nothing usable, keep
  // the defaults rather than saving an empty table that silently hides EMI.
  const clean = parseTenures(rows);
  return (clean.length > 0 ? clean : DEFAULT_TENURES) as unknown as Prisma.InputJsonValue;
}
