import 'server-only';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import { sendEmail } from '@/lib/email';

function money(v: unknown): string {
  return `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shell(brand: string, title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#161513">
    <h2 style="font-family:Georgia,serif;color:#17362C">${brand}</h2>
    <h3>${title}</h3>${body}
    <p style="color:#5F5950;font-size:12px;margin-top:24px">Prices reflect the metal rate locked at purchase.</p>
  </div>`;
}

/** Non-blocking order confirmation email. Safe to call after order creation. */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  try {
    const [order, store] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }),
      getStoreSettings(),
    ]);
    if (!order || !order.contactEmail) return;

    const rows = order.items
      .map((i) => `<tr><td style="padding:4px 0">${i.nameSnapshot} × ${i.quantity}</td><td align="right">${money(i.lineTotal)}</td></tr>`)
      .join('');
    const body = `
      <p>Hi ${order.contactName}, thank you for your order <strong>${order.orderNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows}
        <tr><td style="padding-top:8px;border-top:1px solid #E4DED4"><strong>Total</strong></td>
            <td align="right" style="padding-top:8px;border-top:1px solid #E4DED4"><strong>${money(order.grandTotal)}</strong></td></tr>
        <tr><td>Payment</td><td align="right">${order.paymentMethod}</td></tr>
      </table>`;
    await sendEmail({
      to: order.contactEmail,
      subject: `Order confirmed — ${order.orderNumber}`,
      html: shell(store.brandName, 'Your order is confirmed', body),
      customerId: order.customerId,
      templateKey: 'order_confirmation',
    });
  } catch (e) {
    console.error('[email] order confirmation failed', e);
  }
}

export async function sendPaymentConfirmation(orderId: string): Promise<void> {
  try {
    const [order, store] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      getStoreSettings(),
    ]);
    if (!order || !order.contactEmail) return;
    await sendEmail({
      to: order.contactEmail,
      subject: `Payment received — ${order.orderNumber}`,
      html: shell(store.brandName, 'Payment received', `<p>We’ve received ${money(order.amountPaid)} for order <strong>${order.orderNumber}</strong>.</p>`),
      customerId: order.customerId,
      templateKey: 'payment_confirmation',
    });
  } catch (e) {
    console.error('[email] payment confirmation failed', e);
  }
}
