import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The bag is emptied when the order becomes real — never when it is created.
 *
 * This was a live revenue leak: `createOrder` deleted the cart items the moment
 * the order row existed, while the order was still PENDING_PAYMENT. A shopper
 * who dismissed the Razorpay window, pressed back, lost their connection or had
 * a card declined came back to an empty bag with nothing to retry, and a
 * ₹70,000 basket does not get rebuilt from memory.
 *
 * The guarantees under test are about ordering and control flow in our own code
 * — what has happened to the cart at each point in the payment lifecycle — so a
 * small in-memory database is the right instrument. (The suites that assert a
 * *database* guarantee, like a conditional UPDATE under concurrency, talk to
 * Postgres instead, because a fake would prove nothing there.)
 */

type CartRow = { id: string; sessionToken: string | null; convertedOrderId: string | null; abandonedAt: Date | null };
type CartItemRow = { id: string; cartId: string; addedAt: Date };
type PaymentRow = {
  id: string; orderId: string; status: string; amount: string;
  providerPaymentId: string | null; providerOrderId: string | null; capturedAt: Date | null;
};
type OrderRow = {
  id: string; sessionToken: string | null; placedAt: Date; status: string; paymentStatus: string;
  amountPaid: string; grandTotal: string; requiresCall: boolean; fulfilmentType: string;
};

const { db, fakePrisma } = vi.hoisted(() => {
  const db = {
    carts: [] as CartRow[],
    cartItems: [] as CartItemRow[],
    orders: [] as OrderRow[],
    payments: [] as PaymentRow[],
    events: [] as { orderId: string; message: string }[],
  };

  /** Just the operations the code under test actually issues. */
  const client = {
    order: {
      findUnique: async ({ where, include }: { where: { id: string }; include?: { payments?: boolean } }) => {
        const order = db.orders.find((o) => o.id === where.id);
        if (!order) return null;
        return include?.payments ? { ...order, payments: db.payments.filter((p) => p.orderId === order.id) } : { ...order };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const order = db.orders.find((o) => o.id === where.id);
        if (!order) throw new Error('no such order');
        const { events, ...fields } = data as { events?: { create: { message: string } } };
        if (events?.create) db.events.push({ orderId: order.id, message: events.create.message });
        Object.assign(order, fields);
        return { ...order };
      },
    },
    payment: {
      findFirst: async ({ where }: { where: { providerPaymentId?: string; status?: string } }) =>
        db.payments.find(
          (p) =>
            (where.providerPaymentId === undefined || p.providerPaymentId === where.providerPaymentId) &&
            (where.status === undefined || p.status === where.status)
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const payment = db.payments.find((p) => p.id === where.id);
        if (!payment) throw new Error('no such payment');
        Object.assign(payment, data);
        return { ...payment };
      },
    },
    cartItem: {
      deleteMany: async ({ where }: { where: { cart?: { sessionToken?: string }; addedAt?: { lt: Date } } }) => {
        const cartIds = db.carts
          .filter((c) => where.cart?.sessionToken === undefined || c.sessionToken === where.cart.sessionToken)
          .map((c) => c.id);
        const doomed = db.cartItems.filter(
          (i) => cartIds.includes(i.cartId) && (!where.addedAt || i.addedAt < where.addedAt.lt)
        );
        db.cartItems = db.cartItems.filter((i) => !doomed.includes(i));
        return { count: doomed.length };
      },
    },
    cart: {
      updateMany: async ({ where, data }: { where: { sessionToken?: string }; data: Partial<CartRow> }) => {
        const hit = db.carts.filter((c) => where.sessionToken === undefined || c.sessionToken === where.sessionToken);
        for (const cart of hit) Object.assign(cart, data);
        return { count: hit.length };
      },
    },
  };

  const fakePrisma = {
    ...client,
    // Everything the code under test does inside a transaction it does through
    // the same handles, so the "transaction" is the client itself.
    $transaction: async <T,>(fn: (tx: typeof client) => Promise<T>): Promise<T> => fn(client),
  };

  return { db, fakePrisma };
});

vi.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

const { confirmPayment, ensureCartClearedForOrder } = await import('@/lib/orders');
const { clearConvertedCart } = await import('@/lib/cart');

const SESSION = 'sid-shopper';
const PLACED_AT = new Date('2026-08-31T10:00:00.000Z');

/** A bag with two pieces in it, and the order just written from it. */
function scenario(order: Partial<OrderRow> = {}, payment: Partial<PaymentRow> = {}) {
  db.carts = [{ id: 'cart1', sessionToken: SESSION, convertedOrderId: null, abandonedAt: null }];
  db.cartItems = [
    { id: 'item1', cartId: 'cart1', addedAt: new Date('2026-08-31T09:40:00.000Z') },
    { id: 'item2', cartId: 'cart1', addedAt: new Date('2026-08-31T09:50:00.000Z') },
  ];
  db.orders = [
    {
      id: 'order1', sessionToken: SESSION, placedAt: PLACED_AT,
      status: 'PENDING_PAYMENT', paymentStatus: 'PENDING',
      amountPaid: '0', grandTotal: '70000.00', requiresCall: false, fulfilmentType: 'READY_TO_SHIP',
      ...order,
    },
  ];
  db.payments = [
    {
      id: 'pay1', orderId: 'order1', status: 'PENDING', amount: '70000.00',
      providerPaymentId: null, providerOrderId: 'order_rzp_1', capturedAt: null,
      ...payment,
    },
  ];
  db.events = [];
}

const bag = () => db.cartItems.map((i) => i.id);
const cart = () => db.carts[0]!;

beforeEach(() => scenario());

describe('an order that has been created but not paid', () => {
  it('leaves the bag exactly as it was', () => {
    // Nothing has confirmed anything: this is the state `createOrder` leaves
    // behind for an online order, and the whole basket is still there.
    expect(bag()).toEqual(['item1', 'item2']);
    expect(cart().convertedOrderId).toBeNull();
  });

  it('survives the shopper closing the payment window and coming back', async () => {
    // Reopening the order page is what a shopper does after dismissing the
    // gateway. The backstop that empties a paid order's bag must not touch this
    // one — the items are what they will pay with on the second attempt.
    await ensureCartClearedForOrder('order1');
    expect(bag()).toEqual(['item1', 'item2']);
  });

  it('survives a failed payment, which is the case most worth retrying', async () => {
    db.orders[0]!.paymentStatus = 'FAILED';
    db.payments[0]!.status = 'FAILED';
    await ensureCartClearedForOrder('order1');
    expect(bag()).toEqual(['item1', 'item2']);
  });
});

describe('payment.captured', () => {
  it('empties the bag and marks it converted, in the same breath as the status', async () => {
    const res = await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });

    expect(res).toEqual({ ok: true });
    expect(db.orders[0]!.status).toBe('CONFIRMED');
    expect(db.orders[0]!.paymentStatus).toBe('CAPTURED');
    expect(bag()).toEqual([]);
    expect(cart().convertedOrderId).toBe('order1');
    // A bag that reached a paid order is not one to chase with a reminder.
    expect(cart().abandonedAt).toBeNull();
  });

  it('empties it on a made-to-order advance too, balance owing or not', async () => {
    scenario({ fulfilmentType: 'MADE_TO_ORDER' }, { amount: '20000.00' });

    await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });

    expect(db.orders[0]!.status).toBe('IN_MAKING');
    expect(db.orders[0]!.paymentStatus).toBe('AUTHORIZED'); // ₹50,000 still to come
    expect(bag()).toEqual([]);
  });

  it('is a no-op when the same capture is delivered twice', async () => {
    await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });
    const paidAfterFirst = db.orders[0]!.amountPaid;

    const second = await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });

    expect(second).toEqual({ ok: true, alreadyProcessed: true });
    // The redelivery must not take the money twice, capture a second payment,
    // or fail because the cart it would clear is already clear.
    expect(db.orders[0]!.amountPaid).toBe(paidAfterFirst);
    expect(db.payments.filter((p) => p.status === 'CAPTURED')).toHaveLength(1);
    expect(bag()).toEqual([]);
    expect(cart().convertedOrderId).toBe('order1');
  });

  it('still empties a bag whose first clear was lost', async () => {
    // The capture landed but the clear did not — a browser callback that raced
    // the webhook and died between the two. The redelivery is the second chance.
    db.payments[0]!.status = 'CAPTURED';
    db.payments[0]!.providerPaymentId = 'pay_rzp_1';
    db.orders[0]!.status = 'CONFIRMED';
    db.orders[0]!.paymentStatus = 'CAPTURED';

    const res = await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });

    expect(res).toEqual({ ok: true, alreadyProcessed: true });
    expect(bag()).toEqual([]);
  });
});

describe('an order confirmed without an online payment', () => {
  it('empties the bag — a cash-on-delivery order is placed, not pending', async () => {
    scenario({ status: 'CONFIRMED', paymentStatus: 'PENDING' });
    await ensureCartClearedForOrder('order1');
    expect(bag()).toEqual([]);
    expect(cart().convertedOrderId).toBe('order1');
  });

  it('empties it for a high-value order held for a verification call', async () => {
    scenario({ status: 'VERIFICATION_HOLD', paymentStatus: 'PENDING' });
    await ensureCartClearedForOrder('order1');
    expect(bag()).toEqual([]);
  });

  it('leaves it alone when the order was cancelled instead', async () => {
    scenario({ status: 'CANCELLED', paymentStatus: 'PENDING' });
    await ensureCartClearedForOrder('order1');
    expect(bag()).toEqual(['item1', 'item2']);
  });
});

describe('clearing a bag that has moved on', () => {
  it('never touches items added after the order was placed', async () => {
    // Bank transfers are confirmed by hand, sometimes the next day, and webhooks
    // are redelivered. By then the shopper may have started a new bag in the
    // same session — emptying that would be this exact bug all over again.
    db.cartItems.push({ id: 'item3', cartId: 'cart1', addedAt: new Date('2026-08-31T14:00:00.000Z') });

    await confirmPayment({ orderId: 'order1', providerPaymentId: 'pay_rzp_1', source: 'webhook' });

    expect(bag()).toEqual(['item3']);
  });

  it('runs clean a second time on an already-empty cart', async () => {
    await clearConvertedCart(fakePrisma, { sessionToken: SESSION, orderId: 'order1', placedAt: PLACED_AT });
    await expect(
      clearConvertedCart(fakePrisma, { sessionToken: SESSION, orderId: 'order1', placedAt: PLACED_AT })
    ).resolves.toBeUndefined();
    expect(bag()).toEqual([]);
  });

  it('does nothing for an order with no browser session behind it', async () => {
    await clearConvertedCart(fakePrisma, { sessionToken: null, orderId: 'order1', placedAt: PLACED_AT });
    expect(bag()).toEqual(['item1', 'item2']);
    expect(cart().convertedOrderId).toBeNull();
  });
});
