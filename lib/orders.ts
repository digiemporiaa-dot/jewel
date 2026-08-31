import 'server-only';
import Decimal from 'decimal.js';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getCart, clearConvertedCart, type CartSummary } from '@/lib/cart';
import { getStoreSettings } from '@/lib/store';
import { buildTaxBreakup, resolveStateCode, type TaxLineInput } from '@/lib/tax/gst';
import { evaluateCoupon, claimCouponUse, applyDiscountToTotals } from '@/lib/coupons/apply';
import { getCurrentRates } from '@/lib/rates';
import { reserveStock, releaseStock, OutOfStockError } from '@/lib/inventory';
import { isRateLockValid } from '@/lib/pricing';
import { createRazorpayOrder, isDevMode } from '@/lib/payments/razorpay';
import { awaitsGatewayPayment, orderIsPlaced } from '@/lib/checkout/cart-clearing';
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
  /** A code only — never a discount amount. The server decides what it is worth. */
  couponCode?: string | null;
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

  // ── Coupon ───────────────────────────────────────────────────────────────────
  //
  // Re-validated here even though the checkout page already checked it: rates
  // move, carts sit open for hours, and another shopper may have taken the last
  // use in between. The browser sends a code and nothing else — a client-supplied
  // discount is the same class of bug as a client-supplied price (RULE 1).
  //
  // The claim itself happens inside the transaction below; this is the read that
  // decides whether the order can proceed at all.
  const couponResult = input.couponCode
    ? await evaluateCoupon({ code: input.couponCode, cart, customerId: input.customerId ?? null })
    : null;
  if (input.couponCode && couponResult && !couponResult.ok) {
    throw new CheckoutError(couponResult.error);
  }
  const couponCalc = couponResult?.ok ? couponResult.calculation : null;
  const totals = applyDiscountToTotals(cart, couponCalc);

  // Thresholds are measured against what the customer actually pays, so a
  // coupon can move an order below the COD ceiling or the verification limit.
  const grandTotal = new Decimal(totals.grandTotal);

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

  // This, not `online`, decides whether the bag survives checkout: a bank
  // transfer is `online` because the money arrives outside the shop, but nothing
  // opens a payment window for it. The rule itself lives in one place.
  const awaitingGatewayPayment = awaitsGatewayPayment({
    paymentMethod: input.paymentMethod,
    codTokenRequired: codToken.gt(0),
  });

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
          // Net of any coupon: GST is charged on the discounted value, so the
          // invoice's tax must be computed from the same base.
          const lineDiscount = new Decimal(
            couponCalc?.perLine.find((l) => l.itemId === line.itemId)?.discount ?? '0'
          );
          return {
            hsnCode: v?.product.hsnCode ?? '',
            taxableValue: Decimal.max(perUnitTaxable.times(line.quantity).minus(lineDiscount), 0).toFixed(2),
            gstRate: line.breakup?.gstPercent ?? store.gstPercentDefault.toString(),
          };
        }),
      })
    : null;

  // ── Persist in a transaction; reserve inventory for ready-to-ship lines. ──────
  const created = await prisma.$transaction(async (tx) => {
    // Claim the redemption first. Two shoppers taking the last use of a code at
    // the same moment must not both succeed — at these order values one leaked
    // redemption is a ₹50,000 mistake. Failing here aborts the whole
    // transaction, so no order exists claiming a discount the store refused.
    if (couponResult?.ok) {
      const claimed = await claimCouponUse(tx, couponResult.couponId);
      if (!claimed) {
        throw new CheckoutError('That code was fully redeemed while you were checking out');
      }
    }

    const order = await tx.order.create({
      data: {
        orderNumber,
        status,
        customerId: input.customerId ?? null,
        // Remembered so the bag can be emptied later, when the order becomes
        // real — which may be a webhook minutes after this request has ended.
        sessionToken: input.sessionToken,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail ?? null,
        pan: input.pan ? input.pan.toUpperCase() : null,
        shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
        billingAddress: (input.billingAddress ?? input.shippingAddress) as unknown as Prisma.InputJsonValue,
        fulfilmentType,
        subtotal: totals.taxableTotal,
        makingTotal: cart.makingTotal,
        discountTotal: totals.discountTotal,
        gstTotal: totals.gstTotal,
        shippingTotal: totals.shipping,
        grandTotal: totals.grandTotal,
        couponId: couponResult?.ok ? couponResult.couponId : null,
        couponCode: couponResult?.ok ? couponResult.code : null,
        amountPaid: '0',
        currency: cart.currency,
        paymentMethod: input.paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
        rateSnapshot: {
          ...rateSnapshot,
          // Frozen alongside the rates: what the coupon was worth, on which
          // component, and against which lines. A later change to the coupon
          // must not alter what this order was charged.
          coupon: couponCalc
            ? {
                code: couponResult?.ok ? couponResult.code : null,
                appliesTo: couponCalc.appliesTo,
                discountTotal: couponCalc.discountTotal,
                eligibleBase: couponCalc.eligibleBase,
                freeShipping: couponCalc.freeShipping,
                perLine: couponCalc.perLine,
              }
            : null,
        } as unknown as Prisma.InputJsonValue,
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

    // The bag is emptied here only for orders that are placed outright: plain
    // COD, and a bank transfer the customer is now asked to make. Everything
    // else leaves checkout in PENDING_PAYMENT with a gateway still to face, and
    // its bag stays exactly as it was — `confirmPayment` empties it when the
    // money actually arrives. Emptying it here was a direct revenue loss: a
    // dismissed payment window returned the shopper to nothing, and a
    // ₹70,000 bag does not get rebuilt from memory.
    //
    // Inside the transaction, alongside the status it belongs to, so an order
    // that fails to be written cannot take a cart with it.
    if (!awaitingGatewayPayment) {
      await clearConvertedCart(tx, { sessionToken: input.sessionToken, orderId: order.id, placedAt: order.placedAt });
    }

    return order;
  });

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
  /**
   * The gateway's own payment entity, stored verbatim on the payment row.
   *
   * A chargeback arrives months later and is argued from the gateway's record
   * of what happened — the method, the card network, the acquirer reference.
   * `WebhookEvent` keeps the envelope, but that is keyed by event and is pruned
   * by event age; this is the copy attached to the payment being disputed.
   * Never read back as trusted input: every amount and status decision below
   * comes from our own rows.
   */
  rawPayload?: unknown;
}): Promise<{ ok: boolean; alreadyProcessed?: boolean }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: params.orderId }, include: { payments: true } });
    if (!order) throw new CheckoutError('Order not found');

    // Idempotency: if this payment id is already captured, do nothing.
    const existingCaptured = await tx.payment.findFirst({
      where: { providerPaymentId: params.providerPaymentId, status: PaymentStatus.CAPTURED },
    });
    if (existingCaptured) {
      // Nothing to transition — but the clear is repeated rather than skipped.
      // A redelivered webhook is the second chance to empty a bag whose first
      // clear was lost (a browser callback that raced this one and crashed
      // after capturing, say), and repeating it costs one no-op statement.
      await clearConvertedCart(tx, { sessionToken: order.sessionToken, orderId: order.id, placedAt: order.placedAt });
      return { ok: true, alreadyProcessed: true };
    }

    // Find the pending payment to capture.
    const pending = order.payments.find((p) => p.status === PaymentStatus.PENDING) ?? order.payments[0];
    if (!pending) throw new CheckoutError('No payment to confirm');

    await tx.payment.update({
      where: { id: pending.id },
      data: {
        status: PaymentStatus.CAPTURED,
        providerPaymentId: params.providerPaymentId,
        providerOrderId: params.providerOrderId ?? pending.providerOrderId,
        capturedAt: new Date(),
        ...(params.rawPayload !== undefined
          ? { rawPayload: params.rawPayload as Prisma.InputJsonValue }
          : {}),
      },
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

    // The order is now real, so the bag it came from goes — in this transaction,
    // immediately after the status that made it real, so the two can never
    // disagree. A made-to-order advance counts: the balance is owed on an order
    // that is being made, not on a bag the shopper could check out a second time.
    await clearConvertedCart(tx, { sessionToken: order.sessionToken, orderId: order.id, placedAt: order.placedAt });

    return { ok: true };
  });
}

/**
 * Backstop: make sure a placed order's bag really did get emptied.
 *
 * The webhook is the primary path and the COD/bank paths clear inside their own
 * transaction, so this normally finds nothing to do. It exists for the opposite
 * failure to the one this change is about: a paid order whose cart was never
 * cleared leaves the shopper able to check the same ₹70,000 basket out twice.
 * Webhooks get lost, and the confirmation page is the one screen every paid
 * order passes through.
 *
 * Keyed by the order's own `sessionToken`, and bounded by its `placedAt`, so it
 * can never reach a bag the shopper has started since.
 */
export async function ensureCartClearedForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, sessionToken: true, placedAt: true, status: true, paymentStatus: true },
  });
  if (!order?.sessionToken) return;
  if (!orderIsPlaced(order)) return;

  await clearConvertedCart(prisma, { sessionToken: order.sessionToken, orderId: order.id, placedAt: order.placedAt });
}

/**
 * Reopen the gateway for an order that is still waiting to be paid.
 *
 * The bug this exists for: a shopper dismisses the Razorpay window, comes back,
 * and pays for the same bag again — leaving the shop with two orders, two
 * reservations and one customer. So this never creates an order. It finds the
 * one that is already sitting in PENDING_PAYMENT and hands back the gateway
 * order to reopen, reusing the provider order id where one was already
 * allocated so even the gateway sees a single attempt being retried.
 *
 * Ownership is the caller's to check — this is the money path, and the caller
 * is the one holding the session.
 */
export async function resumeOrderPayment(orderId: string): Promise<
  | { ok: true; orderNumber: string; amountDue: string; providerOrderId: string; amountPaise: number; dev: boolean }
  | { ok: false; error: string }
> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, payments: { orderBy: { createdAt: 'desc' } } },
  });
  if (!order) return { ok: false, error: 'Order not found' };

  if (order.paymentStatus === PaymentStatus.CAPTURED || order.paymentStatus === PaymentStatus.AUTHORIZED) {
    return { ok: false, error: 'This order has already been paid' };
  }
  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    return { ok: false, error: 'This order is no longer awaiting payment' };
  }
  if (order.paymentMethod === PaymentMethod.BANK_TRANSFER) {
    return { ok: false, error: 'This order is being paid by bank transfer' };
  }

  // The payment to retry: the one still pending, or the one that failed.
  let payment = order.payments.find((p) => p.status === PaymentStatus.PENDING) ?? null;
  const failed = order.payments.find((p) => p.status === PaymentStatus.FAILED) ?? null;
  if (!payment && !failed) return { ok: false, error: 'No payment to complete' };
  if ((payment ?? failed)?.provider !== 'razorpay') {
    return { ok: false, error: 'This order is not paid online' };
  }

  if (!payment && failed) {
    // A failed attempt released the order's reserved stock (see
    // `markPaymentFailed`), so retrying has to take it back before promising the
    // gateway anything — otherwise a successful retry confirms an order with
    // nothing held for it. Reserving first also means a shopper whose ring sold
    // out in the meantime is told so here, rather than after paying.
    const reserved: { variantId: string; quantity: number }[] = [];
    try {
      for (const item of order.items) {
        if (!item.variantId) continue;
        // Made-to-order lines are produced on demand and were never reserved.
        const variant = await prisma.productVariant.findUnique({
          where: { id: item.variantId },
          select: { product: { select: { fulfilmentType: true } } },
        });
        if (variant?.product.fulfilmentType === 'MADE_TO_ORDER') continue;
        await reserveStock(item.variantId, item.quantity, order.id);
        reserved.push({ variantId: item.variantId, quantity: item.quantity });
      }
    } catch (e) {
      // All or nothing: a half-reserved retry would hold stock for an order
      // nobody can pay for.
      for (const r of reserved) await releaseStock(r.variantId, r.quantity, order.id).catch(() => {});
      if (e instanceof OutOfStockError) {
        return { ok: false, error: 'Something in this order is no longer in stock. Please contact us.' };
      }
      throw e;
    }

    payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: failed.provider,
        method: failed.method,
        type: failed.type,
        amount: failed.amount,
        currency: failed.currency,
        status: PaymentStatus.PENDING,
      },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.PENDING,
        events: { create: { message: 'Payment retried by customer', actor: 'customer' } },
      },
    });
  }

  if (!payment) return { ok: false, error: 'No payment to complete' };

  const amountDue = new Decimal(payment.amount.toString()).toFixed(2);

  // Reuse the gateway order where one exists. Razorpay keeps an unpaid order
  // open, so retrying against the same id is one attempt continuing — a fresh
  // id every time would scatter a single basket across several gateway orders
  // and make the reconciliation report lie.
  let providerOrderId = payment.providerOrderId;
  if (!providerOrderId) {
    const rzp = await createRazorpayOrder({
      amount: amountDue,
      currency: payment.currency,
      receipt: order.orderNumber,
      notes: { orderId: order.id },
    });
    providerOrderId = rzp.id;
    await prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId } });
  }

  return {
    ok: true,
    orderNumber: order.orderNumber,
    amountDue,
    providerOrderId,
    amountPaise: Math.round(Number(amountDue) * 100),
    dev: isDevMode(),
  };
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
