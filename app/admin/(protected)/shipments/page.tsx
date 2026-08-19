import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listShipments } from '@/lib/admin/shipments';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import { ShipmentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const ATTENTION: ShipmentStatus[] = [ShipmentStatus.NDR, ShipmentStatus.RTO_INITIATED];

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requirePermission('shipments.manage');
  const sp = await searchParams;
  const status = sp.status && sp.status in ShipmentStatus ? (sp.status as ShipmentStatus) : undefined;
  const result = await listShipments({ status, page: sp.page ? Number(sp.page) : 1 });

  return (
    <div>
      <PageHeader title="Shipments" description={`${result.total} shipments`} />

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href="/admin/shipments" className={cn('btn-outline', !status && 'border-brass text-brass')}>All</Link>
        {Object.values(ShipmentStatus).map((s) => (
          <Link key={s} href={`/admin/shipments?status=${s}`} className={cn('btn-outline', status === s && 'border-brass text-brass', ATTENTION.includes(s) && (result.counts[s] ?? 0) > 0 && 'text-red-700 border-red-300')}>
            {s.replace(/_/g, ' ')} {result.counts[s] ? `(${result.counts[s]})` : ''}
          </Link>
        ))}
      </div>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No shipments</p>
          <p className="text-sm text-ink-soft mt-1">Create shipments from confirmed orders.</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">AWB / Courier</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((s) => (
                <tr key={s.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2"><Link href={`/admin/orders/${s.order.id}`} className="font-medium hover:text-brass">{s.order.orderNumber}</Link></td>
                  <td className="px-4 py-2">{s.order.contactName}<div className="text-xs text-ink-soft">{s.order.contactPhone}</div></td>
                  <td className="px-4 py-2">{s.awb ?? '—'}<div className="text-xs text-ink-soft">{s.courier ?? ''}</div></td>
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-[2px] border', ATTENTION.includes(s.status) ? 'border-red-300 text-red-700' : 'border-velvet text-velvet')}>{s.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{formatDate(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
