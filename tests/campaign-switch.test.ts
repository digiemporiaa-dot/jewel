import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The switches have to change behaviour, not just save a row.
 *
 * Seven campaigns were listed on the admin screen and four of them — new
 * customer welcome, back in stock, price drop, order shipped/delivered — were
 * connected to nothing. Turning one off wrote `isActive: false`, said "Saved",
 * and the email went out on the next run regardless.
 *
 * These call the senders for real with the database and the mailer stubbed, so
 * what is asserted is the thing that was broken: with the switch off, nothing
 * is sent and — just as important — no state is consumed.
 */

vi.mock('server-only', () => ({}));

const sendTemplate = vi.fn(async (_args: { key: string }) => true);
vi.mock('@/lib/templates', () => ({ sendTemplate: (args: { key: string }) => sendTemplate(args) }));

const db = {
  campaign: { findFirst: vi.fn() },
  product: { findFirst: vi.fn(), findMany: vi.fn() },
  wishlistItem: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
  customer: { findFirst: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({ prisma: db }));

function campaignIs(active: boolean) {
  db.campaign.findFirst.mockResolvedValue({ id: 'c1', type: 'X', name: 'X', isActive: active, config: null });
}

const WAITING = [{
  id: 'w1',
  productId: 'p1',
  priceAtAdd: '132000',
  customer: { id: 'cu1', name: 'Ananya', email: 'a@example.com' },
}];

beforeEach(() => {
  vi.clearAllMocks();
  sendTemplate.mockResolvedValue(true);
  db.product.findFirst.mockResolvedValue({ id: 'p1', name: 'Kundan Necklace', slug: 'kundan', priceFrom: '124300' });
  db.product.findMany.mockResolvedValue([{ id: 'p1', name: 'Kundan Necklace', slug: 'kundan', priceFrom: '124300' }]);
  db.wishlistItem.findMany.mockResolvedValue(WAITING);
  db.customer.findFirst.mockResolvedValue({ id: 'cu1', name: 'Ananya', email: 'a@example.com', _count: { orders: 0 } });
});

describe('back in stock', () => {
  it('sends and clears the request when the campaign is on', async () => {
    campaignIs(true);
    const { notifyBackInStock } = await import('@/lib/wishlist/notify');
    const sent = await notifyBackInStock('p1');

    expect(sent).toBe(1);
    expect(sendTemplate).toHaveBeenCalledOnce();
    expect(db.wishlistItem.update).toHaveBeenCalledWith({
      where: { id: 'w1' }, data: { notifyBackInStock: false },
    });
  });

  it('sends nothing when the campaign is off', async () => {
    campaignIs(false);
    const { notifyBackInStock } = await import('@/lib/wishlist/notify');
    const sent = await notifyBackInStock('p1');

    expect(sent).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('leaves every waiting request intact when the campaign is off', async () => {
    // The part that would be silently destructive: clearing the flags without
    // sending would mean nobody is ever told, even after it is switched back on.
    campaignIs(false);
    const { notifyBackInStock } = await import('@/lib/wishlist/notify');
    await notifyBackInStock('p1');

    expect(db.wishlistItem.update).not.toHaveBeenCalled();
    expect(db.wishlistItem.findMany).not.toHaveBeenCalled();
  });
});

describe('price drop', () => {
  it('sends and moves the baseline when the campaign is on', async () => {
    campaignIs(true);
    const { notifyPriceDrops } = await import('@/lib/wishlist/notify');
    const sent = await notifyPriceDrops(['p1']);

    expect(sent).toBe(1);
    expect(sendTemplate).toHaveBeenCalledOnce();
    expect(db.wishlistItem.update).toHaveBeenCalledWith({
      where: { id: 'w1' }, data: { priceAtAdd: '124300' },
    });
  });

  it('sends nothing and moves no baseline when the campaign is off', async () => {
    campaignIs(false);
    const { notifyPriceDrops } = await import('@/lib/wishlist/notify');

    expect(await notifyPriceDrops(['p1'])).toBe(0);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(db.wishlistItem.update).not.toHaveBeenCalled();
  });
});

describe('new customer welcome', () => {
  it('greets a first-time customer when the campaign is on', async () => {
    campaignIs(true);
    const { sendWelcome } = await import('@/lib/email/notifications');
    await sendWelcome('cu1');

    expect(sendTemplate).toHaveBeenCalledOnce();
    expect(sendTemplate.mock.calls[0]?.[0]).toMatchObject({ key: 'new_customer' });
  });

  it('stays quiet when the campaign is off', async () => {
    campaignIs(false);
    const { sendWelcome } = await import('@/lib/email/notifications');
    await sendWelcome('cu1');

    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe('a switch that cannot be read', () => {
  it('defaults to on, so a database hiccup never silences the shop', async () => {
    db.campaign.findFirst.mockRejectedValue(new Error('connection lost'));
    const { isCampaignEnabled } = await import('@/lib/campaigns');

    expect(await isCampaignEnabled('BACK_IN_STOCK')).toBe(true);
  });

  it('defaults to on when no row has ever been written', async () => {
    db.campaign.findFirst.mockResolvedValue(null);
    const { isCampaignEnabled } = await import('@/lib/campaigns');

    expect(await isCampaignEnabled('NEW_CUSTOMER')).toBe(true);
  });
});
