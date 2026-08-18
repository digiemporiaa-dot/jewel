import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listOrders } from '@/lib/admin/orders';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import { OrderStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requirePermission('orders.view');
  const sp = await searchParams;
  const result = await listOrders({
    status: sp.status && sp.status in OrderStatus ? (sp.status as OrderStatus) : undefined,
    q: sp.q,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <div>
      <PageHeader title="Orders" description={`${result.total} orders`} />

      <form className="mb-4 flex flex-wrap gap-2 text-sm" action="/admin/orders">
        <input name="q" defaultValue={sp.q} placeholder="Order # / phone / name" className="border border-line px-3 py-2 outline-none focus:border-brass min-w-[200px]" />
        <select name="status" defaultValue={sp.status ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All statuses</option>
          {Object.values(OrderStatus).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <button className="btn-outline text-xs">Filter</button>
      </form>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No orders yet</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Payment</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Placed</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((o) => (
                <tr key={o.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-medium hover:text-brass">{o.orderNumber}</Link>
                    <div className="text-xs text-ink-soft">{o._count.items} item(s)</div>
                  </td>
                  <td className="px-4 py-2">{o.contactName}<div className="text-xs text-ink-soft">{o.contactPhone}</div></td>
                  <td className="px-4 py-2">{formatCurrency(o.grandTotal)}</td>
                  <td className="px-4 py-2 text-ink-soft">{o.paymentMethod.replace('_', ' ')}<div className="text-xs">{o.paymentStatus}</div></td>
                  <td className="px-4 py-2">
                    <span className={cn('text-xs px-2 py-0.5 rounded-[2px] border', o.requiresCall && o.status === 'VERIFICATION_HOLD' ? 'border-red-300 text-red-700' : 'border-velvet text-velvet')}>
                      {o.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{formatDate(o.placedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="mt-4 flex justify-between text-sm">
          <span className="text-ink-soft">Page {result.page} of {result.totalPages}</span>
          <div className="flex gap-2">
            {result.page > 1 && <Link href={`/admin/orders?page=${result.page - 1}`} className="btn-outline text-xs">Previous</Link>}
            {result.page < result.totalPages && <Link href={`/admin/orders?page=${result.page + 1}`} className="btn-outline text-xs">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
