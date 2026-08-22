import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listOrders } from '@/lib/admin/orders';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import DateRangeFilter from '@/components/admin/DateRangeFilter';
import ArchiveToggle from '@/components/admin/ArchiveToggle';
import { resolveRange, withParams } from '@/lib/admin/date-range';
import { OrderStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; preset?: string; from?: string; to?: string; archived?: string }>;
}) {
  await requirePermission('orders.view');
  const sp = await searchParams;
  const range = resolveRange({ preset: sp.preset, from: sp.from, to: sp.to });
  const archived = sp.archived === '1';
  const result = await listOrders({
    archived,
    status: sp.status && sp.status in OrderStatus ? (sp.status as OrderStatus) : undefined,
    q: sp.q,
    page: sp.page ? Number(sp.page) : 1,
    range,
  });

  // Every filter currently in the URL, so links built below keep them.
  const current = {
    status: sp.status, q: sp.q,
    preset: range.preset === 'all' ? undefined : range.preset,
    from: range.fromKey ?? undefined, to: range.toKey ?? undefined,
    archived: archived ? '1' : undefined,
  };

  return (
    <div>
      <PageHeader title="Orders" description={`${result.total} orders`} />

      <ArchiveToggle
        basePath="/admin/orders"
        param="archived"
        params={{ status: sp.status, q: sp.q, preset: range.preset === 'all' ? undefined : range.preset, from: range.fromKey ?? undefined, to: range.toKey ?? undefined }}
        active={archived}
        liveLabel="Working list"
        archivedLabel="Archived"
      />

      <form className="mb-3 flex flex-wrap gap-2 text-sm" action="/admin/orders">
        {archived && <input type="hidden" name="archived" value="1" />}
        <input name="q" defaultValue={sp.q} placeholder="Order # / phone / name" className="border border-line px-3 py-2 outline-none focus:border-brass min-w-[200px]" />
        <select name="status" defaultValue={sp.status ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All statuses</option>
          {Object.values(OrderStatus).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {/* The date range survives a search, and vice versa. */}
        {range.preset !== 'all' && <input type="hidden" name="preset" value={range.preset} />}
        {range.fromKey && <input type="hidden" name="from" value={range.fromKey} />}
        {range.toKey && <input type="hidden" name="to" value={range.toKey} />}
        <button className="btn-outline text-xs">Filter</button>
      </form>

      <DateRangeFilter basePath="/admin/orders" range={range} params={current}>
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span>
            <strong className="font-medium">{result.total}</strong> order{result.total === 1 ? '' : 's'}
            {' · '}
            <strong className="font-medium">{formatCurrency(result.gross)}</strong>
          </span>
          {result.voidedCount > 0 && (
            // Said out loud rather than folded silently into the headline: a
            // month's takings that quietly include four cancellations is the
            // figure somebody forwards to their accountant.
            <span className="text-xs text-ink-soft">
              includes {formatCurrency(result.voided)} from {result.voidedCount} cancelled or returned
            </span>
          )}
          <a href={`/api/admin/orders/export${withParams(current, {})}`} className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass">
            Export CSV
          </a>
        </span>
      </DateRangeFilter>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No orders {range.preset === 'all' ? 'yet' : `in ${range.label.toLowerCase()}`}</p>
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
            {/* Filters carried across the page turn. Written as `?page=2` and
                nothing else, these used to drop the status, the search and the
                dates, so page two disagreed with the total above it. */}
            {result.page > 1 && <a href={`/admin/orders${withParams(current, { page: result.page - 1 })}`} className="btn-outline text-xs">Previous</a>}
            {result.page < result.totalPages && <a href={`/admin/orders${withParams(current, { page: result.page + 1 })}`} className="btn-outline text-xs">Next</a>}
          </div>
        </div>
      )}
    </div>
  );
}
