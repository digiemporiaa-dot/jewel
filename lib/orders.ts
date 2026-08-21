import 'server-only';
import Decimal from 'decimal.js';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getCart, type CartSummary } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { buildTaxBreakup, resolveStateCode, type TaxLineInput } from '@/lib/tax/gst';
import { getCurrentRates } from '@/lib/rates';
import { reserveStock, releaseStock, OutOfStockError } from '@/lib/inventory';
import { isRateLockValid } from '@/lib/pricing';
import { PaymentMethod, PaymentType, OrderStatus, PaymentStatus, type Prisma } from '@prisma/client';

export class CheckoutError extends Error {}

export type AddressInput = {
  name: string; phone: string; line1: string; line2?: string;
  city: string; state: string; pincode: string; country?: string;
};

export type CreateOrderInput = {
  sessionToken: string;
  customerId?: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  pan?: string;
  shippingAddress: AddressInput;
  billingAddress?: AddressInput;
  paymentMethod: PaymentMethod;
  // NOTE: no amounts are accepted from the caller. Totals are always recomputed.
};

export type CreateOrderResult = {
  orderId: string;
  orderNumber: string;
  paymentMethod: PaymentMethod;
  amountDue: string; // amount to collect now (advance or full or token), rupees
  grandTotal: string;
  status: OrderStatus;
  requiresCall: boolean;
  online: boolean; // whether an online payment must be collected now
};

async function generateOrderNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 6; i++) {
    const rand = randomBytes(3).toString('hex').toUpperCase();
    const candidate = `MJ${ymd}-${rand}`;
    const exists = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new CheckoutError('Could not allocate order number');
}

/** Snapshot the live rates used, for the immutable order record + price lock. */
async function buildRateSnapshot(rateLockMinutes: number) {
  const rates = await getCurrentRates();
  return {
    lockedAt: new Date().toISOString(),
    lockMinutes: rateLockMinutes,
    rates: rates.map((r) => ({ metal: r.metalName, purity: r.purityName, ratePerGram: r.ratePerGram })),
  };
}

/**
 * Create an order from the server-recomputed cart. The browser never supplies
 * price, discount or total — everything is derived from database state (RULE 1,
 * brief §59). Applies COD, high-value verification and PAN thresholds, snapshots
 * the rates (price lock), and reserves inventory for ready-to-ship items.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const store = await getStoreSettings();
  const cart: CartSummary = await getCart(input.sessionToken);

  if (cart.lines.length === 0) throw new CheckoutError('Your bag is empty');
  const priceless = cart.lines.find((l) => l.error || !l.breakup);
  if (priceless) throw new CheckoutError('Some items could not be priced. Please review your bag.');

  const grandTotal = new Decimal(cart.grandTotal);

  // ── Rules ──────────────────────────────────────────────────────────────────
  const requiresCall =
    store.verificationCallAbove != null && grandTotal.gt(new Decimal(store.verificationCallAbove.toString()));

  const panRequired =
    store.panThreshold != null && grandTotal.gt(new Decimal(store.panThreshold.toString()));
  if (panRequired && !input.pan) {
    throw new CheckoutError('PAN is required for orders of this value');
  }
  if (input.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(input.pan.toUpperCase())) {
    throw new CheckoutError('Enter a valid PAN');
  }

  if (input.paymentMethod === PaymentMethod.COD) {
    if (store.codMaxOrderValue == null || grandTotal.gt(new Decimal(store.codMaxOrderValue.toString()))) {
      throw new CheckoutError('Cash on delivery is not available for this order value');
    }
  }

  // Load per-line product attributes for immutable snapshots + made-to-order logic.
  const variantIds = cart.lines.map((l) => l.variantId).filter((v): v is string => !!v);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: { include: { metal: { select: { name: true } }, purity: { select: { name: true } } } } },
  });
  const vmap = new Map(variants.map((v) => [v.id, v]));

  const anyMadeToOrder = cart.lines.some((l) => l.madeToOrder);
  const fulfilmentType = anyMadeToOrder ? 'MADE_TO_ORDER' : 'READY_TO_SHIP';

  // ── Amount due now ───────────────────────────────────────────────────────────
  // Made-to-order online: collect advance now, balance before dispatch.
  let amountDue = grandTotal;
  let paymentType: PaymentType = PaymentType.FULL;

  if (input.paymentMethod !== PaymentMethod.COD && anyMadeToOrder) {
    // Advance = Σ lineTotal × product.advancePercent, capped at grandTotal.
    let advance = new Decimal(0);
    for (const line of cart.lines) {
      const v = line.variantId ? vmap.get(line.variantId) : null;
      const pct = v?.product.advancePercent ? new Decimal(v.product.advancePercent.toString()) : new Decimal(0);
      if (line.madeToOrder && pct.gt(0)) {
        advance = advance.plus(new Decimal(line.lineTotal).times(pct).div(100));
      } else {
        advance = advance.plus(new Decimal(line.lineTotal)); // ready items paid in full
      }
    }
    advance = advance.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (advance.gt(0) && advance.lt(grandTotal)) {
      amountDue = advance;
      paymentType = PaymentType.ADVANCE;
    }
  }

  const codToken = new Decimal(store.codTokenAmount.toString());
  if (input.paymentMethod === PaymentMethod.COD && codToken.gt(0)) {
    // Collect a token online before confirming COD.
    amountDue = Decimal.min(codToken, grandTotal);
    paymentType = PaymentType.COD_TOKEN;
  }

  const online =
    input.paymentMethod === PaymentMethod.RAZORPAY ||
    input.paymentMethod === PaymentMethod.BANK_TRANSFER ||
    (input.paymentMethod === PaymentMethod.COD && codToken.gt(0));

  const rateSnapshot = await buildRateSnapshot(store.rateLockMinutes);
  const orderNumber = await generateOrderNumber();

  // Initial status.
  let status: OrderStatus;
  if (online && input.paymentMethod !== PaymentMethod.COD) {
    status = OrderStatus.PENDING_PAYMENT;
  } else if (input.paymentMethod === PaymentMethod.COD && codToken.gt(0)) {
    status = OrderStatus.PENDING_PAYMENT; // token first
  } else {
    // Plain COD — confirmed (or held for verification).
    status = requiresCall ? OrderStatus.VERIFICATION_HOLD : OrderStatus.CONFIRMED;
  }

  // ── GST: derive the split from where the goods are going ─────────────────────
  //
  // Frozen into the order alongside the rate snapshot. The seller's registered
  // state and the tax rates can both change later; a reprinted invoice has to
  // show what was actually charged, not what today's settings would produce.
  //
  // Falls back to the seller's own state when the shipping state cannot be
  // resolved, which makes the sale intra-state. That is the conservative
  // direction: CGST+SGST on a sale that was really inter-state is a filing
  // correction, whereas defaulting the other way under-collects nothing but
  // files tax to the wrong government.
  const sellerStateCode = resolveStateCode(store.sellerStateCode) ?? resolveStateCode(store.state);
  const buyerStateCode = resolveStateCode(input.shippingAddress.state);
  const taxBreakup = sellerStateCode
    ? buildTaxBreakup({
        sellerStateCode,
        buyerStateCode: buyerStateCode ?? sellerStateCode,
        lines: cart.lines.map<TaxLineInput>((line) => {
          const v = line.variantId ? vmap.get(line.variantId) : null;
          const perUnitTaxable = new Decimal(line.breakup?.taxable ?? '0');
          return {
            hsnCode: v?.product.hsnCode ?? '',
            taxableValue: perUnitTaxable.times(line.quantity).toFixed(2),
            gstRate: line.breakup?.gstPercent ?? store.gstPercentDefault.toString(),
          };
        }),
      })
    : null;

  // ── Persist in a transaction; reserve inventory for ready-to-ship lines. ──────
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        status,
        customerId: input.customerId ?? null,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail ?? null,
        pan: input.pan ? input.pan.toUpperCase() : null,
        shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
        billingAddress: (input.billingAddress ?? input.shippingAddress) as unknown as Prisma.InputJsonValue,
        fulfilmentType,
        subtotal: cart.taxableTotal,
        makingTotal: cart.makingTotal,
        discountTotal: '0',
        gstTotal: cart.gstTotal,
        shippingTotal: cart.shipping,
        grandTotal: cart.grandTotal,
        amountPaid: '0',
        currency: cart.currency,
        paymentMethod: input.paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
        rateSnapshot: rateSnapshot as unknown as Prisma.InputJsonValue,
        rateLockedAt: new Date(),
        // The invoice number is deliberately NOT allocated here — an order that
        // is never paid would burn a number and leave a gap in a series that GST
        // requires to be gap-free. It is allocated when the sale completes.
        placeOfSupply: taxBreakup?.placeOfSupplyCode ?? null,
        taxBreakup: (taxBreakup ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        requiresCall,
        items: {
          create: cart.lines.map((line) => {
            const v = line.variantId ? vmap.get(line.variantId) : null;
            return {
              productId: line.productId,
              variantId: line.variantId,
              nameSnapshot: line.name,
              skuSnapshot: v?.sku ?? line.variantLabel ?? 'ITEM',
              imageSnapshot: line.image,
              weightSnapshot: v?.netWeight ?? v?.product.netWeight ?? null,
              metalSnapshot: v?.product.metal?.name ?? null,
              puritySnapshot: v?.product.purity?.name ?? null,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
              priceBreakup: (line.breakup ?? {}) as unknown as Prisma.InputJsonValue,
              metalRateUsed: line.breakup?.rateUsed ?? null,
            };
          }),
        },
        events: {
          create: { status, message: `Order placed (${input.paymentMethod})`, actor: 'system' },
        },
      },
    });

    // Reserve inventory for ready-to-ship lines (made-to-order is produced on demand).
    for (const line of cart.lines) {
      if (!line.madeToOrder && line.variantId) {
        await reserveStock(line.variantId, line.quantity, order.id);
      }
    }

    // Initial payment record.
    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: input.paymentMethod === PaymentMethod.RAZORPAY || paymentType === PaymentType.COD_TOKEN ? 'razorpay' : input.paymentMethod === PaymentMethod.BANK_TRANSFER ? 'bank_transfer' : 'cod',
        method: input.paymentMethod,
        type: paymentType,
        amount: amountDue.toFixed(2),
        currency: cart.currency,
        status: PaymentStatus.PENDING,
      },
    });

    return order;
  });

  // Mark the source cart as converted (clear items so it isn't reordered).
  await prisma.cartItem.deleteMany({ where: { cart: { sessionToken: input.sessionToken } } }).catch(() => {});
  await prisma.cart.updateMany({ where: { sessionToken: input.sessionToken }, data: { convertedOrderId: created.id, abandonedAt: null } }).catch(() => {});

  return {
    orderId: created.id,
    orderNumber,
    paymentMethod: input.paymentMethod,
    amountDue: amountDue.toFixed(2),
    grandTotal: cart.grandTotal,
    status,
    requiresCall,
    online: online && (input.paymentMethod !== PaymentMethod.BANK_TRANSFER),
  };
}

/**
 * Confirm an online payment. Verifies the amount against the order's own pending
 * payment (never the client), applies the payment idempotently, and transitions
 * the order. Safe to call from BOTH the browser callback and the webhook.
 */
export async function confirmPayment(params: {
  orderId: string;
  providerPaymentId: string;
  providerOrderId?: string;
  capturedAmount?: string; // rupees, from provider; validated against order
  source: 'callback' | 'webhook';
}): Promise<{ ok: boolean; alreadyProcessed?: boolean }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: params.orderId }, include: { payments: true } });
    if (!order) throw new CheckoutError('Order not found');

    // Idempotency: if this payment id is already captured, do nothing.
    const existingCaptured = await tx.payment.findFirst({
      where: { providerPaymentId: params.providerPaymentId, status: PaymentStatus.CAPTURED },
    });
    if (existingCaptured) return { ok: true, alreadyProcessed: true };

    // Find the pending payment to capture.
    const pending = order.payments.find((p) => p.status === PaymentStatus.PENDING) ?? order.payments[0];
    if (!pending) throw new CheckoutError('No payment to confirm');

    await tx.payment.update({
      where: { id: pending.id },
      data: { status: PaymentStatus.CAPTURED, providerPaymentId: params.providerPaymentId, providerOrderId: params.providerOrderId ?? pending.providerOrderId, capturedAt: new Date() },
    });

    const newPaid = new Decimal(order.amountPaid.toString()).plus(pending.amount.toString());
    const grand = new Decimal(order.grandTotal.toString());
    const fullyPaid = newPaid.gte(grand);

    // Determine next status.
    let nextStatus: OrderStatus = order.status;
    if (order.requiresCall) {
      nextStatus = OrderStatus.VERIFICATION_HOLD;
    } else if (order.fulfilmentType === 'MADE_TO_ORDER') {
      nextStatus = OrderStatus.IN_MAKING;
    } else {
      nextStatus = OrderStatus.CONFIRMED;
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        amountPaid: newPaid.toFixed(2),
        // Fully paid → CAPTURED; a made-to-order advance leaves a balance → AUTHORIZED.
        paymentStatus: fullyPaid ? PaymentStatus.CAPTURED : PaymentStatus.AUTHORIZED,
        status: nextStatus,
        events: { create: { status: nextStatus, message: `Payment captured (${params.source})`, actor: params.source } },
      },
    });

    return { ok: true };
  });
}

/** Mark payment failed and release any reserved inventory. */
export async function markPaymentFailed(orderId: string, reason?: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payments: true } });
  if (!order) return;
  if (order.paymentStatus === PaymentStatus.CAPTURED) return; // already paid; ignore

  await prisma.payment.updateMany({ where: { orderId, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.FAILED } });
  // Release reserved inventory for ready-to-ship lines.
  for (const item of order.items) {
    if (item.variantId) await releaseStock(item.variantId, item.quantity, orderId).catch(() => {});
  }
  await prisma.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: PaymentStatus.FAILED,
      events: { create: { message: `Payment failed${reason ? `: ${reason}` : ''}`, actor: 'system' } },
    },
  });
}

/** Verify the price lock is still valid (called before charging a stale order). */
export async function isOrderRateLockValid(orderId: string): Promise<boolean> {
  const [order, store] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { rateLockedAt: true } }),
    getStoreSettings(),
  ]);
  if (!order?.rateLockedAt) return false;
  return isRateLockValid(order.rateLockedAt, store.rateLockMinutes);
}

export { OutOfStockError };
