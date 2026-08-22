import 'server-only';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { getProductPricing } from '@/lib/pricing/resolve';
import { getStoreSettings } from '@/lib/store';
import type { PriceBreakup } from '@/lib/pricing';

export class CartError extends Error {}

async function getOrCreateCart(sessionToken: string): Promise<string> {
  const existing = await prisma.cart.findUnique({ where: { sessionToken }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.cart.create({ data: { sessionToken } });
  return created.id;
}

async function availableFor(variantId: string): Promise<{ available: number; madeToOrder: boolean }> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true, product: { select: { fulfilmentType: true } } },
  });
  if (!variant) throw new CartError('Variant not found');
  const madeToOrder = variant.product.fulfilmentType === 'MADE_TO_ORDER';
  const available = variant.inventory ? variant.inventory.stockQty - variant.inventory.reservedQty : 0;
  return { available, madeToOrder };
}

export async function addToCart(sessionToken: string, productId: string, variantId: string, qty = 1): Promise<void> {
  if (qty < 1) throw new CartError('Quantity must be at least 1');
  const cartId = await getOrCreateCart(sessionToken);
  const { available, madeToOrder } = await availableFor(variantId);

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId_variantId: { cartId, productId, variantId } },
  });
  const desired = (existing?.quantity ?? 0) + qty;
  // Ready-to-ship items are capped at available stock; made-to-order is unbounded.
  if (!madeToOrder && desired > available) {
    throw new CartError(available <= 0 ? 'Out of stock' : `Only ${available} in stock`);
  }

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: desired } });
  } else {
    await prisma.cartItem.create({ data: { cartId, productId, variantId, quantity: qty } });
  }
  await prisma.cart.update({ where: { id: cartId }, data: { abandonedAt: null } });
}

export async function updateCartItem(sessionToken: string, itemId: string, qty: number): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { sessionToken }, select: { id: true } });
  if (!cart) throw new CartError('Cart not found');
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
  if (!item) throw new CartError('Item not found'); // ownership check
  if (qty < 1) {
    await prisma.cartItem.delete({ where: { id: itemId } });
    return;
  }
  if (item.variantId) {
    const { available, madeToOrder } = await availableFor(item.variantId);
    if (!madeToOrder && qty > available) throw new CartError(`Only ${available} in stock`);
  }
  await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
}

export async function removeCartItem(sessionToken: string, itemId: string): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { sessionToken }, select: { id: true } });
  if (!cart) return;
  await prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } }); // scoped to owner
}

export type CartLine = {
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  slug: string;
  variantLabel: string | null;
  image: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  breakup: PriceBreakup | null;
  available: number;
  madeToOrder: boolean;
  error: string | null;
};

export type CartSummary = {
  lines: CartLine[];
  itemCount: number;
  currency: string;
  metalTotal: string;
  makingTotal: string;
  stoneTotal: string;
  /**
   * Value of fixed-price items, which have no metal or making component.
   * Without this the summary rows cannot reach the taxable total for a bag
   * containing anything priced as a flat MRP.
   */
  itemPriceTotal: string;
  /** Per-item discounts set on the product, separate from any coupon code. */
  productDiscountTotal: string;
  gstTotal: string;
  taxableTotal: string;
  itemsTotal: string;
  shipping: string;
  freeShippingEligible: boolean;
  grandTotal: string;
};

/**
 * The cart, with every line's price recomputed server-side by the pricing engine.
 * Browser-submitted amounts are never trusted (RULE 1).
 */
export async function getCart(sessionToken: string | undefined): Promise<CartSummary> {
  const store = await getStoreSettings();
  const empty: CartSummary = {
    lines: [], itemCount: 0, currency: store.currency,
    metalTotal: '0.00', makingTotal: '0.00', stoneTotal: '0.00',
    itemPriceTotal: '0.00', productDiscountTotal: '0.00', gstTotal: '0.00',
    taxableTotal: '0.00', itemsTotal: '0.00', shipping: '0.00', freeShippingEligible: false, grandTotal: '0.00',
  };
  if (!sessionToken) return empty;

  const cart = await prisma.cart.findUnique({
    where: { sessionToken },
    include: {
      items: {
        orderBy: { addedAt: 'asc' },
        include: {
          product: { select: { name: true, slug: true, fulfilmentType: true, images: { where: { isPrimary: true }, take: 1 } } },
          variant: { include: { inventory: true } },
        },
      },
    },
  });
  if (!cart || cart.items.length === 0) return empty;

  // Price each distinct product once.
  const pricingByProduct = new Map<string, Awaited<ReturnType<typeof getProductPricing>>>();
  for (const productId of new Set(cart.items.map((i) => i.productId))) {
    pricingByProduct.set(productId, await getProductPricing({ id: productId }));
  }

  let metal = new Decimal(0), making = new Decimal(0), stone = new Decimal(0), gst = new Decimal(0), taxable = new Decimal(0), items = new Decimal(0);
  let fixedPrice = new Decimal(0), productDiscount = new Decimal(0);

  const lines: CartLine[] = cart.items.map((item) => {
    const pricing = pricingByProduct.get(item.productId);
    const vp = pricing?.variants.find((v) => v.variantId === item.variantId);
    const breakup = vp?.breakup ?? null;
    const qty = item.quantity;
    const available = item.variant?.inventory ? item.variant.inventory.stockQty - item.variant.inventory.reservedQty : 0;

    let lineTotal = '0.00';
    if (breakup) {
      const q = new Decimal(qty);
      metal = metal.plus(new Decimal(breakup.metalValue).plus(breakup.wastage).times(q));
      making = making.plus(new Decimal(breakup.making).times(q));
      stone = stone.plus(new Decimal(breakup.diamondValue).plus(breakup.stoneValue).times(q));
      // A FIXED-mode line is a flat price with no components, so its value would
      // otherwise appear in the total with nothing on screen accounting for it.
      if (breakup.mode === 'FIXED') fixedPrice = fixedPrice.plus(new Decimal(breakup.subtotal).times(q));
      productDiscount = productDiscount.plus(new Decimal(breakup.discount).times(q));
      gst = gst.plus(new Decimal(breakup.gst).times(q));
      taxable = taxable.plus(new Decimal(breakup.taxable).times(q));
      const lt = new Decimal(breakup.unitTotal).times(q);
      items = items.plus(lt);
      lineTotal = lt.toFixed(2);
    }

    return {
      itemId: item.id, productId: item.productId, variantId: item.variantId,
      name: item.product.name, slug: item.product.slug,
      variantLabel: item.variant?.label ?? null,
      image: item.product.images[0]?.url ?? null,
      quantity: qty,
      unitPrice: breakup?.unitTotal ?? '0.00',
      lineTotal,
      breakup,
      available,
      madeToOrder: item.product.fulfilmentType === 'MADE_TO_ORDER',
      error: vp?.error ?? (breakup ? null : 'Price unavailable'),
    };
  });

  const freeAbove = store.freeShippingAbove ? new Decimal(store.freeShippingAbove.toString()) : null;
  const flat = new Decimal(store.flatShippingFee.toString());
  const freeShippingEligible = freeAbove !== null && items.gte(freeAbove);
  const shipping = freeShippingEligible || flat.lte(0) ? new Decimal(0) : flat;
  const grand = items.plus(shipping);

  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    currency: store.currency,
    metalTotal: metal.toFixed(2),
    makingTotal: making.toFixed(2),
    stoneTotal: stone.toFixed(2),
    itemPriceTotal: fixedPrice.toFixed(2),
    productDiscountTotal: productDiscount.toFixed(2),
    gstTotal: gst.toFixed(2),
    taxableTotal: taxable.toFixed(2),
    itemsTotal: items.toFixed(2),
    shipping: shipping.toFixed(2),
    freeShippingEligible,
    grandTotal: grand.toFixed(2),
  };
}

export async function getCartCount(sessionToken: string | undefined): Promise<number> {
  if (!sessionToken) return 0;
  const cart = await prisma.cart.findUnique({
    where: { sessionToken },
    select: { items: { select: { quantity: true } } },
  });
  return cart ? cart.items.reduce((n, i) => n + i.quantity, 0) : 0;
}
