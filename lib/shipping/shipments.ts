import 'server-only';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { getShippingProvider } from '@/lib/shipping/provider';
import { mapShiprocketStatus } from '@/lib/shipping/status';
import { commitStock, releaseStock } from '@/lib/inventory';
import { OrderStatus, PaymentStatus, PaymentType, ShipmentStatus, PaymentMethod, type Order, type OrderItem } from '@prisma/client';
import { sendOrderShipped, sendOrderDelivered } from '@/lib/email/notifications';

export class ShippingError extends Error {}

// States from which a courier tracking update may drive the order forward.
const LIVE_ORDER_STATES: OrderStatus[] = [
  OrderStatus.CONFIRMED, OrderStatus.IN_MAKING, OrderStatus.READY_TO_SHIP,
  OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY,
];
// States an order may be in to start shipping.
const SHIPPABLE_STATES: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.IN_MAKING, OrderStatus.READY_TO_SHIP];
const PRE_READY_STATES: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.IN_MAKING];

function orderWeightKg(items: OrderItem[]): number {
  const grams = items.reduce((sum, i) => sum + Number(i.weightSnapshot ?? 0) * i.quantity, 0);
  return Math.max(0.05, Math.round((grams / 1000) * 1000) / 1000);
}

async function loadOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, shipment: true } });
  if (!order) throw new ShippingError('Order not found');
  return order;
}

/** Create a shipment with the provider for a confirmed order. */
export async function createShipmentForOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(orderId);
  if (order.shipment) return { ok: false, error: 'Shipment already exists' };
  if (!SHIPPABLE_STATES.includes(order.status)) {
    return { ok: false, error: `Cannot ship an order in status ${order.status}` };
  }
  const ship = order.shippingAddress as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string; country?: string };
  const provider = await getShippingProvider();

  const result = await provider.createShipment({
    orderNumber: order.orderNumber,
    cod: order.paymentMethod === PaymentMethod.COD,
    subtotal: Number(order.grandTotal),
    weightKg: orderWeightKg(order.items),
    contact: { name: order.contactName, phone: order.contactPhone, email: order.contactEmail },
    address: { line1: ship.line1 ?? '', line2: ship.line2, city: ship.city ?? '', state: ship.state ?? '', pincode: ship.pincode ?? '', country: ship.country },
    items: order.items.map((i) => ({ name: i.nameSnapshot, sku: i.skuSnapshot, quantity: i.quantity, unitPrice: Number(i.unitPrice) })),
  });

  await prisma.shipment.create({
    data: {
      orderId: order.id,
      provider: provider.name,
      providerOrderId: result.providerOrderId,
      providerShipmentId: result.providerShipmentId,
      status: ShipmentStatus.PENDING,
    },
  });
  await prisma.orderEvent.create({ data: { orderId: order.id, message: 'Shipment created with courier', actor: 'staff' } });
  return { ok: true };
}

export async function assignAwbForOrder(orderId: string, courierId?: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(orderId);
  if (!order.shipment?.providerShipmentId) return { ok: false, error: 'Create a shipment first' };
  const provider = await getShippingProvider();
  const awb = await provider.assignAwb(order.shipment.providerShipmentId, courierId);
  await prisma.shipment.update({
    where: { id: order.shipment.id },
    data: { awb: awb.awb, courier: awb.courier, labelUrl: awb.labelUrl ?? undefined, trackingUrl: awb.awb ? `https://shiprocket.co/tracking/${awb.awb}` : undefined },
  });
  await prisma.orderEvent.create({ data: { orderId, message: `AWB assigned: ${awb.awb} (${awb.courier})`, actor: 'staff' } });
  return { ok: true };
}

export async function schedulePickupForOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const order = await loadOrder(orderId);
  if (!order.shipment) return { ok: false, error: 'No shipment' };
  const provider = await getShippingProvider();
  const pickup = await provider.schedulePickup(order.shipment.providerShipmentId ?? '');
  await prisma.shipment.update({ where: { id: order.shipment.id }, data: { status: ShipmentStatus.PICKUP_SCHEDULED, pickupScheduledAt: pickup.pickupScheduledAt } });
  // Order becomes ready to ship if it wasn't already.
  if (PRE_READY_STATES.includes(order.status)) {
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.READY_TO_SHIP, events: { create: { status: OrderStatus.READY_TO_SHIP, message: 'Pickup scheduled', actor: 'staff' } } } });
  }
  return { ok: true };
}

export async function generateLabelForOrder(orderId: string): Promise<{ ok: boolean; labelUrl?: string; error?: string }> {
  const order = await loadOrder(orderId);
  if (!order.shipment?.providerShipmentId) return { ok: false, error: 'No shipment' };
  const provider = await getShippingProvider();
  const { labelUrl } = await provider.generateLabel(order.shipment.providerShipmentId);
  await prisma.shipment.update({ where: { id: order.shipment.id }, data: { labelUrl } });
  return { ok: true, labelUrl };
}

export async function generateManifestForOrder(orderId: string): Promise<{ ok: boolean; manifestUrl?: string; error?: string }> {
  const order = await loadOrder(orderId);
  if (!order.shipment?.providerShipmentId) return { ok: false, error: 'No shipment' };
  const provider = await getShippingProvider();
  const { manifestUrl } = await provider.generateManifest([order.shipment.providerShipmentId]);
  await prisma.shipment.update({ where: { id: order.shipment.id }, data: { manifestUrl } });
  return { ok: true, manifestUrl };
}

/**
 * Apply a courier status (from live tracking or a webhook) to the shipment and,
 * where appropriate, drive the order forward. The courier is authoritative for
 * fulfilment states. Side effects: commit stock + COD capture on delivery; release
 * stock on RTO.
 */
export async function applyShipmentStatus(orderId: string, rawStatus: string, source: string): Promise<void> {
  const order = await loadOrder(orderId);
  if (!order.shipment) return;
  const mapping = mapShiprocketStatus(rawStatus);

  const data: { status: ShipmentStatus; shippedAt?: Date; deliveredAt?: Date; ndrReason?: string; rtoInitiatedAt?: Date } = { status: mapping.shipment };
  // Both emails fire on the *transition*, read before the update is applied.
  // Couriers repeat a status happily; a customer told four times that their
  // parcel has shipped stops reading anything the shop sends.
  const justShipped = mapping.shipment === ShipmentStatus.IN_TRANSIT && !order.shipment.shippedAt;
  const justDelivered = mapping.shipment === ShipmentStatus.DELIVERED && !order.shipment.deliveredAt;
  if (justShipped) data.shippedAt = new Date();
  if (mapping.shipment === ShipmentStatus.DELIVERED) data.deliveredAt = new Date();
  if (mapping.shipment === ShipmentStatus.NDR) data.ndrReason = rawStatus;
  if (mapping.shipment === ShipmentStatus.RTO_INITIATED) data.rtoInitiatedAt = new Date();
  await prisma.shipment.update({ where: { id: order.shipment.id }, data });

  // Drive the order forward only from a live fulfilment state.
  if (mapping.order && LIVE_ORDER_STATES.includes(order.status) && order.status !== mapping.order) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: mapping.order, events: { create: { status: mapping.order, message: `Courier: ${rawStatus}`, actor: source } } },
    });
  } else {
    await prisma.orderEvent.create({ data: { orderId, message: `Courier update: ${rawStatus}`, actor: source } });
  }

  // The customer hears it from the courier's own signal rather than from an
  // admin remembering to press something.
  if (justShipped) void sendOrderShipped(orderId);
  if (justDelivered) void sendOrderDelivered(orderId);

  // Delivery: commit reserved stock to a sale; capture COD.
  if (mapping.shipment === ShipmentStatus.DELIVERED) {
    for (const item of order.items) {
      if (item.variantId) await commitStock(item.variantId, item.quantity, orderId).catch(() => {});
    }
    if (order.paymentMethod === PaymentMethod.COD && order.paymentStatus !== PaymentStatus.CAPTURED) {
      // The cash balance still outstanding after any online COD token.
      const balance = new Decimal(order.grandTotal.toString()).minus(order.amountPaid.toString());
      await prisma.$transaction(async (tx) => {
        // Any still-pending COD payment row is now collected.
        await tx.payment.updateMany({ where: { orderId, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.CAPTURED, capturedAt: new Date() } });
        // Record the cash collected on delivery as its own payment for bookkeeping.
        if (balance.gt(0)) {
          await tx.payment.create({
            data: {
              orderId, provider: 'cod', method: PaymentMethod.COD, type: PaymentType.BALANCE,
              amount: balance.toFixed(2), currency: order.currency,
              status: PaymentStatus.CAPTURED, capturedAt: new Date(),
            },
          });
        }
        await tx.order.update({
          where: { id: orderId },
          data: { amountPaid: order.grandTotal, paymentStatus: PaymentStatus.CAPTURED, events: { create: { message: `COD collected on delivery (${balance.toFixed(2)})`, actor: source } } },
        });
      });
    }
  }

  // RTO: release the reserved inventory back.
  if (mapping.shipment === ShipmentStatus.RTO_INITIATED || mapping.shipment === ShipmentStatus.RTO_DELIVERED) {
    for (const item of order.items) {
      if (item.variantId) await releaseStock(item.variantId, item.quantity, orderId).catch(() => {});
    }
  }
}

/** Poll the courier for the latest tracking and apply it (admin refresh + cron). */
export async function refreshTracking(orderId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const order = await loadOrder(orderId);
  if (!order.shipment?.awb) return { ok: false, error: 'No AWB yet' };
  const provider = await getShippingProvider();
  const tracking = await provider.track(order.shipment.awb);
  await prisma.shipment.update({
    where: { id: order.shipment.id },
    data: { trackingUrl: tracking.trackingUrl ?? undefined, courier: tracking.courier ?? undefined, raw: tracking as unknown as object },
  });
  await applyShipmentStatus(orderId, tracking.rawStatus, 'tracking');
  return { ok: true, status: tracking.rawStatus };
}

export type { Order };
