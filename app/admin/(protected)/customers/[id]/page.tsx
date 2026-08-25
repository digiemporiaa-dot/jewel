import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getCustomerDetail } from '@/lib/admin/crm';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import StatCard from '@/components/admin/StatCard';
import CustomerRemoval from './CustomerRemoval';
import { GENDER_LABELS } from '@/lib/validations/signup';

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
        {/* The profile the customer filled in, rather than what the shop
            inferred. A dash means they have not told us — most records predate
            the profile form, and showing a guess would be worse than a gap. */}
        <Panel title="Profile">
          <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
            <Field label="Name" value={customer.name} />
            <Field label="Phone" value={customer.phone} />
            <Field label="Email" value={customer.email} />
            <Field label="Gender" value={customer.gender ? GENDER_LABELS[customer.gender] : null} />
            <Field label="Date of birth" value={customer.dob ? formatDate(customer.dob) : null} />
            <Field label="Anniversary" value={customer.anniversary ? formatDate(customer.anniversary) : null} />
            <Field
              label="Marketing"
              value={customer.marketingOptIn ? 'Opted in' : 'Not opted in'}
            />
            <Field
              label="Terms accepted"
              value={customer.termsAcceptedAt ? formatDate(customer.termsAcceptedAt) : null}
            />
          </dl>
        </Panel>

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

          <CustomerRemoval
            id={customer.id}
            phone={customer.phone}
            orderCount={customer.orders.length}
            deletedAt={customer.deletedAt?.toISOString() ?? null}
            anonymisedAt={customer.anonymisedAt?.toISOString() ?? null}
          />
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

/** One profile row. A missing value reads as a dash, never as an empty cell. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value?.trim() ? value : <span className="text-ink-soft">—</span>}</dd>
    </>
  );
}
