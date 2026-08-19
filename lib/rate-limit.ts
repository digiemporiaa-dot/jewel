/**
 * Fixed-window rate limiter (brief §45). Pure and in-memory, so it is
 * unit-testable and needs no extra infrastructure.
 *
 * NOTE: in-memory state is per-process. On a single Coolify/VPS container that is
 * exactly right; if the app is ever scaled to multiple instances, swap the store
 * for Redis — the `checkLimit` contract stays the same.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  /** Max requests permitted inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

type Bucket = { count: number; resetAt: number };

/** Exported for testing; production code uses the module-level store. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  check(key: string, opts: RateLimitOptions, now = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + opts.windowSeconds * 1000 });
      return { allowed: true, remaining: opts.limit - 1, retryAfterSeconds: 0 };
    }

    if (bucket.count >= opts.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count += 1;
    return { allowed: true, remaining: opts.limit - bucket.count, retryAfterSeconds: 0 };
  }

  /** Drop expired buckets so the map cannot grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

const limiter = new RateLimiter();

// Prune occasionally rather than on every call.
let checksSincePrune = 0;

/** Check (and consume) a request against a named limit. */
export function checkLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  if (++checksSincePrune > 500) {
    limiter.prune();
    checksSincePrune = 0;
  }
  return limiter.check(key, opts);
}

/** Sensible presets for the sensitive surfaces. */
export const LIMITS = {
  /** OTP requests are the most abusable surface. */
  otpSend: { limit: 5, windowSeconds: 15 * 60 },
  otpVerify: { limit: 10, windowSeconds: 15 * 60 },
  /** Public form submissions. */
  appointment: { limit: 5, windowSeconds: 60 * 60 },
  review: { limit: 5, windowSeconds: 60 * 60 },
  /** Anything else public and stateful. */
  publicAction: { limit: 30, windowSeconds: 60 },
} as const;

export { limiter as _limiterForTests };
