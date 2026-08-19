import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCustomerId } from '@/lib/customer-session';
import { getOrderForView } from '@/lib/order-detail';
import { getStoreSettings } from '@/lib/store';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Order',
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  VERIFICATION_HOLD: 'Under verification',
  CONFIRMED: 'Confirmed',
  IN_MAKING: 'In making',
  READY_TO_SHIP: 'Ready to ship',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
  RTO: 'Returned to origin',
};

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const [customerId, store] = await Promise.all([getCustomerId(), getStoreSettings()]);
  const order = await getOrderForView({ orderNumber, customerId });
  if (!order) notFound();

  const paid = Number(order.amountPaid) > 0;
  const isBank = order.paymentMethod === 'BANK_TRANSFER';

  return (
    <div className="shell py-10 max-w-3xl mx-auto">
      <div className="text-center">
        <p className="eyebrow">{order.status === 'PENDING_PAYMENT' ? 'Almost there' : 'Thank you'}</p>
        <h1 className="mt-2 text-3xl">
          {order.status === 'PENDING_PAYMENT' ? 'Complete your payment' : 'Order placed'}
        </h1>
        <p className="mt-2 text-ink-soft">Order <strong className="text-ink">{order.orderNumber}</strong> · {formatDate(order.placedAt)}</p>
        <span className={cn('inline-block mt-3 text-xs px-3 py-1 border rounded-[2px]', order.status === 'CANCELLED' ? 'border-red-300 text-red-700' : 'border-velvet text-velvet')}>
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>

      {order.requiresCall && order.status === 'VERIFICATION_HOLD' && (
        <p className="mt-6 border border-line-strong bg-paper-2 px-4 py-3 text-sm text-center">
          This is a high-value order. Our team will call {order.contactPhone} to verify before dispatch.
        </p>
      )}

      {isBank && order.status === 'PENDING_PAYMENT' && (
        <div className="mt-6 border border-line bg-white p-5 text-sm">
          <p className="font-medium">Bank transfer</p>
          <p className="text-ink-soft mt-1">Please transfer {formatCurrency(order.grandTotal)} and share the reference with us{store.whatsappNumber ? ` on WhatsApp (${store.whatsappNumber})` : ''}. We’ll confirm your order once received.</p>
        </div>
      )}

      {/* Shipment tracking */}
      {order.shipment && (
        <div className="mt-6 border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg">Tracking</h2>
            <span className="text-xs px-2 py-0.5 border border-velvet text-velvet rounded-[2px]">{order.shipment.status.replace(/_/g, ' ')}</span>
          </div>
          <dl className="mt-3 text-sm space-y-1">
            {order.shipment.courier && <Row label="Courier" value={order.shipment.courier} />}
            {order.shipment.awb && <Row label="AWB" value={order.shipment.awb} />}
            {order.shipment.deliveredAt && <Row label="Delivered" value={formatDate(order.shipment.deliveredAt)} />}
          </dl>
          {order.shipment.trackingUrl && (
            <a href={order.shipment.trackingUrl} target="_blank" rel="noreferrer" className="btn-outline text-sm mt-3 inline-flex">Track shipment</a>
          )}
        </div>
      )}

      {/* Items */}
      <div className="mt-8 border border-line bg-white">
        <div className="px-5 py-3 border-b border-line font-heading text-lg">Items</div>
        <div className="divide-y divide-line/60">
          {order.items.map((it) => (
            <div key={it.id} className="px-5 py-3 flex justify-between text-sm">
              <div>
                <p>{it.nameSnapshot} × {it.quantity}</p>
                <p className="text-xs text-ink-soft">{[it.metalSnapshot, it.puritySnapshot, it.weightSnapshot ? `${it.weightSnapshot}g` : null].filter(Boolean).join(' · ')}</p>
              </div>
              <p>{formatCurrency(it.lineTotal)}</p>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-line space-y-1.5 text-sm">
          <Row label="Subtotal (excl. GST)" value={formatCurrency(order.subtotal)} />
          <Row label="Making charges" value={formatCurrency(order.makingTotal)} />
          <Row label="GST" value={formatCurrency(order.gstTotal)} />
          <Row label="Shipping" value={Number(order.shippingTotal) === 0 ? 'Free' : formatCurrency(order.shippingTotal)} />
          <div className="flex justify-between font-medium text-base border-t border-line pt-2"><span>Total</span><span>{formatCurrency(order.grandTotal)}</span></div>
          <Row label="Amount paid" value={formatCurrency(order.amountPaid)} />
          <Row label="Payment" value={order.paymentMethod.replace('_', ' ')} />
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-6 border border-line bg-white p-5">
        <h2 className="font-heading text-lg mb-3">Order timeline</h2>
        <ol className="space-y-2 text-sm">
          {order.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="text-ink-soft w-32 shrink-0">{formatDate(e.createdAt)}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 justify-center">
        {paid && <a href={`/api/invoice/${order.id}`} className="btn-outline text-sm" target="_blank" rel="noreferrer">Download invoice (PDF)</a>}
        <Link href="/my-account/orders" className="btn-outline text-sm">My orders</Link>
        <Link href="/c/new-arrivals" className="btn-primary text-sm">Continue shopping</Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between text-ink-soft"><span>{label}</span><span className="text-ink">{value}</span></div>;
}
