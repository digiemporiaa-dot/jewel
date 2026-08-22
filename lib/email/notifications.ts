import 'server-only';
import { prisma } from '@/lib/prisma';
import { sendTemplate } from '@/lib/templates';

/**
 * Order and payment emails.
 *
 * The copy lives in `MessageTemplate` rows (editable under Marketing →
 * Templates) with the built-in text in `lib/templates/registry.ts` as the
 * fallback. This file's job is only to gather the values a template may
 * reference — nothing a customer reads is written here.
 */

function money(v: unknown): string {
  return `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** HTML-escape order text before it becomes markup in the items table. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function orderUrl(): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/my-account/orders`;
}

/** Non-blocking order confirmation email. Safe to call after order creation. */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || !order.contactEmail) return;

    // Built here rather than in the template, so a product name containing
    // angle brackets can never become markup: the registry marks items_table as
    // html precisely because this code — not the operator — produced it.
    const itemsTable = order.items
      .map(
        (i) =>
          `<tr><td style="padding:4px 0">${esc(i.nameSnapshot)} × ${i.quantity}</td>` +
          `<td align="right">${money(i.lineTotal)}</td></tr>`
      )
      .join('');

    await sendTemplate({
      key: 'order_confirmation',
      to: order.contactEmail,
      customerId: order.customerId,
      values: {
        name: order.contactName,
        order_number: order.orderNumber,
        order_total: money(order.grandTotal),
        payment_method: order.paymentMethod,
        order_url: orderUrl(),
        items_table: itemsTable,
      },
    });
  } catch (e) {
    console.error('[email] order confirmation failed', e);
  }
}

export async function sendPaymentConfirmation(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || !order.contactEmail) return;

    await sendTemplate({
      key: 'payment_confirmation',
      to: order.contactEmail,
      customerId: order.customerId,
      values: {
        name: order.contactName,
        order_number: order.orderNumber,
        amount_paid: money(order.amountPaid),
        order_url: orderUrl(),
      },
    });
  } catch (e) {
    console.error('[email] payment confirmation failed', e);
  }
}
