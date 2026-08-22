import 'server-only';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { CartSummary } from '@/lib/cart';
import {
  calculateCoupon, checkCouponWindow, REJECTION_MESSAGES,
  type CouponLine, type CouponRules, type CouponCalculation,
} from '@/lib/coupons/calculate';

/**
 * Resolving and applying a coupon against a real cart.
 *
 * Two rules hold this together:
 *
 *  1. **The browser never supplies a discount.** It sends a code; the server
 *     looks the coupon up, decides eligibility and computes the amount. A
 *     client-supplied discount is the same class of bug as a client-supplied
 *     price (RULE 1) — and at these order values it is a ₹40,000 one.
 *  2. **Validity is re-checked at order creation**, not only when the code is
 *     entered. Rates move, carts sit open for hours, and another shopper may
 *     have taken the last use in between.
 */

export type CouponFailure = { ok: false; error: string };
export type CouponSuccess = {
  ok: true;
  calculation: CouponCalculation;
  couponId: string;
  code: string;
  stackable: boolean;
};
export type CouponResult = CouponSuccess | CouponFailure;

/**
 * Turn cart lines into the shape the pure calculator needs.
 *
 * The cart does not carry category, collection, metal, purity or weight, so
 * those are loaded here — one query for the whole bag rather than one per line.
 */
async function toCouponLines(cart: CartSummary): Promise<CouponLine[]> {
  const productIds = [...new Set(cart.lines.map((l) => l.productId))];
  if (productIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      categoryId: true,
      netWeight: true,
      metal: { select: { name: true } },
      purity: { select: { name: true } },
      collections: { select: { collectionId: true } },
      variants: { select: { id: true, netWeight: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return cart.lines.map<CouponLine>((line) => {
    const product = byId.get(line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId);
    const weight = variant?.netWeight ?? product?.netWeight ?? null;
    const b = line.breakup;

    return {
      itemId: line.itemId,
      quantity: line.quantity,
      metalValue: b?.metalValue ?? '0',
      makingValue: b?.making ?? '0',
      // Diamonds and other stones are one component for coupon purposes: a
      // "stones" offer means everything set into the piece.
      stoneValue: new Decimal(b?.stoneValue ?? '0').plus(b?.diamondValue ?? '0').toFixed(2),
      taxableValue: b?.taxable ?? '0',
      // The pricing engine is the only source of a line-level discount, so a
      // non-zero discount in the breakup is what "already discounted" means.
      alreadyDiscounted: Number(b?.discount ?? '0') > 0,
      categoryIds: product?.categoryId ? [product.categoryId] : [],
      collectionIds: product?.collections.map((c) => c.collectionId) ?? [],
      metalType: product?.metal?.name ?? null,
      purity: product?.purity?.name ?? null,
      weightGrams: weight ? weight.toString() : null,
    };
  });
}

function toRules(coupon: {
  code: string; type: string; value: Prisma.Decimal; appliesTo: string;
  minOrder: Prisma.Decimal | null; maxDiscount: Prisma.Decimal | null;
  categoryIds: string[]; collectionIds: string[]; metalTypes: string[]; purities: string[];
  minWeightGrams: Prisma.Decimal | null; maxWeightGrams: Prisma.Decimal | null;
  excludeDiscounted: boolean;
}): CouponRules {
  return {
    code: coupon.code,
    type: coupon.type as CouponRules['type'],
    value: coupon.value.toString(),
    appliesTo: coupon.appliesTo as CouponRules['appliesTo'],
    minOrder: coupon.minOrder?.toString() ?? null,
    maxDiscount: coupon.maxDiscount?.toString() ?? null,
    categoryIds: coupon.categoryIds,
    collectionIds: coupon.collectionIds,
    metalTypes: coupon.metalTypes,
    purities: coupon.purities,
    minWeightGrams: coupon.minWeightGrams?.toString() ?? null,
    maxWeightGrams: coupon.maxWeightGrams?.toString() ?? null,
    excludeDiscounted: coupon.excludeDiscounted,
  };
}

/**
 * Validate a code against a cart and compute what it would take off.
 *
 * `client` lets this run inside the order transaction, where the coupon row is
 * read under the same lock that will increment its usage count.
 */
export async function evaluateCoupon(params: {
  code: string;
  cart: CartSummary;
  customerId: string | null;
  client?: Prisma.TransactionClient;
  now?: Date;
}): Promise<CouponResult> {
  const db = params.client ?? prisma;
  const code = params.code.trim().toUpperCase();
  if (code === '') return { ok: false, error: 'Enter a code' };

  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon) return { ok: false, error: 'That code is not recognised' };

  // Per-customer history. A guest with no customer record has no history, so a
  // per-user limit cannot bind — that is a known and accepted limitation of
  // guest checkout rather than something to pretend we can enforce.
  const [customerUses, customerOrderCount] = params.customerId
    ? await Promise.all([
        db.order.count({
          where: {
            customerId: params.customerId,
            couponId: coupon.id,
            status: { notIn: ['CANCELLED'] },
          },
        }),
        db.order.count({ where: { customerId: params.customerId, status: { notIn: ['CANCELLED'] } } }),
      ])
    : [0, 0];

  const rejection = checkCouponWindow(
    {
      isActive: coupon.isActive,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      usageLimit: coupon.usageLimit,
      usageCount: coupon.usageCount,
      perUserLimit: coupon.perUserLimit,
      firstOrderOnly: coupon.firstOrderOnly,
      minOrder: coupon.minOrder?.toString() ?? null,
    },
    {
      now: params.now ?? new Date(),
      customerUses,
      customerOrderCount,
      cartValue: params.cart.itemsTotal,
    }
  );
  if (rejection) return { ok: false, error: REJECTION_MESSAGES[rejection] };

  const lines = await toCouponLines(params.cart);
  const calculation = calculateCoupon(lines, toRules(coupon));

  if (calculation.discountTotal === '0.00' && !calculation.freeShipping) {
    // Being specific matters: "nothing in your bag qualifies" is actionable,
    // "invalid code" sends the shopper to support.
    return {
      ok: false,
      error:
        calculation.eligibleItemIds.length === 0
          ? 'Nothing in your bag qualifies for that code'
          : 'That code does not reduce anything on these items',
    };
  }

  return {
    ok: true,
    calculation,
    couponId: coupon.id,
    code: coupon.code,
    stackable: coupon.stackable,
  };
}

/**
 * Claim one use of a coupon, inside the order transaction.
 *
 * The conditional `updateMany` is the whole point: two shoppers redeeming the
 * last use of a code at the same moment must not both succeed. At jewellery
 * order values one leaked redemption is a ₹50,000 mistake, so the increment and
 * the limit check are a single atomic statement rather than a read followed by a
 * write.
 *
 * Returns false when the last use was taken between validation and here; the
 * caller aborts the order rather than honouring a discount the store did not
 * agree to.
 */
export async function claimCouponUse(
  tx: Prisma.TransactionClient,
  couponId: string
): Promise<boolean> {
  const coupon = await tx.coupon.findUnique({ where: { id: couponId }, select: { usageLimit: true } });
  if (!coupon) return false;

  if (coupon.usageLimit === null) {
    await tx.coupon.update({ where: { id: couponId }, data: { usageCount: { increment: 1 } } });
    return true;
  }

  const claimed = await tx.coupon.updateMany({
    where: { id: couponId, usageCount: { lt: coupon.usageLimit } },
    data: { usageCount: { increment: 1 } },
  });
  return claimed.count === 1;
}

export type DiscountedTotals = {
  discountTotal: string;
  taxableTotal: string;
  gstTotal: string;
  shipping: string;
  grandTotal: string;
};

/**
 * Fold a coupon into the cart's totals.
 *
 * The discount comes off the **taxable value**, and GST is then charged on the
 * reduced amount. Discounting after tax would have the store remitting GST on
 * money it never received.
 *
 * Recomputed per line rather than on the cart total, because lines can carry
 * different GST rates and the discount is not spread evenly across them.
 */
export function applyDiscountToTotals(
  cart: CartSummary,
  calculation: CouponCalculation | null
): DiscountedTotals {
  const shipping = calculation?.freeShipping ? new Decimal(0) : new Decimal(cart.shipping);

  if (!calculation || calculation.discountTotal === '0.00') {
    const grand = new Decimal(cart.taxableTotal).plus(cart.gstTotal).plus(shipping);
    return {
      discountTotal: '0.00',
      taxableTotal: new Decimal(cart.taxableTotal).toFixed(2),
      gstTotal: new Decimal(cart.gstTotal).toFixed(2),
      shipping: shipping.toFixed(2),
      grandTotal: grand.toFixed(2),
    };
  }

  const discountByItem = new Map(calculation.perLine.map((l) => [l.itemId, new Decimal(l.discount)]));

  let taxableTotal = new Decimal(0);
  let gstTotal = new Decimal(0);
  let discountTotal = new Decimal(0);

  for (const line of cart.lines) {
    const b = line.breakup;
    const lineTaxable = new Decimal(b?.taxable ?? '0').times(line.quantity);
    const rate = new Decimal(b?.gstPercent ?? '0');

    // Never below zero: the cap in `calculateCoupon` should already prevent it,
    // but a total that went negative would silently pay the shopper.
    const discount = Decimal.min(discountByItem.get(line.itemId) ?? new Decimal(0), lineTaxable);
    const netTaxable = lineTaxable.minus(discount);

    taxableTotal = taxableTotal.plus(netTaxable);
    gstTotal = gstTotal.plus(netTaxable.times(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    discountTotal = discountTotal.plus(discount);
  }

  const taxable = taxableTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const gst = gstTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    discountTotal: discountTotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    taxableTotal: taxable.toFixed(2),
    gstTotal: gst.toFixed(2),
    shipping: shipping.toFixed(2),
    grandTotal: taxable.plus(gst).plus(shipping).toFixed(2),
  };
}
