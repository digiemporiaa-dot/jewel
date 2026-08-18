import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { getInventoryOverview } from '@/lib/inventory';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ low?: string }>;
}) {
  await requirePermission('inventory.manage');
  const { low } = await searchParams;
  const onlyLow = low === '1';
  const rows = await getInventoryOverview(onlyLow);
  const lowCount = (await getInventoryOverview(true)).length;

  return (
    <div>
      <PageHeader title="Inventory" description={`${rows.length} SKUs${onlyLow ? ' (low stock)' : ''}`} />

      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/admin/inventory" className={cn('btn-outline text-xs', !onlyLow && 'border-brass text-brass')}>All</Link>
        <Link href="/admin/inventory?low=1" className={cn('btn-outline text-xs', onlyLow && 'border-brass text-brass')}>Low stock ({lowCount})</Link>
      </div>

      {rows.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">{onlyLow ? 'Nothing low on stock' : 'No inventory records'}</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Product / Variant</th>
                <th className="px-4 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">Stock</th>
                <th className="px-4 py-2 font-medium">Reserved</th>
                <th className="px-4 py-2 font-medium">Available</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId} className="border-b border-line/60">
                  <td className="px-4 py-2">{r.productName}<span className="text-ink-soft">{r.variantLabel ? ` · ${r.variantLabel}` : ''}</span></td>
                  <td className="px-4 py-2 text-ink-soft">{r.sku}</td>
                  <td className="px-4 py-2">{r.stockQty}</td>
                  <td className="px-4 py-2 text-ink-soft">{r.reservedQty}</td>
                  <td className="px-4 py-2 font-medium">{r.available}</td>
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-[2px] border', r.lowStock ? 'border-red-300 text-red-700' : 'border-velvet text-velvet')}>
                      {r.lowStock ? 'Low' : 'OK'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">Adjust stock from each product’s edit page (Variants & inventory).</p>
    </div>
  );
}
