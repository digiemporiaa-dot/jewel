import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrderForView } from '@/lib/order-detail';
import { formatDate } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Track Order',
  description: 'Track your Maya Jewellers order.',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment', CONFIRMED: 'Confirmed', IN_MAKING: 'In making',
  READY_TO_SHIP: 'Ready to ship', SHIPPED: 'Shipped', OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered', CANCELLED: 'Cancelled', RTO: 'Returned', VERIFICATION_HOLD: 'Under verification',
};

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; phone?: string }>;
}) {
  const sp = await searchParams;
  const order = sp.order && sp.phone
    ? await getOrderForView({ orderNumber: sp.order.trim(), phone: sp.phone.trim() })
    : null;
  const searched = !!(sp.order && sp.phone);

  return (
    <div className="shell py-12 max-w-lg mx-auto">
      <p className="eyebrow text-center">Order status</p>
      <h1 className="mt-2 text-3xl text-center">Track your order</h1>

      <form action="/track" className="mt-6 border border-line bg-white p-5 space-y-3">
        <label className="block text-sm">
          <span className="block mb-1 text-xs text-ink-soft">Order number</span>
          <input name="order" defaultValue={sp.order} required placeholder="MJ20260818-XXXXXX" className="w-full border border-line px-3 py-2.5 outline-none focus:border-brass" />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-xs text-ink-soft">Mobile number (on the order)</span>
          <input name="phone" defaultValue={sp.phone} required className="w-full border border-line px-3 py-2.5 outline-none focus:border-brass" />
        </label>
        <button className="btn-primary w-full">Track</button>
      </form>

      {searched && !order && (
        <p className="mt-5 text-center text-sm text-red-700">No matching order found. Check the order number and phone.</p>
      )}

      {order && (
        <div className="mt-6 border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{order.orderNumber}</p>
              <p className="text-xs text-ink-soft">{formatDate(order.placedAt)}</p>
            </div>
            <span className="text-xs px-2 py-0.5 border border-velvet text-velvet rounded-[2px]">{STATUS_LABELS[order.status] ?? order.status.replace(/_/g, ' ')}</span>
          </div>

          {order.shipment?.awb && (
            <p className="mt-3 text-sm text-ink-soft">Courier: {order.shipment.courier ?? '—'} · AWB {order.shipment.awb}</p>
          )}

          <ol className="mt-4 space-y-1.5 text-sm">
            {order.events.slice(-6).map((e) => (
              <li key={e.id} className="flex gap-3"><span className="text-ink-soft w-28 shrink-0">{formatDate(e.createdAt)}</span><span>{e.message}</span></li>
            ))}
          </ol>

          {order.shipment?.trackingUrl && (
            <a href={order.shipment.trackingUrl} target="_blank" rel="noreferrer" className="btn-outline text-sm mt-4 inline-flex">Live courier tracking</a>
          )}
          <div className="mt-3">
            <Link href={`/order/${order.orderNumber}`} className="text-sm underline underline-offset-4 hover:text-brass">Full order details</Link>
          </div>
        </div>
      )}
    </div>
  );
}
