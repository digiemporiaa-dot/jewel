import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guard';
import { getOrderAdmin, ALLOWED_TRANSITIONS } from '@/lib/admin/orders';
import { can } from '@/lib/auth/rbac';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import PageHeader from '@/components/admin/PageHeader';
import OrderActions from './OrderActions';

export const dynamic = 'force-dynamic';

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission('orders.view');
  const { id } = await params;
  const order = await getOrderAdmin(id);
  if (!order) notFound();

  const ship = order.shippingAddress as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  const canManage = can(staff.role, 'orders.manage');
  const hasPending = order.payments.some((p) => p.status === 'PENDING' && p.method !== 'COD');
  const showVerify = order.requiresCall && !order.verifiedAt;

  return (
    <div>
      <PageHeader title={`Order ${order.orderNumber}`} description={`${order.status.replace(/_/g, ' ')} · ${formatDate(order.placedAt)}`} action={{ label: 'Back to orders', href: '/admin/orders' }} />

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="space-y-6">
          {/* Customer + address */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Panel title="Customer">
              <p>{order.contactName}</p>
              <p className="text-ink-soft">{order.contactPhone}</p>
              {order.contactEmail && <p className="text-ink-soft">{order.contactEmail}</p>}
              {order.pan && <p className="text-ink-soft">PAN: {order.pan}</p>}
            </Panel>
            <Panel title="Ship to">
              <p>{ship?.line1}</p>
              {ship?.line2 && <p className="text-ink-soft">{ship.line2}</p>}
              <p className="text-ink-soft">{ship?.city} {ship?.state} {ship?.pincode}</p>
            </Panel>
          </div>

          {/* Items */}
          <div className="border border-line bg-white">
            <div className="px-5 py-3 border-b border-line font-heading text-lg">Items & price snapshot</div>
            <div className="divide-y divide-line/60 text-sm">
              {order.items.map((it) => (
                <div key={it.id} className="px-5 py-3 flex justify-between">
                  <div>
                    <p>{it.nameSnapshot} × {it.quantity}</p>
                    <p className="text-xs text-ink-soft">{it.skuSnapshot} · {[it.metalSnapshot, it.puritySnapshot, it.weightSnapshot ? `${it.weightSnapshot}g` : null, it.metalRateUsed ? `@${formatCurrency(it.metalRateUsed)}/g` : null].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p>{formatCurrency(it.lineTotal)}</p>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-line text-sm space-y-1.5">
              <Row label="Subtotal (excl GST)" value={formatCurrency(order.subtotal)} />
              <Row label="Making" value={formatCurrency(order.makingTotal)} />
              <Row label="GST" value={formatCurrency(order.gstTotal)} />
              <Row label="Shipping" value={Number(order.shippingTotal) === 0 ? 'Free' : formatCurrency(order.shippingTotal)} />
              <div className="flex justify-between font-medium border-t border-line pt-2"><span>Grand total</span><span>{formatCurrency(order.grandTotal)}</span></div>
              <Row label="Amount paid" value={formatCurrency(order.amountPaid)} />
            </div>
          </div>

          {/* Payments */}
          <Panel title="Payments">
            {order.payments.map((p) => (
              <div key={p.id} className="flex justify-between text-sm py-1">
                <span className="text-ink-soft">{p.method} · {p.type} · {p.status}</span>
                <span>{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </Panel>

          {/* Timeline */}
          <Panel title="Timeline & notes">
            <ol className="space-y-1.5 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-3"><span className="text-ink-soft w-28 shrink-0">{formatDate(e.createdAt)}</span><span>{e.message}</span></li>
              ))}
            </ol>
            {order.notes.length > 0 && (
              <div className="mt-3 border-t border-line pt-3 space-y-1.5 text-sm">
                {order.notes.map((n) => (
                  <p key={n.id} className="text-ink-soft"><span className="text-ink">{n.author?.name ?? 'Staff'}:</span> {n.body}</p>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Actions (only for order managers) */}
        <div>
          {canManage ? (
            <OrderActions
              orderId={order.id}
              allowedTransitions={ALLOWED_TRANSITIONS[order.status] ?? []}
              hasPendingPayment={hasPending}
              showVerify={showVerify}
            />
          ) : (
            <div className="border border-line bg-white p-5 text-sm text-ink-soft">You have view-only access to orders.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-white p-5">
      <h2 className="font-heading text-base mb-2">{title}</h2>
      <div className="text-sm">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-soft"><span>{label}</span><span className="text-ink">{value}</span></div>;
}
