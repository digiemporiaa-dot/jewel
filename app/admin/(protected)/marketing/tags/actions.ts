'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { revalidateTagConfig } from '@/lib/marketing/config';
import { marketingTagsSchema, capiTokenSchema, TAG_FIELD_KEYS } from '@/lib/marketing/tags';

export type Result = { ok: boolean; error?: string };

/** Tracking configuration is store settings, so it reuses `settings.manage`. */
const PERMISSION = 'settings.manage' as const;

function revalidateAll(): void {
  revalidateTagConfig();
  revalidatePath('/admin/marketing/tags');
}

/**
 * Save the tag configuration.
 *
 * Validation is the security control here, not a convenience: the IDs are
 * interpolated into script tags, and a strict pattern is what stops anything
 * that is not an ID from ever reaching the page. A value that fails is rejected
 * with a message — never silently stripped, which would leave the operator
 * looking at a field that appears configured and does nothing.
 */
export async function saveTagsAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const raw = Object.fromEntries(fd.entries());
  const parsed = marketingTagsSchema.safeParse({
    ...raw,
    // An unchecked checkbox is simply absent from FormData.
    metaCapiEnabled: fd.get('metaCapiEnabled') === 'on',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const before = await prisma.marketingTags.findUnique({ where: { id: 'default' } });

  await prisma.marketingTags.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...parsed.data },
    update: parsed.data,
  });

  // The audit records which tags changed, never the CAPI token — an audit log is
  // read by more people than the settings screen is.
  await writeAudit({
    userId: staff.id,
    action: 'MARKETING_TAGS_UPDATE',
    entity: 'MarketingTags',
    entityId: 'default',
    before: before ? summarise(before as Record<string, unknown>) : undefined,
    after: summarise(parsed.data as unknown as Record<string, unknown>),
  });

  revalidateAll();
  return { ok: true };
}

/** Only the IDs and the consent mode — deliberately not the token. */
function summarise(row: Record<string, unknown>): Prisma.InputJsonValue {
  const out: Record<string, string | boolean | null> = {};
  for (const key of TAG_FIELD_KEYS) out[key] = typeof row[key] === 'string' ? (row[key] as string) : null;
  out.consentMode = typeof row.consentMode === 'string' ? row.consentMode : null;
  out.metaCapiEnabled = row.metaCapiEnabled === true;
  return out;
}

/**
 * Set the Meta CAPI access token.
 *
 * Separate from the main save so the token is only ever written when it is
 * deliberately re-entered: the form shows a mask, and submitting the form with
 * the mask untouched must never overwrite the real value with `••••1234`.
 */
export async function setCapiTokenAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);
  const value = String(fd.get('metaCapiToken') ?? '');

  if (value.trim() === '') {
    await prisma.marketingTags.upsert({
      where: { id: 'default' },
      create: { id: 'default', metaCapiToken: null, metaCapiEnabled: false },
      update: { metaCapiToken: null, metaCapiEnabled: false },
    });
    await writeAudit({
      userId: staff.id,
      action: 'MARKETING_CAPI_TOKEN_CLEAR',
      entity: 'MarketingTags',
      entityId: 'default',
    });
    revalidateAll();
    return { ok: true };
  }

  const parsed = capiTokenSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid token' };

  await prisma.marketingTags.upsert({
    where: { id: 'default' },
    create: { id: 'default', metaCapiToken: parsed.data },
    update: { metaCapiToken: parsed.data },
  });

  // The token itself is never written to the audit log — only the fact that it
  // was replaced, and by whom.
  await writeAudit({
    userId: staff.id,
    action: 'MARKETING_CAPI_TOKEN_SET',
    entity: 'MarketingTags',
    entityId: 'default',
    after: { replaced: true },
  });

  revalidateAll();
  return { ok: true };
}
