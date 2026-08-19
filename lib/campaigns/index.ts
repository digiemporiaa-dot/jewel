import 'server-only';
import { prisma } from '@/lib/prisma';
import { getStoreSettings } from '@/lib/store';
import { sendEmail } from '@/lib/email';
import { decideReminder, stageLabel, DEFAULT_REMINDER_CONFIG, type ReminderConfig } from '@/lib/campaigns/schedule';
import { formatCurrency } from '@/lib/utils/format';

/** Load a campaign's on/off state and config overrides from the database. */
export async function getCampaign(type: string) {
  return prisma.campaign.findFirst({ where: { type } });
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
    },
  };
}

/** Render a template body with {{placeholders}}. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

async function templateFor(key: string): Promise<{ subject: string; body: string } | null> {
  const t = await prisma.messageTemplate.findUnique({ where: { key } });
  if (!t || !t.isActive) return null;
  return { subject: t.subject ?? '', body: t.body };
}

export type AbandonedCartResult = { scanned: number; markedAbandoned: number; remindersSent: number; skipped: number };

/**
 * Abandoned-cart pass: mark newly abandoned carts, then send at most one staged
 * reminder per cart per run. Scheduling is decided by the pure logic in
 * lib/campaigns/schedule.ts.
 */
export async function runAbandonedCartCampaign(now = new Date()): Promise<AbandonedCartResult> {
  const { enabled, config } = await reminderConfig();
  const result: AbandonedCartResult = { scanned: 0, markedAbandoned: 0, remindersSent: 0, skipped: 0 };
  if (!enabled) return result;

  const store = await getStoreSettings();
  const template = await templateFor('abandoned_cart');

  const carts = await prisma.cart.findMany({
    where: { convertedOrderId: null, items: { some: {} } },
    include: {
      items: { include: { product: { select: { name: true, slug: true, priceFrom: true } } } },
      customer: { select: { id: true, name: true, email: true } },
    },
    take: 200,
  });

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
      },
      now,
      config
    );

    if (decision.action === 'mark-abandoned') {
      await prisma.cart.update({ where: { id: cart.id }, data: { abandonedAt: now } });
      result.markedAbandoned += 1;
      continue;
    }
    if (decision.action === 'none') { result.skipped += 1; continue; }

    // Send stage reminder — email only when we have an address to reach.
    const email = cart.customer?.email;
    const first = cart.items[0];
    if (email && first) {
      const vars = {
        name: cart.customer?.name ?? 'there',
        brand: store.brandName,
        product: first.product.name,
        price: formatCurrency(first.product.priceFrom?.toString() ?? null),
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/cart`,
        stage: stageLabel(decision.stage, config.stageDelaysMinutes.length),
      };
      const html = template
        ? `<div style="font-family:Arial,sans-serif;max-width:520px;color:#161513">${renderTemplate(template.body, vars)}</div>`
        : `<div style="font-family:Arial,sans-serif;max-width:520px;color:#161513">
             <h2 style="font-family:Georgia,serif;color:#17362C">${store.brandName}</h2>
             <p>Hi ${vars.name}, you left <strong>${vars.product}</strong> in your bag.</p>
             <p>Prices move with the daily metal rate — complete your order to secure today's price.</p>
             <p><a href="${vars.url}" style="color:#A8813C">Return to your bag</a></p>
           </div>`;
      await sendEmail({
        to: email,
        subject: template?.subject ? renderTemplate(template.subject, vars) : `You left something behind — ${store.brandName}`,
        html,
        customerId: cart.customer?.id ?? null,
        templateKey: 'abandoned_cart',
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
  const store = await getStoreSettings();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const result: OccasionResult = { birthdays: 0, anniversaries: 0 };

  const [birthdayCampaign, anniversaryCampaign] = await Promise.all([
    getCampaign('BIRTHDAY'),
    getCampaign('ANNIVERSARY'),
  ]);

  const customers = await prisma.customer.findMany({
    where: { marketingOptIn: true, email: { not: null }, OR: [{ dob: { not: null } }, { anniversary: { not: null } }] },
    select: { id: true, name: true, email: true, dob: true, anniversary: true },
    take: 500,
  });

  for (const c of customers) {
    if (!c.email) continue;
    const isBirthday = c.dob && c.dob.getMonth() + 1 === month && c.dob.getDate() === day;
    const isAnniversary = c.anniversary && c.anniversary.getMonth() + 1 === month && c.anniversary.getDate() === day;

    if (isBirthday && (birthdayCampaign?.isActive ?? true)) {
      await sendEmail({
        to: c.email,
        subject: `Happy birthday from ${store.brandName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#161513">
          <h2 style="font-family:Georgia,serif;color:#17362C">${store.brandName}</h2>
          <p>Happy birthday, ${c.name ?? 'friend'}! Wishing you a wonderful year ahead.</p>
        </div>`,
        customerId: c.id, templateKey: 'birthday',
      });
      result.birthdays += 1;
    }
    if (isAnniversary && (anniversaryCampaign?.isActive ?? true)) {
      await sendEmail({
        to: c.email,
        subject: `Happy anniversary from ${store.brandName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;color:#161513">
          <h2 style="font-family:Georgia,serif;color:#17362C">${store.brandName}</h2>
          <p>Happy anniversary, ${c.name ?? 'friend'}! Celebrate with something timeless.</p>
        </div>`,
        customerId: c.id, templateKey: 'anniversary',
      });
      result.anniversaries += 1;
    }
  }

  return result;
}

/** Admin: list campaigns and templates for configuration. */
export async function getCampaignSettings() {
  const [campaigns, templates] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { type: 'asc' } }),
    prisma.messageTemplate.findMany({ orderBy: { key: 'asc' } }),
  ]);
  return { campaigns, templates };
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
