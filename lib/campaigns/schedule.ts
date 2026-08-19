/**
 * Pure abandoned-cart reminder scheduling (no I/O, unit-tested).
 *
 * Rules (brief §40 — "Do not spam"):
 *  - A cart is abandoned once it has been idle for `abandonAfterMinutes`.
 *  - Reminders fire in stages with configurable delays measured from abandonment.
 *  - At most one reminder per run, and never before `minGapMinutes` since the last.
 *  - Stop after the final stage — no endless nagging.
 */

export type ReminderConfig = {
  abandonAfterMinutes: number;
  /** Delay (minutes, from abandonment) for reminder 1, 2 and the final one. */
  stageDelaysMinutes: number[];
  minGapMinutes: number;
};

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  abandonAfterMinutes: 60,
  stageDelaysMinutes: [60, 24 * 60, 72 * 60], // 1h, 1d, 3d after abandonment
  minGapMinutes: 60,
};

export type CartState = {
  updatedAt: Date;
  abandonedAt: Date | null;
  remindersSent: number;
  lastReminderAt: Date | null;
  hasItems: boolean;
  converted: boolean;
};

export type ReminderDecision =
  | { action: 'none'; reason: string }
  | { action: 'mark-abandoned' }
  | { action: 'send'; stage: number };

/** Decide what (if anything) should happen to a cart right now. */
export function decideReminder(cart: CartState, now: Date, config: ReminderConfig = DEFAULT_REMINDER_CONFIG): ReminderDecision {
  if (cart.converted) return { action: 'none', reason: 'converted' };
  if (!cart.hasItems) return { action: 'none', reason: 'empty' };

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
