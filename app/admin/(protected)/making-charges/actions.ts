'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { previewMakingSample } from '@/lib/admin/making';
import { makingRuleSchema, makingRuleUpdateSchema } from '@/lib/validations/making';
import type { MakingChargeType } from '@prisma/client';

export type ActionResult = { ok: true } | { ok: false; error: string };

function cleanMin(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
}

export async function createMakingRuleAction(formData: FormData): Promise<ActionResult> {
  const staff = await assertPermission('making_charges.manage');
  const parsed = makingRuleSchema.safeParse({
    name: formData.get('name'),
    scope: formData.get('scope'),
    type: formData.get('type'),
    value: formData.get('value'),
    minCharge: cleanMin(formData.get('minCharge')),
    priority: formData.get('priority') ?? 0,
    metalId: formData.get('metalId') || null,
    purityId: formData.get('purityId') || null,
    categoryId: formData.get('categoryId') || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const d = parsed.data;
  const rule = await prisma.makingChargeRule.create({
    data: {
      name: d.name, scope: d.scope, type: d.type, value: d.value,
      minCharge: d.minCharge, priority: d.priority,
      metalId: d.metalId || null, purityId: d.purityId || null, categoryId: d.categoryId || null,
    },
  });
  await writeAudit({ userId: staff.id, action: 'MAKING_RULE_CREATE', entity: 'MakingChargeRule', entityId: rule.id, after: { name: d.name, scope: d.scope, type: d.type, value: d.value } });
  // A new rule can change resolved prices — recompute the catalogue.
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices();
  revalidatePath('/admin/making-charges');
  return { ok: true };
}

export async function updateMakingRuleAction(formData: FormData): Promise<ActionResult> {
  const staff = await assertPermission('making_charges.manage');
  const parsed = makingRuleUpdateSchema.safeParse({
    id: formData.get('id'),
    value: formData.get('value'),
    minCharge: cleanMin(formData.get('minCharge')),
    priority: formData.get('priority') ?? 0,
    isActive: formData.get('isActive') === 'true' || formData.get('isActive') === 'on',
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const before = await prisma.makingChargeRule.findUnique({ where: { id: parsed.data.id } });
  if (!before) return { ok: false, error: 'Rule not found' };

  await prisma.makingChargeRule.update({
    where: { id: parsed.data.id },
    data: {
      value: parsed.data.value,
      minCharge: parsed.data.minCharge,
      priority: parsed.data.priority,
      isActive: parsed.data.isActive,
    },
  });
  await writeAudit({
    userId: staff.id, action: 'MAKING_RULE_UPDATE', entity: 'MakingChargeRule', entityId: parsed.data.id,
    before: { value: before.value.toString(), minCharge: before.minCharge?.toString() ?? null, priority: before.priority, isActive: before.isActive },
    after: { value: parsed.data.value, minCharge: parsed.data.minCharge, priority: parsed.data.priority, isActive: parsed.data.isActive },
  });
  const { recomputeProductPrices } = await import('@/lib/pricing/resolve');
  await recomputeProductPrices();
  revalidatePath('/admin/making-charges');
  return { ok: true };
}

export async function previewMakingAction(input: {
  type: MakingChargeType;
  value: string;
  minCharge: string | null;
  sampleRatePerGram: string;
  sampleWeight: string;
}) {
  await assertPermission('making_charges.manage');
  try {
    return { ok: true as const, sample: previewMakingSample(input) };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Preview failed' };
  }
}
