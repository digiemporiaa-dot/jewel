'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { CouponType, CouponScope, type Prisma } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const PERMISSION = 'coupons.manage' as const;

/** Multi-select fields arrive as repeated form entries. */
function multi(fd: FormData, key: string): string[] {
  return fd.getAll(key).map(String).filter((v) => v.trim() !== '');
}

const decimalish = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || /^\d+(\.\d{1,3})?$/.test(v), 'Enter a number');

const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Code must be at least 3 characters')
      .max(40)
      .regex(/^[A-Z0-9_-]+$/i, 'Use letters, numbers, hyphens and underscores only'),
    description: z.string().trim().max(200).optional().or(z.literal('')),
    type: z.nativeEnum(CouponType),
    appliesTo: z.nativeEnum(CouponScope),
    value: z.string().trim(),
    minOrder: decimalish,
    maxDiscount: decimalish,
    usageLimit: z.string().trim().optional().or(z.literal('')),
    perUserLimit: z.string().trim().optional().or(z.literal('')),
    minWeightGrams: decimalish,
    maxWeightGrams: decimalish,
    startsAt: z.string().trim().optional().or(z.literal('')),
    endsAt: z.string().trim().optional().or(z.literal('')),
    isActive: z.boolean(),
    excludeDiscounted: z.boolean(),
    firstOrderOnly: z.boolean(),
    stackable: z.boolean(),
  })
  .refine(
    (v) => v.type === 'FREE_SHIPPING' || /^\d+(\.\d{1,2})?$/.test(v.value),
    { message: 'Enter the discount value', path: ['value'] }
  )
  .refine(
    (v) => v.type !== 'PERCENTAGE' || Number(v.value) <= 100,
    { message: 'A percentage cannot exceed 100', path: ['value'] }
  )
  .refine(
    (v) => !v.minWeightGrams || !v.maxWeightGrams || Number(v.minWeightGrams) <= Number(v.maxWeightGrams),
    { message: 'Minimum weight cannot exceed the maximum', path: ['maxWeightGrams'] }
  )
  .refine(
    (v) => !v.startsAt || !v.endsAt || new Date(v.startsAt) <= new Date(v.endsAt),
    { message: 'The start date must come before the end date', path: ['endsAt'] }
  );

function parse(fd: FormData) {
  return couponSchema.safeParse({
    code: String(fd.get('code') ?? ''),
    description: String(fd.get('description') ?? ''),
    type: fd.get('type'),
    appliesTo: fd.get('appliesTo'),
    value: String(fd.get('value') ?? '0'),
    minOrder: String(fd.get('minOrder') ?? ''),
    maxDiscount: String(fd.get('maxDiscount') ?? ''),
    usageLimit: String(fd.get('usageLimit') ?? ''),
    perUserLimit: String(fd.get('perUserLimit') ?? ''),
    minWeightGrams: String(fd.get('minWeightGrams') ?? ''),
    maxWeightGrams: String(fd.get('maxWeightGrams') ?? ''),
    startsAt: String(fd.get('startsAt') ?? ''),
    endsAt: String(fd.get('endsAt') ?? ''),
    isActive: fd.get('isActive') === 'on',
    excludeDiscounted: fd.get('excludeDiscounted') === 'on',
    firstOrderOnly: fd.get('firstOrderOnly') === 'on',
    stackable: fd.get('stackable') === 'on',
  });
}

function toData(d: z.infer<typeof couponSchema>, fd: FormData) {
  const num = (v: string | undefined) => (v && v !== '' ? v : null);
  const int = (v: string | undefined) => (v && v !== '' ? Number(v) : null);

  return {
    code: d.code.toUpperCase(),
    description: d.description || null,
    type: d.type,
    appliesTo: d.appliesTo,
    // FREE_SHIPPING carries no value; storing 0 keeps the column non-null
    // without implying a discount amount.
    value: d.type === 'FREE_SHIPPING' ? '0' : d.value,
    minOrder: num(d.minOrder),
    maxDiscount: num(d.maxDiscount),
    usageLimit: int(d.usageLimit),
    perUserLimit: int(d.perUserLimit),
    minWeightGrams: num(d.minWeightGrams),
    maxWeightGrams: num(d.maxWeightGrams),
    startsAt: d.startsAt ? new Date(d.startsAt) : null,
    endsAt: d.endsAt ? new Date(d.endsAt) : null,
    isActive: d.isActive,
    excludeDiscounted: d.excludeDiscounted,
    firstOrderOnly: d.firstOrderOnly,
    stackable: d.stackable,
    categoryIds: multi(fd, 'categoryIds'),
    collectionIds: multi(fd, 'collectionIds'),
    metalTypes: multi(fd, 'metalTypes'),
    purities: multi(fd, 'purities'),
  };
}

export async function createCouponAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const parsed = parse(fd);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const data = toData(parsed.data, fd);
  const clash = await prisma.coupon.findUnique({ where: { code: data.code }, select: { id: true } });
  if (clash) return { ok: false, error: 'That code already exists' };

  const coupon = await prisma.coupon.create({ data });
  await writeAudit({
    userId: staff.id,
    action: 'COUPON_CREATE',
    entity: 'Coupon',
    entityId: coupon.id,
    after: { code: data.code, type: data.type, appliesTo: data.appliesTo, value: data.value } as Prisma.InputJsonValue,
  });
  revalidatePath('/admin/coupons');
  redirect('/admin/coupons');
}

export async function updateCouponAction(id: string, fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const parsed = parse(fd);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const data = toData(parsed.data, fd);
  const clash = await prisma.coupon.findFirst({ where: { code: data.code, id: { not: id } }, select: { id: true } });
  if (clash) return { ok: false, error: 'That code already exists' };

  const before = await prisma.coupon.findUnique({ where: { id } });
  if (!before) return { ok: false, error: 'Coupon not found' };

  // `usageCount` is deliberately not settable from the form: it is the record of
  // what has actually been redeemed, and editing it would let someone reopen a
  // fully-redeemed code without that being visible anywhere.
  await prisma.coupon.update({ where: { id }, data });
  await writeAudit({
    userId: staff.id,
    action: 'COUPON_UPDATE',
    entity: 'Coupon',
    entityId: id,
    before: { code: before.code, appliesTo: before.appliesTo, value: before.value.toString(), isActive: before.isActive } as Prisma.InputJsonValue,
    after: { code: data.code, appliesTo: data.appliesTo, value: data.value, isActive: data.isActive } as Prisma.InputJsonValue,
  });
  revalidatePath('/admin/coupons');
  return { ok: true };
}

/**
 * Deactivate rather than delete.
 *
 * Orders reference the coupon they were placed with, and a deleted row would
 * break that link — the discount on a past order has to stay explainable months
 * later when a refund or a chargeback surfaces.
 */
export async function deactivateCouponAction(id: string): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const before = await prisma.coupon.findUnique({ where: { id }, select: { code: true, isActive: true } });
  if (!before) return { ok: false, error: 'Coupon not found' };

  await prisma.coupon.update({ where: { id }, data: { isActive: !before.isActive } });
  await writeAudit({
    userId: staff.id,
    action: before.isActive ? 'COUPON_DEACTIVATE' : 'COUPON_REACTIVATE',
    entity: 'Coupon',
    entityId: id,
    before: { code: before.code, isActive: before.isActive } as Prisma.InputJsonValue,
    after: { isActive: !before.isActive } as Prisma.InputJsonValue,
  });
  revalidatePath('/admin/coupons');
  return { ok: true };
}
