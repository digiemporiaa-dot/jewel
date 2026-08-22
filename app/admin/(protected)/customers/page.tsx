import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { listCustomers } from '@/lib/admin/crm';
import { formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import ArchiveToggle from '@/components/admin/ArchiveToggle';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; deleted?: string }>;
}) {
  await requirePermission('customers.view');
  const sp = await searchParams;
  const deleted = sp.deleted === '1';
  const result = await listCustomers({ q: sp.q, page: sp.page ? Number(sp.page) : 1, deleted });

  return (
    <div>
      <PageHeader title="Customers" description={`${result.total} customers`} />

      <ArchiveToggle
        basePath="/admin/customers"
        param="deleted"
        params={{ q: sp.q }}
        active={deleted}
        liveLabel="Customers"
        archivedLabel="Removed"
      />

      <form className="mb-4 flex gap-2 text-sm" action="/admin/customers">
        {deleted && <input type="hidden" name="deleted" value="1" />}
        <input name="q" defaultValue={sp.q} placeholder="Search name / phone / email" className="border border-line px-3 py-2 outline-none focus:border-brass min-w-[240px]" />
        <button className="btn-outline text-xs">Search</button>
      </form>

      {result.items.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No customers yet</p>
          <p className="text-sm text-ink-soft mt-1">Customers appear after their first OTP sign-in or order.</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Orders</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((c) => (
                <tr key={c.id} className="border-b border-line/60 hover:bg-paper-2/40">
                  <td className="px-4 py-2">
                    <Link href={`/admin/customers/${c.id}`} className="font-medium hover:text-brass">{c.name ?? 'Guest customer'}</Link>
                  </td>
                  <td className="px-4 py-2 text-ink-soft">{c.phone}{c.email ? <div className="text-xs">{c.email}</div> : null}</td>
                  <td className="px-4 py-2">{c._count.orders}</td>
                  <td className="px-4 py-2 text-ink-soft">{formatDate(c.createdAt)}</td>
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
            {result.page > 1 && <Link href={`/admin/customers?page=${result.page - 1}`} className="btn-outline text-xs">Previous</Link>}
            {result.page < result.totalPages && <Link href={`/admin/customers?page=${result.page + 1}`} className="btn-outline text-xs">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
