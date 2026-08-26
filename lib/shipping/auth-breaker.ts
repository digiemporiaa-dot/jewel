/**
 * A circuit breaker for a courier's login endpoint.
 *
 * Shiprocket locks an API user after enough failed logins, and clearing that
 * lock needs their support — it is not something a retry, a redeploy or waiting
 * quietly will fix. So a wrong password is not merely a failed shipment: left
 * alone it escalates into an outage across *every* order, because each admin
 * click and each pass of the reconciliation cron used to be a fresh
 * `/auth/login` attempt. Two hundred shipments in the cron queue meant two
 * hundred failed logins in one run.
 *
 * The rule this encodes: after a couple of refusals, stop asking. A shipment
 * delayed until an operator fixes the password is recoverable in minutes. A
 * locked account is recoverable only through somebody else's support queue.
 *
 * Deliberately free of `server-only`, Prisma and `fetch` so the state machine
 * can be driven directly in tests, with the clock passed in rather than read.
 */

import { formatIst } from '@/lib/utils/datetime';

/** Why a login was refused. Only the first two are the account's own fault. */
export type AuthFailureKind = 'credentials' | 'blocked' | 'transient';

/** Refusals tolerated before the breaker opens. */
export const FAILURES_BEFORE_OPEN = 2;
/** Cooldown after repeated credential rejections. */
export const COOLDOWN_MS = 15 * 60_000;
/** Cooldown once the provider says the account is locked. */
export const BLOCKED_COOLDOWN_MS = 60 * 60_000;

export type BreakerSnapshot = {
  open: boolean;
  /** Epoch ms the breaker reopens for business; 0 when it is already closed. */
  openUntil: number;
  consecutiveFailures: number;
  kind: AuthFailureKind | null;
  /** The provider's own words, kept for the operator-facing message. */
  detail: string | null;
};

/**
 * Read the provider's refusal.
 *
 * The body is checked before the status because a lockout arrives as a 403 and
 * a plain wrong password arrives as a 401 or a 403 — the status alone cannot
 * tell "this password is wrong" from "this account is now locked", and those
 * call for very different advice and very different cooldowns.
 */
export function classifyAuthFailure(status: number, body: string): AuthFailureKind {
  if (/blocked|too many failed login/i.test(body)) return 'blocked';
  if (status === 401 || status === 403) return 'credentials';
  return 'transient';
}

export class AuthBreaker {
  private failures = 0;
  private openUntil = 0;
  private kind: AuthFailureKind | null = null;
  private detail: string | null = null;

  snapshot(now: number): BreakerSnapshot {
    const open = this.openUntil > now;
    return {
      open,
      openUntil: open ? this.openUntil : 0,
      consecutiveFailures: this.failures,
      kind: this.kind,
      detail: this.detail,
    };
  }

  /**
   * Record a refusal and decide whether to stop trying.
   *
   * A reported lockout opens the breaker on the first sighting rather than
   * after two: the damage has already happened, and every further attempt can
   * only extend it. Transient failures — a 500, a timeout, a gateway error —
   * never open the breaker, because refusing to ship for an hour over the
   * provider's own bad afternoon would be its own outage. They also do not
   * *reset* the counter: a 500 arriving between two 401s is no evidence the
   * password became correct. Only a successful login clears it.
   */
  recordFailure(kind: AuthFailureKind, detail: string, now: number): void {
    this.detail = detail;
    if (kind === 'transient') return;

    this.kind = kind;
    this.failures += 1;
    if (kind === 'blocked') {
      this.openUntil = now + BLOCKED_COOLDOWN_MS;
      return;
    }
    if (this.failures >= FAILURES_BEFORE_OPEN) {
      this.openUntil = now + COOLDOWN_MS;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
    this.kind = null;
    this.detail = null;
  }

  /** Clear the cooldown deliberately — for an operator who has fixed the cause. */
  reset(): void {
    this.recordSuccess();
  }
}

/**
 * A login refusal, carrying enough to tell staff what to do next.
 *
 * The three kinds need three different actions — fix a password, call the
 * courier's support, or simply try again later — and a raw `401` in the admin
 * panel tells whoever is standing at the counter none of them.
 */
export class ShippingAuthError extends Error {
  readonly kind: AuthFailureKind;
  /** Epoch ms before which no further attempt will be made; 0 if not paused. */
  readonly retryAt: number;

  constructor(message: string, kind: AuthFailureKind, retryAt: number) {
    super(message);
    this.name = 'ShippingAuthError';
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

/**
 * The sentence an admin sees. Written for the person at the shop counter, not
 * for a log: it names the cause, says who can fix it, and — where attempts are
 * paused — says until when, so nobody stands there clicking a dead button.
 */
export function authFailureMessage(kind: AuthFailureKind, retryAt: number, detail: string | null): string {
  const until = retryAt > 0 ? ` Shipping actions are paused until ${formatIst(new Date(retryAt))}.` : '';
  switch (kind) {
    case 'blocked':
      return (
        'Shiprocket has locked the API user after too many failed logins. ' +
        'Only Shiprocket support can unlock it — retrying here will not clear it, and will keep it locked longer.' +
        until
      );
    case 'credentials':
      return (
        'Shiprocket rejected the login. Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in the deployment settings.' +
        until +
        ' Attempts are limited on purpose: enough failed logins and Shiprocket locks the account, which needs their support to undo.'
      );
    case 'transient':
      return `Shiprocket did not respond to the login${detail ? ` (${detail})` : ''}. This looks like their side — try again shortly.`;
  }
}
