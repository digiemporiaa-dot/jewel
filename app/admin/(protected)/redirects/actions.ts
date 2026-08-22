'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { saveRedirect, importRedirects, type ImportSummary } from '@/lib/redirects';
import { parseRedirectCsv, normalisePath } from '@/lib/redirects/rules';

/**
 * Managing redirects.
 *
 * The dangerous operations here are creation and import: a bad rule can send a
 * shopper somewhere wrong, and a loop can make part of the site unreachable. All
 * of that is refused in `lib/redirects`, which this calls — the validation is not
 * repeated here, because two copies of a safety rule is one copy too many.
 */

export type Result = { ok: boolean; error?: string };
const PERMISSION = 'settings.manage' as const;

const MAX_CSV_BYTES = 512 * 1024;

function refresh(): void {
  revalidatePath('/admin/redirects');
}

export async function saveRedirectAction(fd: FormData): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const res = await saveRedirect({
    fromPath: String(fd.get('fromPath') ?? ''),
    toPath: String(fd.get('toPath') ?? ''),
    statusCode: Number(fd.get('statusCode') ?? 301),
    note: String(fd.get('note') ?? '').trim() || null,
    isActive: fd.get('isActive') !== 'off',
    createdBy: staff.id,
  });
  if (!res.ok) return res;

  await writeAudit({
    userId: staff.id,
    action: 'REDIRECT_SAVE',
    entity: 'Redirect',
    entityId: res.id,
    after: { fromPath: normalisePath(String(fd.get('fromPath') ?? '')), toPath: String(fd.get('toPath') ?? '') },
  });

  refresh();
  return { ok: true };
}

/**
 * Switch a rule off without losing it.
 *
 * Preferred over deleting: a redirect nobody understands is usually one that is
 * still carrying traffic, and turning it off is reversible in a way that
 * deleting the record of what it pointed at is not.
 */
export async function toggleRedirectAction(id: string, isActive: boolean): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  await prisma.redirect.update({ where: { id }, data: { isActive } });
  await writeAudit({
    userId: staff.id,
    action: isActive ? 'REDIRECT_ENABLE' : 'REDIRECT_DISABLE',
    entity: 'Redirect',
    entityId: id,
  });

  refresh();
  return { ok: true };
}

export async function deleteRedirectAction(id: string): Promise<Result> {
  const staff = await assertPermission(PERMISSION);

  const before = await prisma.redirect.findUnique({
    where: { id },
    select: { fromPath: true, toPath: true, hitCount: true },
  });
  if (!before) return { ok: true };

  await prisma.redirect.delete({ where: { id } });
  // The audit keeps what it pointed at, so a rule deleted by mistake can be
  // rebuilt from the log rather than from memory.
  await writeAudit({
    userId: staff.id,
    action: 'REDIRECT_DELETE',
    entity: 'Redirect',
    entityId: id,
    before,
  });

  refresh();
  return { ok: true };
}

export type ImportResult =
  | { ok: true; summary: ImportSummary; parseErrors: { line: number; raw: string; error: string }[] }
  | { ok: false; error: string };

/**
 * Import a pasted CSV.
 *
 * Two kinds of failure are reported separately and both are shown: rows that
 * could not be parsed, and rows that parsed but were refused when saved (a loop,
 * a reserved path). An import of two hundred rules must never silently drop the
 * nine that did not work.
 */
export async function importRedirectsAction(fd: FormData): Promise<ImportResult> {
  const staff = await assertPermission(PERMISSION);

  const csv = String(fd.get('csv') ?? '');
  if (csv.trim() === '') return { ok: false, error: 'Paste some rows first.' };
  if (new Blob([csv]).size > MAX_CSV_BYTES) {
    return { ok: false, error: 'That is too much at once. Split it into smaller batches.' };
  }

  const parsed = parseRedirectCsv(csv);
  const good = parsed.filter((r) => r.ok).map((r) => r.rule);
  const parseErrors = parsed
    .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    .map(({ line, raw, error }) => ({ line, raw, error }));

  if (good.length === 0 && parseErrors.length > 0) {
    return { ok: true, summary: { created: 0, updated: 0, skipped: [] }, parseErrors };
  }

  const summary = await importRedirects(good, staff.id);

  await writeAudit({
    userId: staff.id,
    action: 'REDIRECT_IMPORT',
    entity: 'Redirect',
    after: { created: summary.created, updated: summary.updated, rejected: summary.skipped.length + parseErrors.length },
  });

  refresh();
  return { ok: true, summary, parseErrors };
}

/** Preview a CSV without touching the table, so an operator can check first. */
export async function previewImportAction(csv: string): Promise<{
  valid: number;
  errors: { line: number; raw: string; error: string }[];
}> {
  await assertPermission(PERMISSION);
  const parsed = parseRedirectCsv(csv);
  return {
    valid: parsed.filter((r) => r.ok).length,
    errors: parsed
      .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
      .map(({ line, raw, error }) => ({ line, raw, error })),
  };
}
