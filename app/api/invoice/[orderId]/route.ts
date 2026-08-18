import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCustomerId } from '@/lib/customer-session';
import { auth } from '@/auth';
import { can } from '@/lib/auth/rbac';
import { generateInvoicePdf } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

/**
 * Serve the PDF invoice. Access is restricted to the owning customer or to staff
 * with order access (server-side ownership check — brief §45).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true, amountPaid: true } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [customerId, session] = await Promise.all([getCustomerId(), auth()]);
  const isOwner = customerId && order.customerId === customerId;
  const isStaff = session?.user?.id && can(session.user.role, 'orders.view');
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pdf = await generateInvoicePdf(orderId);
  if (!pdf) return NextResponse.json({ error: 'Could not generate invoice' }, { status: 500 });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${orderId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
