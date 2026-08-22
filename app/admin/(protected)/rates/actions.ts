'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { previewRateChange, applyRateChange, applyDiamondRateChange, type RateImpact } from '@/lib/admin/rates';
import { rateChangeSchema, diamondRateChangeSchema } from '@/lib/validations/rates';
import { revalidateRateTicker } from '@/lib/rates/ticker-settings';
import { tickerSettingsSchema } from '@/lib/validations/rates';
import { prisma } from '@/lib/prisma';
import { clampSpeed } from '@/lib/rates/ticker';

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
    // The storefront strip reads through a cache tag rather than querying on
    // every page view, so a new rate has to say so.
    revalidateRateTicker();
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


export type Result = { ok: boolean; error?: string };

/**
 * The storefront rate strip's configuration.
 *
 * Note what cannot be set here: a rate. The ticker shows the same `MetalRate`
 * rows the pricing engine uses, so there is no display number to drift out of
 * step with what is charged.
 */
export async function saveTickerSettingsAction(formData: FormData): Promise<Result> {
  const staff = await assertPermission('rates.manage');

  const parsed = tickerSettingsSchema.safeParse({
    isEnabled: formData.get('isEnabled') === 'on',
    showTimestamp: formData.get('showTimestamp') === 'on',
    speedSeconds: formData.get('speedSeconds'),
    background: formData.get('background'),
    message: formData.get('message') ?? '',
    purityIds: formData.getAll('purityIds').map(String),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const d = parsed.data;

  const before = await prisma.rateTickerSettings.findUnique({ where: { id: 'default' } });

  const data = {
    isEnabled: d.isEnabled,
    showTimestamp: d.showTimestamp,
    speedSeconds: clampSpeed(d.speedSeconds),
    background: d.background,
    message: d.message.trim() === '' ? null : d.message.trim(),
    purityIds: d.purityIds,
  };

  await prisma.rateTickerSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...data },
    update: data,
  });

  await writeAudit({
    userId: staff.id,
    action: 'RATE_TICKER_UPDATE',
    entity: 'RateTickerSettings',
    entityId: 'default',
    before: before
      ? { isEnabled: before.isEnabled, background: before.background, speedSeconds: before.speedSeconds, purityIds: before.purityIds }
      : null,
    after: { isEnabled: data.isEnabled, background: data.background, speedSeconds: data.speedSeconds, purityIds: data.purityIds },
  });

  revalidatePath('/admin/rates');
  revalidateRateTicker();
  revalidatePath('/', 'layout');
  return { ok: true };
}
