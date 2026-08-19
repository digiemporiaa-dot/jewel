import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getCustomerDetail } from '@/lib/admin/crm';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import StatCard from '@/components/admin/StatCard';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('customers.view');
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  const { customer, lifetimeValue, paidOrderCount } = detail;

  return (
    <div>
      <PageHeader
        title={customer.name ?? 'Guest customer'}
        description={`${customer.phone}${customer.email ? ` · ${customer.email}` : ''}`}
        action={{ label: 'Back to customers', href: '/admin/customers' }}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Lifetime value" value={formatCurrency(lifetimeValue)} />
        <StatCard label="Paid orders" value={String(paidOrderCount)} />
        <StatCard label="Total orders" value={String(customer.orders.length)} />
        <StatCard label="Joined" value={formatDate(customer.createdAt)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Orders">
          {customer.orders.length === 0 ? (
            <p className="text-sm text-ink-soft">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-line/60 text-sm">
              {customer.orders.map((o) => (
                <li key={o.id} className="py-2 flex justify-between">
                  <div>
                    <Link href={`/admin/orders/${o.id}`} className="hover:text-brass">{o.orderNumber}</Link>
                    <p className="text-xs text-ink-soft">{formatDate(o.placedAt)} · {o.status.replace(/_/g, ' ')}</p>
                  </div>
                  <span>{formatCurrency(o.grandTotal.toString())}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Addresses">
            {customer.addresses.length === 0 ? (
              <p className="text-sm text-ink-soft">No saved addresses.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {customer.addresses.map((a) => (
                  <li key={a.id} className="text-ink-soft">
                    <span className="text-ink">{a.name}</span> — {a.line1}, {a.city} {a.state} {a.pincode}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Appointments">
            {customer.appointments.length === 0 ? (
              <p className="text-sm text-ink-soft">No appointments.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {customer.appointments.map((a) => (
                  <li key={a.id} className="text-ink-soft">{formatDate(a.date)} · {a.slot} · {a.type.replace('_', ' ')} · {a.status}</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Leads">
            {customer.leads.length === 0 ? (
              <p className="text-sm text-ink-soft">No CRM leads linked.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {customer.leads.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/crm/${l.id}`} className="hover:text-brass">{l.status.replace('_', ' ')}</Link>
                    <span className="text-xs text-ink-soft"> · {formatDate(l.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
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
