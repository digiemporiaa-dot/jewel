import { requirePermission } from '@/lib/auth/guard';
import PageHeader from '@/components/admin/PageHeader';
import ImportClient from './ImportClient';
import { IMPORT_HEADERS } from '@/lib/admin/import';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requirePermission('products.manage');

  return (
    <div>
      <PageHeader
        title="Bulk product import"
        description="Upload → validate → dry-run → confirm. Nothing is written until you confirm."
        action={{ label: 'Back to products', href: '/admin/products' }}
      />
      <div className="mb-4 border border-line bg-white p-4 text-xs text-ink-soft">
        <p className="font-medium text-ink mb-1">Expected columns</p>
        <code className="break-words">{IMPORT_HEADERS.join(', ')}</code>
        <p className="mt-2">Diamonds/stones for component pricing are added per-product after import.</p>
      </div>
      <ImportClient />
    </div>
  );
}
