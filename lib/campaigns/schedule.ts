/**
 * Pure abandoned-cart reminder scheduling (no I/O, unit-tested).
 *
 * Rules (brief §40 — "Do not spam"):
 *  - A cart is abandoned once it has been idle for `abandonAfterMinutes`.
 *  - Reminders fire in stages with configurable delays measured from abandonment.
 *  - At most one reminder per run, and never before `minGapMinutes` since the last.
 *  - Stop after the final stage — no endless nagging.
 *  - A cart whose order is mid-payment is left alone for `paymentGraceMinutes`.
 */

export type ReminderConfig = {
  abandonAfterMinutes: number;
  /** Delay (minutes, from abandonment) for reminder 1, 2 and the final one. */
  stageDelaysMinutes: number[];
  minGapMinutes: number;
  /**
   * How long a cart is left alone while its order waits to be paid.
   *
   * Optional so a config already stored on the campaign row keeps working; the
   * default applies when it is absent.
   */
  paymentGraceMinutes?: number;
};

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  abandonAfterMinutes: 60,
  stageDelaysMinutes: [60, 24 * 60, 72 * 60], // 1h, 1d, 3d after abandonment
  minGapMinutes: 60,
  // Long enough to cover a bank app, an OTP and a second attempt; short enough
  // that a payment nobody is going to finish still gets chased the same evening.
  paymentGraceMinutes: 30,
};

export type CartState = {
  updatedAt: Date;
  abandonedAt: Date | null;
  remindersSent: number;
  lastReminderAt: Date | null;
  hasItems: boolean;
  converted: boolean;
  /**
   * When this bag's order was placed, while that order is still awaiting
   * payment. Null when there is no such order.
   *
   * The bag now survives checkout, so a cart with items in it is no longer
   * proof that nobody tried to buy them — the shopper may be looking at the
   * payment window this very second. Chasing that as abandoned sends "you left
   * something behind" to somebody who is in the middle of paying for it.
   */
  pendingPaymentSince?: Date | null;
};

export type ReminderDecision =
  | { action: 'none'; reason: string }
  | { action: 'mark-abandoned' }
  | { action: 'send'; stage: number };

/** Decide what (if anything) should happen to a cart right now. */
export function decideReminder(cart: CartState, now: Date, config: ReminderConfig = DEFAULT_REMINDER_CONFIG): ReminderDecision {
  if (cart.converted) return { action: 'none', reason: 'converted' };
  if (!cart.hasItems) return { action: 'none', reason: 'empty' };

  // Mid-payment: not abandoned, and not a candidate for a reminder either.
  //
  // Only for a short window. A PENDING_PAYMENT order that is hours old is one
  // nobody completed, and its bag is exactly the cart this campaign exists to
  // recover — the grace window suppresses the message that would land *during* a
  // payment, not the one that recovers a failed one.
  if (cart.pendingPaymentSince) {
    const grace = config.paymentGraceMinutes ?? DEFAULT_REMINDER_CONFIG.paymentGraceMinutes ?? 0;
    const sincePlaced = (now.getTime() - cart.pendingPaymentSince.getTime()) / 60_000;
    if (sincePlaced < grace) return { action: 'none', reason: 'awaiting-payment' };
  }

  const idleMinutes = (now.getTime() - cart.updatedAt.getTime()) / 60_000;

  if (!cart.abandonedAt) {
    return idleMinutes >= config.abandonAfterMinutes
      ? { action: 'mark-abandoned' }
      : { action: 'none', reason: 'still-active' };
  }

  // All stages already sent — stop (never spam).
  if (cart.remindersSent >= config.stageDelaysMinutes.length) {
    return { action: 'none', reason: 'all-reminders-sent' };
  }

  // Respect the minimum gap between any two messages.
  if (cart.lastReminderAt) {
    const sinceLast = (now.getTime() - cart.lastReminderAt.getTime()) / 60_000;
    if (sinceLast < config.minGapMinutes) return { action: 'none', reason: 'too-soon' };
  }

  const stage = cart.remindersSent; // 0-based index of the next reminder
  const delay = config.stageDelaysMinutes[stage];
  if (delay === undefined) return { action: 'none', reason: 'no-stage' };

  const sinceAbandoned = (now.getTime() - cart.abandonedAt.getTime()) / 60_000;
  if (sinceAbandoned < delay) return { action: 'none', reason: 'not-due' };

  return { action: 'send', stage: stage + 1 }; // 1-based for display
}

/** Human label for a reminder stage. */
export function stageLabel(stage: number, total = DEFAULT_REMINDER_CONFIG.stageDelaysMinutes.length): string {
  if (stage >= total) return 'Final reminder';
  return `Reminder ${stage}`;
}
