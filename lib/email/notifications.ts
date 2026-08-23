import 'server-only';
import { prisma } from '@/lib/prisma';
import { sendTemplate } from '@/lib/templates';
import { isCampaignEnabled } from '@/lib/campaigns';

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

/**
 * The parcel has left. Sent once, when a courier first reports movement.
 *
 * Called from the shipment sync rather than from an admin action, because the
 * courier is authoritative for fulfilment: the customer should hear it when it
 * is true, not when somebody remembers to press a button.
 */
export async function sendOrderShipped(orderId: string): Promise<void> {
  try {
    // Transactional, but switchable: a shop that tracks parcels over WhatsApp
    // has a real reason to turn this off, and the admin card says what it costs.
    if (!(await isCampaignEnabled('ORDER_UPDATE'))) return;
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { shipment: true } });
    if (!order || !order.contactEmail) return;

    await sendTemplate({
      key: 'order_shipped',
      to: order.contactEmail,
      customerId: order.customerId,
      values: {
        name: order.contactName,
        order_number: order.orderNumber,
        courier: order.shipment?.courier ?? 'our courier partner',
        awb: order.shipment?.awb ?? '',
        // The shop's own tracking page, not the courier's: it works without the
        // customer knowing which courier carried the parcel, and it survives a
        // change of provider.
        tracking_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/track?order=${encodeURIComponent(order.orderNumber)}`,
      },
    });
  } catch (e) {
    console.error('[email] shipped notification failed', e);
  }
}

export async function sendOrderDelivered(orderId: string): Promise<void> {
  try {
    if (!(await isCampaignEnabled('ORDER_UPDATE'))) return;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || !order.contactEmail) return;

    await sendTemplate({
      key: 'order_delivered',
      to: order.contactEmail,
      customerId: order.customerId,
      values: {
        name: order.contactName,
        order_number: order.orderNumber,
        order_url: orderUrl(),
      },
    });
  } catch (e) {
    console.error('[email] delivered notification failed', e);
  }
}

/**
 * Welcome, sent once, and only to somebody who has not bought anything yet.
 *
 * The order-count guard is the whole safeguard: a welcome arriving in the same
 * minute as an order confirmation reads as a broken shop, and one arriving on
 * somebody's fourth order reads worse. Whatever wires this up later, it cannot
 * land next to a receipt.
 */
export async function sendWelcome(customerId: string): Promise<void> {
  try {
    if (!(await isCampaignEnabled('NEW_CUSTOMER'))) return;
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true, email: true, _count: { select: { orders: true } } },
    });
    if (!customer?.email) return;
    if (customer._count.orders > 0) return;

    await sendTemplate({
      key: 'new_customer',
      to: customer.email,
      customerId: customer.id,
      values: {
        name: customer.name ?? 'there',
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/my-account`,
      },
    });
  } catch (e) {
    console.error('[email] welcome failed', e);
  }
}
