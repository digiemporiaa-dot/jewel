import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/customer-session';
import { getCustomerOrders } from '@/lib/order-detail';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import AccountLogin from '../AccountLogin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Orders',
  robots: { index: false, follow: false },
};

export default async function MyOrdersPage() {
  const customer = await getCurrentCustomer();
  if (!customer) {
    return <div className="shell py-16"><AccountLogin /></div>;
  }

  const orders = await getCustomerOrders(customer.id);

  return (
    <div className="shell py-10 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl">Your Orders</h1>
        <Link href="/my-account" className="text-sm underline underline-offset-4 hover:text-brass">Account</Link>
      </div>

      {orders.length === 0 ? (
        <div className="border border-line bg-white p-10 text-center">
          <p className="font-heading text-lg">No orders yet</p>
          <Link href="/c/new-arrivals" className="btn-primary mt-4 inline-flex">Start shopping</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/order/${o.orderNumber}`} className="block border border-line bg-white p-4 hover:border-brass transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{o.orderNumber}</p>
                  <p className="text-xs text-ink-soft">{formatDate(o.placedAt)} · {o.items.map((i) => `${i.nameSnapshot} ×${i.quantity}`).join(', ').slice(0, 60)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm">{formatCurrency(o.grandTotal)}</p>
                  <p className="text-xs text-ink-soft">{o.status.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
