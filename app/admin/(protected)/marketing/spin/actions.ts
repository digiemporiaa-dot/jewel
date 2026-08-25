'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
// Only `parseSegments` is needed here. A `'use server'` file may export nothing
// but async functions, so the default wheel is imported by the page instead.
import { parseSegments } from '@/lib/spin/segments';

export type Result = { ok: boolean; error?: string };

const PERMISSION = 'settings.manage' as const;

const campaignSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  isActive: z.boolean(),
  perPhoneLimit: z.number().int().min(1).max(10),
  couponValidityDays: z.number().int().min(1, 'A prize must be valid for at least a day').max(365),
  startsAt: z.string().trim().optional().or(z.literal('')),
  endsAt: z.string().trim().optional().or(z.literal('')),
});

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Create or update the wheel.
 *
 * Segments go through the same `parseSegments` the storefront uses, so a prize
 * table that would mislead a customer or hand out an uncapped percentage is
 * refused here — at the point somebody could still fix it — rather than
 * silently taking the wheel off the site later.
 */
export async function saveCampaignAction(input: {
  id?: string;
  name: string;
  isActive: boolean;
  perPhoneLimit: number;
  couponValidityDays: number;
  startsAt?: string;
  endsAt?: string;
  segments: unknown;
}): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form' };

  const segments = parseSegments(input.segments);
  if (!segments.ok) return { ok: false, error: segments.error };

  const d = parsed.data;
  const starts = toDate(d.startsAt);
  const ends = toDate(d.endsAt);
  if (starts && ends && ends <= starts) {
    return { ok: false, error: 'The end of the window must come after its start' };
  }

  const data = {
    name: d.name,
    isActive: d.isActive,
    perPhoneLimit: d.perPhoneLimit,
    couponValidityDays: d.couponValidityDays,
    startsAt: starts,
    endsAt: ends,
    segments: segments.segments as unknown as Prisma.InputJsonValue,
  };

  if (input.id) {
    // Only one wheel may run at a time — two active campaigns would give the
    // same visitor different odds depending on which one loaded first.
    if (d.isActive) {
      await prisma.spinCampaign.updateMany({ where: { id: { not: input.id }, isActive: true }, data: { isActive: false } });
    }
    await prisma.spinCampaign.update({ where: { id: input.id }, data });
  } else {
    if (d.isActive) await prisma.spinCampaign.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await prisma.spinCampaign.create({ data });
  }

  await writeAudit({
    userId: staff.id,
    action: input.id ? 'SPIN_CAMPAIGN_UPDATE' : 'SPIN_CAMPAIGN_CREATE',
    entity: 'SpinCampaign',
    entityId: input.id ?? d.name,
    // The prize table is the money. An audit entry that did not record it could
    // not answer "what odds were we running on the 14th".
    after: { name: d.name, isActive: d.isActive, segments: segments.segments, couponValidityDays: d.couponValidityDays },
  });
  revalidatePath('/admin/marketing/spin');
  revalidatePath('/');
  return { ok: true };
}

/** The kill switch. One click, no deploy. */
export async function setCampaignActiveAction(id: string, isActive: boolean): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  if (isActive) {
    await prisma.spinCampaign.updateMany({ where: { id: { not: id }, isActive: true }, data: { isActive: false } });
  }
  await prisma.spinCampaign.update({ where: { id }, data: { isActive } });
  await writeAudit({
    userId: staff.id,
    action: isActive ? 'SPIN_CAMPAIGN_ENABLE' : 'SPIN_CAMPAIGN_DISABLE',
    entity: 'SpinCampaign',
    entityId: id,
    after: { isActive },
  });
  revalidatePath('/admin/marketing/spin');
  revalidatePath('/');
  return { ok: true };
}
