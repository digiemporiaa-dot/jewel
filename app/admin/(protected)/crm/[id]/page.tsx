import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { can } from '@/lib/auth/rbac';
import { getLead, getSalesStaff } from '@/lib/admin/crm';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import LeadActions, { CompleteFollowUpButton } from './LeadActions';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission('crm.access');
  const { id } = await params;
  const scope = { userId: staff.id, assignedOnly: !can(staff.role, 'orders.manage') };

  const [lead, salesStaff] = await Promise.all([getLead(id, scope), getSalesStaff()]);
  if (!lead) notFound(); // also covers "assigned to someone else" for sales execs

  return (
    <div>
      <PageHeader title={lead.name} description={`${lead.phone}${lead.email ? ` · ${lead.email}` : ''}`} action={{ label: 'Back to CRM', href: '/admin/crm' }} />

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        <div className="space-y-5">
          <Panel title="Overview">
            <dl className="space-y-1.5 text-sm">
              <Row label="Stage" value={lead.status.replace('_', ' ')} />
              <Row label="Source" value={lead.source.replace('_', ' ')} />
              <Row label="Assigned to" value={lead.assignedTo?.name ?? 'Unassigned'} />
              {lead.estimatedValue && <Row label="Estimated value" value={formatCurrency(lead.estimatedValue.toString())} />}
              {lead.lastContactedAt && <Row label="Last contacted" value={formatDate(lead.lastContactedAt)} />}
              <Row label="Created" value={formatDate(lead.createdAt)} />
            </dl>
            {lead.product && (
              <p className="mt-3 text-sm">Interested in{' '}
                <Link href={`/p/${lead.product.slug}`} className="underline underline-offset-2 hover:text-brass">{lead.product.name}</Link>
              </p>
            )}
            {lead.customer && (
              <p className="mt-2 text-sm">
                Linked customer:{' '}
                <Link href={`/admin/customers/${lead.customer.id}`} className="underline underline-offset-2 hover:text-brass">
                  {lead.customer.name ?? lead.customer.phone}
                </Link>
              </p>
            )}
            {lead.notes && <p className="mt-3 text-sm text-ink-soft whitespace-pre-wrap">{lead.notes}</p>}
          </Panel>

          <Panel title="Follow-ups">
            {lead.followUps.length === 0 ? (
              <p className="text-sm text-ink-soft">No follow-ups scheduled.</p>
            ) : (
              <ul className="divide-y divide-line/60 text-sm">
                {lead.followUps.map((f) => (
                  <li key={f.id} className="py-2 flex items-start justify-between gap-3">
                    <div>
                      <p>{formatDate(f.dueAt)} · <span className="text-ink-soft">{f.status}</span></p>
                      {f.note && <p className="text-xs text-ink-soft">{f.note}</p>}
                      <p className="text-xs text-ink-soft">{f.assignedTo?.name ?? '—'}</p>
                    </div>
                    {f.status === 'PENDING' && <CompleteFollowUpButton followUpId={f.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Call log">
            {lead.callLogs.length === 0 ? (
              <p className="text-sm text-ink-soft">No calls logged.</p>
            ) : (
              <ul className="divide-y divide-line/60 text-sm">
                {lead.callLogs.map((c) => (
                  <li key={c.id} className="py-2">
                    <p>{c.outcome} <span className="text-xs text-ink-soft">· {formatDate(c.calledAt)} · {c.staff?.name ?? '—'}</span></p>
                    {c.notes && <p className="text-xs text-ink-soft">{c.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <LeadActions
          lead={{
            id: lead.id, status: lead.status, assignedToId: lead.assignedToId,
            estimatedValue: lead.estimatedValue?.toString() ?? null, notes: lead.notes,
          }}
          staff={salesStaff}
        />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-lg mb-3">{title}</h2>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-ink-soft">{label}</dt><dd>{value}</dd></div>;
}
