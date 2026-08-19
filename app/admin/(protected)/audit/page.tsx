import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * Audit log — read-only. There is deliberately no edit or delete action here:
 * the record is append-only and immutable from the admin UI (brief §44).
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  await requirePermission('audit.view');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const where = {
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.entity ? { entity: sp.entity } : {}),
  };

  const [logs, total, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ['action'], _count: true, orderBy: { action: 'asc' } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Audit Log" description={`${total} recorded actions — append-only and immutable.`} />

      <form className="mb-4 flex flex-wrap gap-2 text-sm" action="/admin/audit">
        <select name="action" defaultValue={sp.action ?? ''} className="border border-line px-3 py-2 outline-none focus:border-brass">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a.action} value={a.action}>{a.action} ({a._count})</option>)}
        </select>
        <input name="entity" defaultValue={sp.entity} placeholder="Entity (e.g. Order)" className="border border-line px-3 py-2 outline-none focus:border-brass" />
        <button className="btn-outline text-xs">Filter</button>
        {(sp.action || sp.entity) && <Link href="/admin/audit" className="btn-outline text-xs">Clear</Link>}
      </form>

      {logs.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No audit entries</p>
          <p className="text-sm text-ink-soft mt-1">Sensitive actions are recorded here as they happen.</p>
        </div>
      ) : (
        <div className="border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft border-b border-line">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Change</th>
                <th className="px-4 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-line/60 align-top">
                  <td className="px-4 py-2 text-ink-soft whitespace-nowrap">{formatDate(l.createdAt)}</td>
                  <td className="px-4 py-2">{l.user?.name ?? 'system'}<div className="text-xs text-ink-soft">{l.user?.email ?? ''}</div></td>
                  <td className="px-4 py-2"><span className="text-xs px-2 py-0.5 border border-line rounded-[2px]">{l.action}</span></td>
                  <td className="px-4 py-2 text-ink-soft">{l.entity}<div className="text-xs break-all">{l.entityId ?? ''}</div></td>
                  <td className="px-4 py-2 text-xs text-ink-soft max-w-xs">
                    {l.before ? <div className="break-all">− {JSON.stringify(l.before).slice(0, 120)}</div> : null}
                    {l.after ? <div className="break-all">+ {JSON.stringify(l.after).slice(0, 120)}</div> : null}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{l.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex justify-between text-sm">
          <span className="text-ink-soft">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={`/admin/audit?page=${page - 1}`} className="btn-outline text-xs">Previous</Link>}
            {page < totalPages && <Link href={`/admin/audit?page=${page + 1}`} className="btn-outline text-xs">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
