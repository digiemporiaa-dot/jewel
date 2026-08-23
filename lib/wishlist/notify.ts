import 'server-only';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { sendTemplate } from '@/lib/templates';
import { isCampaignEnabled } from '@/lib/campaigns';

/**
 * Back-in-stock and price-drop emails for saved pieces.
 *
 * `WishlistItem.notifyBackInStock`, `notifyPriceDrop` and `priceAtAdd` have been
 * columns since the wishlist was built, with a comment saying what they were for
 * and nothing sending anything. A shopper who asked to be told a ₹1.2 lakh
 * necklace was back was never told.
 *
 * Both notifications are **self-limiting**, which is the part that matters once
 * a cron drives them:
 *
 * - back-in-stock clears the flag when sent, so a piece that goes in and out of
 *   stock all week produces one email rather than five;
 * - a price drop rewrites `priceAtAdd` to the new price, so the next email needs
 *   a *further* fall instead of firing every night the price sits below where it
 *   started.
 *
 * Without those two writes this is a spam generator on a timer.
 */

function money(value: Decimal.Value): string {
  return `₹${new Decimal(value).toNumber().toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function productUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/p/${slug}`;
}

/** Only a signed-in customer with an email can be told anything. */
const REACHABLE = {
  customer: { is: { email: { not: null }, deletedAt: null } },
} as const;

/**
 * Tell everyone waiting that a product is available again.
 *
 * Called when stock crosses from nothing to something, not on every stock write:
 * a piece that already had stock is not "back".
 */
export async function notifyBackInStock(productId: string): Promise<number> {
  // Checked before the queue is read, not inside the loop. A switched-off
  // campaign must leave every waiting request exactly where it is — the same
  // rule as an undelivered send below, for the same reason.
  if (!(await isCampaignEnabled('BACK_IN_STOCK'))) return 0;

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, deletedAt: null },
    select: { id: true, name: true, slug: true, priceFrom: true },
  });
  if (!product) return 0;

  const waiting = await prisma.wishlistItem.findMany({
    where: { productId, notifyBackInStock: true, ...REACHABLE },
    include: { customer: { select: { id: true, name: true, email: true } } },
    take: 500,
  });

  let sent = 0;
  for (const item of waiting) {
    const customer = item.customer;
    if (!customer?.email) continue;
    try {
      const delivered = await sendTemplate({
        key: 'back_in_stock',
        to: customer.email,
        customerId: customer.id,
        values: {
          name: customer.name ?? 'there',
          product: product.name,
          price: product.priceFrom ? money(product.priceFrom.toString()) : 'today’s rate',
          url: productUrl(product.slug),
        },
      });
      // Only when it actually went. `sendTemplate` returns false rather than
      // throwing when mail is unconfigured or the provider refuses — clearing
      // the flag on that would consume every waiting request and send nothing,
      // and the shopper would never hear about the piece at all.
      if (!delivered) continue;
      await prisma.wishlistItem.update({ where: { id: item.id }, data: { notifyBackInStock: false } });
      sent += 1;
    } catch (e) {
      // One bad address must not stop the rest of the queue.
      console.error('[wishlist] back-in-stock send failed', e);
    }
  }
  return sent;
}

/**
 * Tell everyone whose saved piece now costs less than when they saved it.
 *
 * Scoped to the products whose price actually moved, so the rate cron hands over
 * the ids it just recomputed rather than this walking the whole wishlist.
 */
export async function notifyPriceDrops(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;
  // Before any `priceAtAdd` is rewritten: switching the campaign off must not
  // quietly move everyone's baseline and lose the drops they were waiting for.
  if (!(await isCampaignEnabled('PRICE_DROP'))) return 0;

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true, deletedAt: null, priceFrom: { not: null } },
    select: { id: true, name: true, slug: true, priceFrom: true },
  });
  if (products.length === 0) return 0;
  const byId = new Map(products.map((p) => [p.id, p]));

  const watching = await prisma.wishlistItem.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      notifyPriceDrop: true,
      priceAtAdd: { not: null },
      ...REACHABLE,
    },
    include: { customer: { select: { id: true, name: true, email: true } } },
    take: 500,
  });

  let sent = 0;
  for (const item of watching) {
    const product = byId.get(item.productId);
    const customer = item.customer;
    if (!product?.priceFrom || !item.priceAtAdd || !customer?.email) continue;

    const now = new Decimal(product.priceFrom.toString());
    const before = new Decimal(item.priceAtAdd.toString());
    if (now.gte(before)) continue;

    try {
      const delivered = await sendTemplate({
        key: 'price_drop',
        to: customer.email,
        customerId: customer.id,
        values: {
          name: customer.name ?? 'there',
          product: product.name,
          old_price: money(before),
          price: money(now),
          url: productUrl(product.slug),
        },
      });
      // Same rule: an undelivered email must not move the baseline, or the drop
      // is forgotten and the shopper is never told about it.
      if (!delivered) continue;
      // The new baseline. Without this, every run for the rest of the month
      // re-sends the same drop.
      await prisma.wishlistItem.update({ where: { id: item.id }, data: { priceAtAdd: product.priceFrom } });
      sent += 1;
    } catch (e) {
      console.error('[wishlist] price-drop send failed', e);
    }
  }
  return sent;
}
