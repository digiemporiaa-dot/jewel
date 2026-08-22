'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type Result = { ok: boolean; error?: string };

const campaignSchema = z.object({
  type: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(80),
  isActive: z.coerce.boolean(),
  abandonAfterMinutes: z.coerce.number().int().min(5).max(10080).optional(),
  stage1: z.coerce.number().int().min(5).max(20160).optional(),
  stage2: z.coerce.number().int().min(5).max(20160).optional(),
  stage3: z.coerce.number().int().min(5).max(20160).optional(),
  minGapMinutes: z.coerce.number().int().min(5).max(10080).optional(),
});

/** Upsert a campaign's on/off state and (for abandoned cart) its delay config. */
export async function saveCampaignAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission('settings.manage');
  const raw = Object.fromEntries(fd.entries());
  const parsed = campaignSchema.safeParse({ ...raw, isActive: raw.isActive === 'on' || raw.isActive === 'true' });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const d = parsed.data;

  const config: Prisma.InputJsonValue | undefined =
    d.type === 'ABANDONED_CART'
      ? {
          abandonAfterMinutes: d.abandonAfterMinutes ?? 60,
          stageDelaysMinutes: [d.stage1 ?? 60, d.stage2 ?? 1440, d.stage3 ?? 4320],
          minGapMinutes: d.minGapMinutes ?? 60,
        }
      : undefined;

  const existing = await prisma.campaign.findFirst({ where: { type: d.type } });
  if (existing) {
    await prisma.campaign.update({
      where: { id: existing.id },
      data: { name: d.name, isActive: d.isActive, ...(config ? { config } : {}) },
    });
  } else {
    await prisma.campaign.create({
      data: { type: d.type, name: d.name, isActive: d.isActive, ...(config ? { config } : {}) },
    });
  }
  await writeAudit({ userId: staff.id, action: 'CAMPAIGN_UPDATE', entity: 'Campaign', entityId: d.type, after: { isActive: d.isActive } });
  revalidatePath('/admin/campaigns');
  return { ok: true };
}

// Message-template editing moved to Marketing → Email Templates
// (app/admin/(protected)/marketing/templates). That editor sanitises the body on
// save and validates placeholders against a fixed per-template whitelist; this
// one accepted an arbitrary key and arbitrary markup, which is exactly the
// free-form-markup vector the marketing-tag work ruled out.
