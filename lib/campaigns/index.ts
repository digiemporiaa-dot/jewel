import 'server-only';
import { prisma } from '@/lib/prisma';
import { sendTemplate } from '@/lib/templates';
import { decideReminder, stageLabel, DEFAULT_REMINDER_CONFIG, type ReminderConfig } from '@/lib/campaigns/schedule';
import { formatCurrency } from '@/lib/utils/format';
import { captureAbandonedCartLead } from '@/lib/leads';

/** Load a campaign's on/off state and config overrides from the database. */
export async function getCampaign(type: string) {
  return prisma.campaign.findFirst({ where: { type } });
}

/**
 * Is this automation switched on?
 *
 * Every sender calls this before doing anything. Missing row means **on**: a
 * shop that has never opened the campaigns screen keeps the behaviour it has
 * today, and turning something off is always a deliberate act rather than a
 * side effect of a screen nobody visited.
 *
 * A failed lookup also means on. A database hiccup must not silently stop the
 * shop telling a customer their order shipped — the send retrying is recoverable,
 * a send that never happened is not.
 */
export async function isCampaignEnabled(type: string): Promise<boolean> {
  try {
    const campaign = await getCampaign(type);
    return campaign?.isActive ?? true;
  } catch (e) {
    console.error('[campaigns] could not read switch, assuming on', type, e);
    return true;
  }
}

async function reminderConfig(): Promise<{ enabled: boolean; config: ReminderConfig }> {
  const campaign = await getCampaign('ABANDONED_CART');
  if (!campaign) return { enabled: true, config: DEFAULT_REMINDER_CONFIG };
  const cfg = (campaign.config ?? {}) as Partial<ReminderConfig>;
  return {
    enabled: campaign.isActive,
    config: {
      abandonAfterMinutes: cfg.abandonAfterMinutes ?? DEFAULT_REMINDER_CONFIG.abandonAfterMinutes,
      stageDelaysMinutes: cfg.stageDelaysMinutes ?? DEFAULT_REMINDER_CONFIG.stageDelaysMinutes,
      minGapMinutes: cfg.minGapMinutes ?? DEFAULT_REMINDER_CONFIG.minGapMinutes,
      paymentGraceMinutes: cfg.paymentGraceMinutes ?? DEFAULT_REMINDER_CONFIG.paymentGraceMinutes,
    },
  };
}

export type AbandonedCartResult = {
  scanned: number; markedAbandoned: number; remindersSent: number; skipped: number;
  /** CRM leads raised for newly abandoned carts. */
  leadsRaised: number;
};

/**
 * Rough value of what was left behind, for the lead's estimated value.
 *
 * Built from each product's "from" price rather than a recomputed quote: this is
 * a sales prompt — "chase this one first" — not a figure anyone is charged, and
 * the real total is recomputed at checkout against the live metal rate anyway.
 */
function cartValue(items: { quantity: number; product: { priceFrom: unknown } }[]): string | null {
  let total = 0;
  for (const item of items) {
    const from = Number(item.product.priceFrom ?? 0);
    if (!Number.isFinite(from) || from <= 0) return null; // an unpriced item makes the sum a lie
    total += from * item.quantity;
  }
  return total > 0 ? total.toFixed(2) : null;
}

/**
 * When each of these sessions last placed an order that is still unpaid.
 *
 * Keyed by session token, which is what ties a bag to the order made from it:
 * `Order.sessionToken` is recorded at checkout precisely so the bag can be
 * found again later. The most recent placement wins — a shopper on their second
 * attempt is mid-payment now, whatever the first attempt's age suggests.
 */
async function pendingPaymentByCart(sessionTokens: (string | null)[]): Promise<Map<string, Date>> {
  const tokens = sessionTokens.filter((t): t is string => !!t);
  const byToken = new Map<string, Date>();
  if (tokens.length === 0) return byToken;

  const orders = await prisma.order.findMany({
    where: { sessionToken: { in: tokens }, status: 'PENDING_PAYMENT' },
    select: { sessionToken: true, placedAt: true },
    orderBy: { placedAt: 'asc' },
  });
  for (const order of orders) {
    if (order.sessionToken) byToken.set(order.sessionToken, order.placedAt);
  }
  return byToken;
}

/**
 * Abandoned-cart pass: mark newly abandoned carts, then send at most one staged
 * reminder per cart per run. Scheduling is decided by the pure logic in
 * lib/campaigns/schedule.ts.
 */
export async function runAbandonedCartCampaign(now = new Date()): Promise<AbandonedCartResult> {
  const { enabled, config } = await reminderConfig();
  const result: AbandonedCartResult = { scanned: 0, markedAbandoned: 0, remindersSent: 0, skipped: 0, leadsRaised: 0 };
  if (!enabled) return result;

  const carts = await prisma.cart.findMany({
    where: { convertedOrderId: null, items: { some: {} } },
    include: {
      items: { include: { product: { select: { name: true, slug: true, priceFrom: true } } } },
      customer: { select: { id: true, name: true, email: true } },
    },
    take: 200,
  });

  // Which of these bags belong to an order that is still waiting to be paid.
  //
  // `convertedOrderId` above is no longer the whole answer. It is now set when
  // an order is actually paid, not when it is created, so a cart whose shopper
  // is at the payment window still looks exactly like one that was walked away
  // from: items in it, nothing converted. That is deliberate — an order nobody
  // pays for must eventually be chased, and its bag is what there is to chase
  // with — but it must not be chased *while the payment is being made*, so the
  // scheduler gets the placement time and applies its grace window to it.
  const pendingPaymentSince = await pendingPaymentByCart(carts.map((c) => c.sessionToken));

  for (const cart of carts) {
    result.scanned += 1;
    const decision = decideReminder(
      {
        updatedAt: cart.updatedAt,
        abandonedAt: cart.abandonedAt,
        remindersSent: cart.remindersSent,
        lastReminderAt: cart.lastReminderAt,
        hasItems: cart.items.length > 0,
        converted: !!cart.convertedOrderId,
        pendingPaymentSince: cart.sessionToken ? pendingPaymentSince.get(cart.sessionToken) ?? null : null,
      },
      now,
      config
    );

    if (decision.action === 'mark-abandoned') {
      await prisma.cart.update({ where: { id: cart.id }, data: { abandonedAt: now } });
      result.markedAbandoned += 1;

      // Raise a CRM lead at the moment the cart is written off, not when the
      // last reminder is sent. On a ₹1,00,000 bag a phone call the same evening
      // is worth more than three emails over three days — and a cart with no
      // email address gets no reminders at all, so this is the only trace of it.
      const outcome = await captureAbandonedCartLead({
        cartId: cart.id,
        customerId: cart.customer?.id ?? null,
        sessionToken: cart.sessionToken,
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        value: cartValue(cart.items),
        productId: cart.items[0]?.productId ?? null,
      });
      if (outcome === 'created') result.leadsRaised += 1;
      continue;
    }
    if (decision.action === 'none') { result.skipped += 1; continue; }

    // Send stage reminder — email only when we have an address to reach.
    const email = cart.customer?.email;
    const first = cart.items[0];
    if (email && first) {
      await sendTemplate({
        key: 'abandoned_cart',
        to: email,
        customerId: cart.customer?.id ?? null,
        values: {
          name: cart.customer?.name ?? 'there',
          product: first.product.name,
          price: formatCurrency(first.product.priceFrom?.toString() ?? null),
          url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/cart`,
          stage: stageLabel(decision.stage, config.stageDelaysMinutes.length),
        },
      });
    }

    await prisma.cart.update({
      where: { id: cart.id },
      data: { remindersSent: { increment: 1 }, lastReminderAt: now },
    });
    result.remindersSent += 1;
  }

  return result;
}

export type OccasionResult = { birthdays: number; anniversaries: number };

/** Birthday / anniversary greetings for customers who opted into marketing. */
export async function runOccasionCampaigns(now = new Date()): Promise<OccasionResult> {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const result: OccasionResult = { birthdays: 0, anniversaries: 0 };

  const [birthdayCampaign, anniversaryCampaign] = await Promise.all([
    getCampaign('BIRTHDAY'),
    getCampaign('ANNIVERSARY'),
  ]);

  const customers = await prisma.customer.findMany({
    // `deletedAt` first: sending a birthday email to somebody who asked to be
    // erased is the single worst way for an erasure to fail.
    where: { deletedAt: null, marketingOptIn: true, email: { not: null }, OR: [{ dob: { not: null } }, { anniversary: { not: null } }] },
    select: { id: true, name: true, email: true, dob: true, anniversary: true },
    take: 500,
  });

  for (const c of customers) {
    if (!c.email) continue;
    const isBirthday = c.dob && c.dob.getMonth() + 1 === month && c.dob.getDate() === day;
    const isAnniversary = c.anniversary && c.anniversary.getMonth() + 1 === month && c.anniversary.getDate() === day;

    if (isBirthday && (birthdayCampaign?.isActive ?? true)) {
      await sendTemplate({
        key: 'birthday', to: c.email, customerId: c.id,
        values: { name: c.name ?? 'friend' },
      });
      result.birthdays += 1;
    }
    if (isAnniversary && (anniversaryCampaign?.isActive ?? true)) {
      await sendTemplate({
        key: 'anniversary', to: c.email, customerId: c.id,
        values: { name: c.name ?? 'friend' },
      });
      result.anniversaries += 1;
    }
  }

  return result;
}

/**
 * Admin: campaign on/off state and timing.
 *
 * Wording is not part of this — it lives under Marketing → Email Templates, so
 * this no longer loads MessageTemplate rows.
 */
export async function getCampaignSettings() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { type: 'asc' } });
  return { campaigns };
}

/** Abandoned-cart stats for the admin view. */
export async function getAbandonedCartStats() {
  const [abandoned, recovered, pendingReminders] = await Promise.all([
    prisma.cart.count({ where: { abandonedAt: { not: null }, convertedOrderId: null } }),
    prisma.cart.count({ where: { abandonedAt: { not: null }, convertedOrderId: { not: null } } }),
    prisma.cart.count({ where: { abandonedAt: { not: null }, convertedOrderId: null, remindersSent: { lt: 3 } } }),
  ]);
  return { abandoned, recovered, pendingReminders };
}
