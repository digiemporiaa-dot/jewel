import { describe, it, expect } from 'vitest';
import { decideReminder, stageLabel, DEFAULT_REMINDER_CONFIG, type CartState } from '@/lib/campaigns/schedule';

const base = new Date('2026-08-19T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(base.getTime() - n * 60_000);

function cart(overrides: Partial<CartState> = {}): CartState {
  return {
    updatedAt: minutesAgo(10),
    abandonedAt: null,
    remindersSent: 0,
    lastReminderAt: null,
    hasItems: true,
    converted: false,
    ...overrides,
  };
}

describe('abandoned-cart: marking abandonment', () => {
  it('leaves a recently active cart alone', () => {
    expect(decideReminder(cart({ updatedAt: minutesAgo(10) }), base)).toEqual({ action: 'none', reason: 'still-active' });
  });

  it('marks a cart abandoned once idle past the threshold', () => {
    expect(decideReminder(cart({ updatedAt: minutesAgo(61) }), base)).toEqual({ action: 'mark-abandoned' });
  });

  it('ignores empty carts', () => {
    expect(decideReminder(cart({ hasItems: false, updatedAt: minutesAgo(500) }), base)).toEqual({ action: 'none', reason: 'empty' });
  });

  it('ignores carts that converted to an order', () => {
    expect(decideReminder(cart({ converted: true, updatedAt: minutesAgo(500) }), base)).toEqual({ action: 'none', reason: 'converted' });
  });
});

/**
 * The bag now survives checkout, so a cart with items in it is no longer proof
 * that nobody tried to buy them: the shopper may be at the payment window right
 * now. `convertedOrderId` is only set once the money arrives, so the placement
 * time of an unpaid order is what tells these two apart.
 */
describe('abandoned-cart: a cart whose order is mid-payment', () => {
  it('is left alone while the payment is plausibly still happening', () => {
    const c = cart({ pendingPaymentSince: minutesAgo(5), updatedAt: minutesAgo(120) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'awaiting-payment' });
  });

  it('is not marked abandoned during the grace window, however idle it looks', () => {
    // The cart has not been touched for hours precisely because the shopper
    // moved on to paying for it.
    const c = cart({ pendingPaymentSince: minutesAgo(2), updatedAt: minutesAgo(5000) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'awaiting-payment' });
  });

  it('gets no reminder mid-payment, even with a stage long overdue', () => {
    const c = cart({ pendingPaymentSince: minutesAgo(1), abandonedAt: minutesAgo(5000), updatedAt: minutesAgo(6000) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'awaiting-payment' });
  });

  it('is chased again once the window has passed — an unpaid order is what this recovers', () => {
    const c = cart({ pendingPaymentSince: minutesAgo(31), updatedAt: minutesAgo(120) });
    expect(decideReminder(c, base)).toEqual({ action: 'mark-abandoned' });
  });

  it('honours a configured grace window', () => {
    const config = { ...DEFAULT_REMINDER_CONFIG, paymentGraceMinutes: 120 };
    const c = cart({ pendingPaymentSince: minutesAgo(90), updatedAt: minutesAgo(500) });
    expect(decideReminder(c, base, config)).toEqual({ action: 'none', reason: 'awaiting-payment' });
    expect(decideReminder(c, base, { ...config, paymentGraceMinutes: 60 })).toEqual({ action: 'mark-abandoned' });
  });

  it('is unaffected when there is no unpaid order behind it', () => {
    expect(decideReminder(cart({ updatedAt: minutesAgo(61) }), base)).toEqual({ action: 'mark-abandoned' });
  });
});

describe('abandoned-cart: staged reminders', () => {
  it('sends reminder 1 once the first delay has elapsed', () => {
    const c = cart({ abandonedAt: minutesAgo(61), updatedAt: minutesAgo(200) });
    expect(decideReminder(c, base)).toEqual({ action: 'send', stage: 1 });
  });

  it('does not send before the stage delay is due', () => {
    const c = cart({ abandonedAt: minutesAgo(30), updatedAt: minutesAgo(200) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'not-due' });
  });

  it('sends reminder 2 only after the second delay', () => {
    const notYet = cart({ abandonedAt: minutesAgo(120), remindersSent: 1, lastReminderAt: minutesAgo(90), updatedAt: minutesAgo(300) });
    expect(decideReminder(notYet, base)).toEqual({ action: 'none', reason: 'not-due' });

    const due = cart({ abandonedAt: minutesAgo(1500), remindersSent: 1, lastReminderAt: minutesAgo(500), updatedAt: minutesAgo(2000) });
    expect(decideReminder(due, base)).toEqual({ action: 'send', stage: 2 });
  });

  it('sends the final reminder as stage 3', () => {
    const c = cart({ abandonedAt: minutesAgo(5000), remindersSent: 2, lastReminderAt: minutesAgo(1000), updatedAt: minutesAgo(6000) });
    expect(decideReminder(c, base)).toEqual({ action: 'send', stage: 3 });
  });
});

describe('abandoned-cart: anti-spam guarantees', () => {
  it('never sends more than the configured number of reminders', () => {
    const c = cart({ abandonedAt: minutesAgo(99999), remindersSent: 3, lastReminderAt: minutesAgo(9999), updatedAt: minutesAgo(99999) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'all-reminders-sent' });
  });

  it('respects the minimum gap between messages even when a stage is due', () => {
    const c = cart({ abandonedAt: minutesAgo(5000), remindersSent: 1, lastReminderAt: minutesAgo(5), updatedAt: minutesAgo(6000) });
    expect(decideReminder(c, base)).toEqual({ action: 'none', reason: 'too-soon' });
  });

  it('sends at most one reminder per evaluation', () => {
    // Even a very old cart at stage 0 only yields stage 1 — never a batch.
    const c = cart({ abandonedAt: minutesAgo(99999), remindersSent: 0, updatedAt: minutesAgo(99999) });
    const decision = decideReminder(c, base);
    expect(decision).toEqual({ action: 'send', stage: 1 });
  });

  it('honours custom delay configuration', () => {
    const config = { abandonAfterMinutes: 10, stageDelaysMinutes: [5], minGapMinutes: 1 };
    const c = cart({ abandonedAt: minutesAgo(6), updatedAt: minutesAgo(60) });
    expect(decideReminder(c, base, config)).toEqual({ action: 'send', stage: 1 });
    // Only one stage configured → stops after it.
    const done = cart({ abandonedAt: minutesAgo(600), remindersSent: 1, lastReminderAt: minutesAgo(100), updatedAt: minutesAgo(600) });
    expect(decideReminder(done, base, config)).toEqual({ action: 'none', reason: 'all-reminders-sent' });
  });
});

describe('stage labels', () => {
  it('names the last stage "Final reminder"', () => {
    expect(stageLabel(1)).toBe('Reminder 1');
    expect(stageLabel(2)).toBe('Reminder 2');
    expect(stageLabel(DEFAULT_REMINDER_CONFIG.stageDelaysMinutes.length)).toBe('Final reminder');
  });
});
