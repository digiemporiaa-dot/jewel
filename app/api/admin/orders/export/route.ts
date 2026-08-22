import { auth } from '@/auth';
import { can } from '@/lib/auth/rbac';
import { writeAudit } from '@/lib/audit';
import { toCsv } from '@/lib/csv';
import { ordersForExport, EXPORT_LIMIT } from '@/lib/admin/orders';
import { resolveRange } from '@/lib/admin/date-range';
import { OrderStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * CSV of the orders currently on screen — the same filters, read from the same
 * query string, so the file matches the table it was exported from. An export
 * that quietly ignores the filters is how a "September sales" spreadsheet ends
 * up containing March.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !can(session.user.role, 'orders.view')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const statusParam = get('status');
  const range = resolveRange({ preset: get('preset'), from: get('from'), to: get('to') });

  const orders = await ordersForExport({
    status: statusParam && statusParam in OrderStatus ? (statusParam as OrderStatus) : undefined,
    q: get('q'),
    range,
  });

  const csv = toCsv(
    ['Order', 'Placed', 'Customer', 'Phone', 'Items', 'Payment method', 'Payment status', 'Status', 'Subtotal', 'Discount', 'Shipping', 'GST', 'Total', 'Paid', 'Invoice'],
    orders.map((o) => ({
      Order: o.orderNumber,
      // ISO, not a formatted date: a spreadsheet sorts this correctly and a
      // human still reads it. "22/08/2026" is ambiguous to half the world and
      // gets reinterpreted the moment the file is opened in another locale.
      Placed: o.placedAt.toISOString(),
      Customer: o.contactName,
      Phone: o.contactPhone,
      Items: o._count.items,
      'Payment method': o.paymentMethod,
      'Payment status': o.paymentStatus,
      Status: o.status,
      Subtotal: o.subtotal.toString(),
      Discount: o.discountTotal.toString(),
      Shipping: o.shippingTotal.toString(),
      GST: o.gstTotal.toString(),
      Total: o.grandTotal.toString(),
      Paid: o.amountPaid.toString(),
      Invoice: o.invoiceNumber ?? '',
    }))
  );

  // Exports carry customer names and phone numbers out of the system, so who
  // took what, and over which range, is worth a record.
  await writeAudit({
    userId: session.user.id,
    action: 'ORDERS_EXPORT',
    entity: 'Order',
    entityId: 'export',
    after: { range: range.label, rows: orders.length, truncated: orders.length === EXPORT_LIMIT },
  });

  const name = `orders-${range.fromKey ?? 'all'}-to-${range.toKey ?? 'all'}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
