import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guard';
import { can } from '@/lib/auth/rbac';
import { getPipelineCounts, listLeads, getDueFollowUps, getSalesStaff } from '@/lib/admin/crm';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import PageHeader from '@/components/admin/PageHeader';
import DateRangeFilter from '@/components/admin/DateRangeFilter';
import { resolveRange, withParams } from '@/lib/admin/date-range';
import NewLeadForm from './NewLeadForm';
import { LeadStatus } from '@prisma/client';
import { leadTitle, leadContact } from '@/lib/admin/lead-display';

export const dynamic = 'force-dynamic';

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; preset?: string; from?: string; to?: string }>;
}) {
  const staff = await requirePermission('crm.access');
  const sp = await searchParams;
  // Sales executives see only their own leads; managers see everything.
  const scope = { userId: staff.id, assignedOnly: !can(staff.role, 'orders.manage') };

  const status = sp.status && sp.status in LeadStatus ? (sp.status as LeadStatus) : undefined;
  const range = resolveRange({ preset: sp.preset, from: sp.from, to: sp.to });
  const [counts, leads, due, salesStaff] = await Promise.all([
    getPipelineCounts(scope),
    listLeads(scope, { status, q: sp.q, page: sp.page ? Number(sp.page) : 1, range }),
    getDueFollowUps(scope),
    getSalesStaff(),
  ]);

  const current = {
    status: sp.status, q: sp.q,
    preset: range.preset === 'all' ? undefined : range.preset,
    from: range.fromKey ?? undefined, to: range.toKey ?? undefined,
  };

  return (
    <div>
      <PageHeader title="CRM" description={scope.assignedOnly ? 'Your assigned leads' : `${leads.total} leads`} />

      <div className="mb-5"><NewLeadForm staff={salesStaff} /></div>

      {/* Pipeline. Plain anchors, like the date presets: soft navigation to the
          same route with a different query aborts often enough here that these
          cards used to ignore roughly one click in three. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
        {Object.values(LeadStatus).map((s) => (
          <a key={s} href={`/admin/crm${withParams(current, { status: s, page: null })}`} className={cn('border p-3 hover:border-brass transition-colors', status === s ? 'border-brass bg-paper-2' : 'border-line bg-white')}>
            <p className="text-[0.65rem] tracking-[0.1em] uppercase text-ink-soft">{s.replace('_', ' ')}</p>
            <p className="mt-1 font-heading text-xl">{counts[s]}</p>
          </a>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
        {/* Leads */}
        <div>
          <form className="mb-3 flex gap-2 text-sm" action="/admin/crm">
            <input name="q" defaultValue={sp.q} placeholder="Search name / phone / email" className="border border-line px-3 py-2 outline-none focus:border-brass flex-1" />
            {status && <input type="hidden" name="status" value={status} />}
            {range.preset !== 'all' && <input type="hidden" name="preset" value={range.preset} />}
            {range.fromKey && <input type="hidden" name="from" value={range.fromKey} />}
            {range.toKey && <input type="hidden" name="to" value={range.toKey} />}
            <button className="btn-outline text-xs">Search</button>
          </form>

          <DateRangeFilter basePath="/admin/crm" range={range} params={current}>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span>
                <strong className="font-medium">{leads.total}</strong> lead{leads.total === 1 ? '' : 's'}
                {leads.valuedCount > 0 && <> · <strong className="font-medium">{formatCurrency(leads.estimatedValue)}</strong></>}
              </span>
              {/* A pipeline figure covering three of forty leads is not a
                  pipeline figure, so the screen says what it covers. */}
              {leads.valuedCount > 0 && leads.valuedCount < leads.total && (
                <span className="text-xs text-ink-soft">estimated on {leads.valuedCount} of {leads.total}</span>
              )}
              <a href={`/api/admin/leads/export${withParams(current, {})}`} className="text-xs underline decoration-line-strong underline-offset-4 hover:text-brass">
                Export CSV
              </a>
            </span>
          </DateRangeFilter>

          {leads.items.length === 0 ? (
            <div className="border border-line bg-white p-10 text-center">
              <p className="font-heading text-lg">No leads {status ? `in ${status.replace('_', ' ')}` : 'yet'}</p>
              <p className="text-sm text-ink-soft mt-1">Create one above, or they arrive from appointments and enquiries.</p>
            </div>
          ) : (
            <div className="border border-line bg-white divide-y divide-line/60">
              {leads.items.map((l) => (
                <Link key={l.id} href={`/admin/crm/${l.id}`} className="block px-4 py-3 hover:bg-paper-2/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{leadTitle(l)}</p>
                      <p className="text-xs text-ink-soft">{leadContact(l)}</p>
                      {l.product && <p className="text-xs text-ink-soft">Interested in {l.product.name}</p>}
                      <p className="text-[0.7rem] text-ink-soft">
                        {l.source.replace(/_/g, ' ').toLowerCase()}
                        {l.touchCount > 1 && ` · asked ${l.touchCount} times`}
                      </p>
                      {l.followUps[0] && <p className="text-xs text-brass">Follow-up due {formatDate(l.followUps[0].dueAt)}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs px-2 py-0.5 border border-velvet text-velvet rounded-[2px]">{l.status.replace('_', ' ')}</span>
                      {l.estimatedValue && <p className="text-xs mt-1">{formatCurrency(l.estimatedValue.toString())}</p>}
                      <p className="text-[0.7rem] text-ink-soft mt-0.5">{l.assignedTo?.name ?? 'Unassigned'}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {leads.totalPages > 1 && (
            <div className="mt-3 flex justify-between text-sm">
              <span className="text-ink-soft">Page {leads.page} of {leads.totalPages}</span>
              <div className="flex gap-2">
                {leads.page > 1 && <a href={`/admin/crm${withParams(current, { page: leads.page - 1 })}`} className="btn-outline text-xs">Previous</a>}
                {leads.page < leads.totalPages && <a href={`/admin/crm${withParams(current, { page: leads.page + 1 })}`} className="btn-outline text-xs">Next</a>}
              </div>
            </div>
          )}
        </div>

        {/* Due follow-ups */}
        <div className="border border-line bg-white">
          <div className="px-4 py-3 border-b border-line"><h2 className="font-heading text-lg">Follow-ups due</h2></div>
          {due.length === 0 ? (
            <p className="p-4 text-sm text-ink-soft">Nothing due in the next 24 hours.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {due.map((f) => (
                <li key={f.id} className="px-4 py-3 text-sm">
                  <Link href={`/admin/crm/${f.lead.id}`} className="font-medium hover:text-brass">{leadTitle(f.lead)}</Link>
                  <p className="text-xs text-ink-soft">{leadContact(f.lead)} · due {formatDate(f.dueAt)}</p>
                  {f.note && <p className="text-xs mt-0.5">{f.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
