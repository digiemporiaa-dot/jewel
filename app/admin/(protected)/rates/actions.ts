'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { previewRateChange, applyRateChange, applyDiamondRateChange, type RateImpact } from '@/lib/admin/rates';
import { rateChangeSchema, diamondRateChangeSchema } from '@/lib/validations/rates';

export type PreviewResult =
  | { ok: true; impact: RateImpact }
  | { ok: false; error: string };

export async function previewRateAction(purityId: string, newRate: string): Promise<PreviewResult> {
  await assertPermission('rates.manage');
  const parsed = rateChangeSchema.safeParse({ purityId, newRate });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  try {
    const impact = await previewRateChange(parsed.data.purityId, parsed.data.newRate);
    return { ok: true, impact };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Preview failed' };
  }
}

export type ApplyResult = { ok: true; affected: number } | { ok: false; error: string };

export async function applyRateAction(formData: FormData): Promise<ApplyResult> {
  const staff = await assertPermission('rates.manage');
  const parsed = rateChangeSchema.safeParse({
    purityId: formData.get('purityId'),
    newRate: formData.get('newRate'),
    note: formData.get('note') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    const { previousRate, affected } = await applyRateChange(
      parsed.data.purityId,
      parsed.data.newRate,
      staff.id,
      parsed.data.note
    );
    await writeAudit({
      userId: staff.id,
      action: 'RATE_UPDATE',
      entity: 'MetalRate',
      entityId: parsed.data.purityId,
      before: { ratePerGram: previousRate },
      after: { ratePerGram: parsed.data.newRate, productsAffected: affected.length },
    });
    revalidatePath('/admin/rates');
    revalidatePath('/');
    return { ok: true, affected: affected.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}

export async function updateDiamondRateAction(formData: FormData): Promise<ApplyResult> {
  const staff = await assertPermission('rates.manage');
  const parsed = diamondRateChangeSchema.safeParse({
    diamondRateId: formData.get('diamondRateId'),
    newRate: formData.get('newRate'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  try {
    const { previousRate } = await applyDiamondRateChange(parsed.data.diamondRateId, parsed.data.newRate, staff.id);
    await writeAudit({
      userId: staff.id,
      action: 'DIAMOND_RATE_UPDATE',
      entity: 'DiamondRate',
      entityId: parsed.data.diamondRateId,
      before: { ratePerCarat: previousRate },
      after: { ratePerCarat: parsed.data.newRate },
    });
    revalidatePath('/admin/rates');
    return { ok: true, affected: 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed' };
  }
}
