import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient, ShipmentStatus } from '@prisma/client';

vi.mock('server-only', () => ({}));

/**
 * The AWB assignment path, end to end against the dev database.
 *
 * The defect was not in parsing alone — it was that a failed parse still wrote
 * a row. Proving that nothing is written needs a real row to not be written to,
 * so this talks to Postgres.
 *
 * Without one the tests mark themselves *skipped* rather than returning early
 * and reporting green. An early return would make a suite that proves nothing
 * indistinguishable from one that passed — which is the same shape of mistake
 * as the bug under test: a silent nothing wearing the appearance of a success.
 */

const prisma = new PrismaClient();
let dbAvailable = false;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
  process.env.SHIPROCKET_EMAIL = 'ops@example.com';
  process.env.SHIPROCKET_PASSWORD = 'right';
});

afterAll(async () => {
  delete process.env.SHIPROCKET_EMAIL;
  delete process.env.SHIPROCKET_PASSWORD;
  await prisma.$disconnect();
});

/** Answer the login, then hand back `reply` for everything else. */
function stubCourier(reply: unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/login')) return Response.json({ token: 'tok' });
    return Response.json(reply);
  }) as typeof fetch;
}

beforeEach(async () => {
  const mod = await import('@/lib/shipping/shiprocket');
  mod.resetShiprocketAuth();
});

afterEach(() => { globalThis.fetch = realFetch; });

/** An order with a created-but-unassigned shipment, as the live one was. */
async function makePendingShipment() {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-AWB-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'CONFIRMED', paymentStatus: 'CAPTURED', paymentMethod: 'RAZORPAY',
      contactName: 'Test', contactPhone: '9000000000',
      shippingAddress: { line1: 'A', city: 'Delhi', state: 'DL', pincode: '110001' },
      subtotal: 1000, discountTotal: 0, gstTotal: 0, shippingTotal: 0, grandTotal: 1000,
      shipment: { create: { provider: 'shiprocket', providerShipmentId: '67890', status: ShipmentStatus.PENDING } },
    },
    include: { shipment: true },
  });
  return order;
}

async function cleanup(orderId: string) {
  await prisma.orderEvent.deleteMany({ where: { orderId } });
  await prisma.shipment.deleteMany({ where: { orderId } });
  await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
}

describe('assigning an AWB', () => {
  const SHAPES: Array<[string, unknown]> = [
    ['nested under response.data', { response: { data: { awb_code: '14112366393092', courier_name: 'Xpressbees Surface' } } }],
    ['nested under data', { data: { awb_code: '14112366393092', courier_name: 'Xpressbees Surface' } }],
    ['at the top level', { awb: '14112366393092', courier: 'Xpressbees Surface' }],
  ];

  for (const [label, reply] of SHAPES) {
  it(`records the waybill when the reply is ${label}`, async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const order = await makePendingShipment();
    try {
      stubCourier(reply);
      const { assignAwbForOrder } = await import('@/lib/shipping/shipments');
      const res = await assignAwbForOrder(order.id);
      expect(res.ok).toBe(true);

      const saved = await prisma.shipment.findUnique({ where: { orderId: order.id } });
      expect(saved?.awb).toBe('14112366393092');
      expect(saved?.courier).toBe('Xpressbees Surface');
      expect(saved?.trackingUrl).toContain('14112366393092');

      const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
      const note = events.map((e) => e.message).join(' ');
      expect(note).toContain('14112366393092');
      expect(note).not.toContain('undefined');
    } finally {
      await cleanup(order.id);
    }
  });
  }

  it('writes nothing and leaves the shipment PENDING when no AWB comes back', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const order = await makePendingShipment();
    try {
      stubCourier({ awb_assign_status: 0, message: 'Courier not available for this pincode' });
      const { assignAwbForOrder } = await import('@/lib/shipping/shipments');
      const res = await assignAwbForOrder(order.id);

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/did not return an AWB/i);
      // The recovery instruction matters as much as the refusal: without it the
      // obvious next move is to create a second shipment for the same order.
      expect(res.error).toMatch(/Refresh from courier/i);

      const saved = await prisma.shipment.findUnique({ where: { orderId: order.id } });
      expect(saved?.status).toBe(ShipmentStatus.PENDING);
      expect(saved?.awb).toBeNull();
      expect(saved?.courier).toBeNull();

      // And no timeline entry announcing an assignment that never happened.
      const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
      expect(events.map((e) => e.message).join(' ')).not.toMatch(/AWB assigned/);
    } finally {
      await cleanup(order.id);
    }
  });

  it('repairs a mis-parsed assignment from the courier, without a second shipment', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const order = await makePendingShipment();
    try {
      // First the reply we cannot read: nothing recorded.
      stubCourier({ awb_assign_status: 0 });
      const { assignAwbForOrder, refreshFromCourier } = await import('@/lib/shipping/shipments');
      expect((await assignAwbForOrder(order.id)).ok).toBe(false);

      // Then the courier's own record, read back by shipment id.
      stubCourier({ tracking_data: { shipment_track: [{ awb_code: '14112366393092', courier_name: 'Xpressbees Surface', current_status: 'READY TO SHIP' }] } });
      const res = await refreshFromCourier(order.id);
      expect(res.ok).toBe(true);

      const saved = await prisma.shipment.findUnique({ where: { orderId: order.id } });
      expect(saved?.awb).toBe('14112366393092');
      expect(saved?.courier).toBe('Xpressbees Surface');

      // One shipment for the order, still — the repair must not duplicate it.
      expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(1);
    } finally {
      await cleanup(order.id);
    }
  });

  it('refuses to save a shipment the courier gave no reference for', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-NOREF-${Date.now()}`,
        status: 'CONFIRMED', paymentStatus: 'CAPTURED', paymentMethod: 'RAZORPAY',
        contactName: 'Test', contactPhone: '9000000000',
        shippingAddress: { line1: 'A', city: 'Delhi', state: 'DL', pincode: '110001' },
        subtotal: 1000, discountTotal: 0, gstTotal: 0, shippingTotal: 0, grandTotal: 1000,
      },
    });
    try {
      stubCourier({ message: 'Wrong pickup location' });
      const { createShipmentForOrder } = await import('@/lib/shipping/shipments');
      const res = await createShipmentForOrder(order.id);
      expect(res.ok).toBe(false);
      // A saved row would take the unique orderId and block every retry.
      expect(await prisma.shipment.count({ where: { orderId: order.id } })).toBe(0);
    } finally {
      await cleanup(order.id);
    }
  });
});
