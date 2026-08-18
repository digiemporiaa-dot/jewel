'use server';

import { revalidatePath } from 'next/cache';
import { assertPermission } from '@/lib/auth/guard';
import { writeAudit } from '@/lib/audit';
import { validateImport, runImport, type ImportReport } from '@/lib/admin/import';

export async function validateImportAction(csv: string): Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  await assertPermission('products.manage');
  if (!csv || csv.trim().length === 0) return { ok: false, error: 'Paste or upload a CSV first' };
  try {
    const { report } = await validateImport(csv);
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Validation failed' };
  }
}

export async function runImportAction(csv: string): Promise<{ ok: true; imported: number; skipped: number } | { ok: false; error: string }> {
  const staff = await assertPermission('products.manage');
  if (!csv || csv.trim().length === 0) return { ok: false, error: 'Nothing to import' };
  try {
    const result = await runImport(csv);
    await writeAudit({ userId: staff.id, action: 'PRODUCT_IMPORT', entity: 'Product', after: { imported: result.imported, skipped: result.skipped } });
    revalidatePath('/admin/products');
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Import failed' };
  }
}
