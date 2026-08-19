/**
 * Fixed-window rate limiter (brief §45).
 *
 * Two backends, chosen at runtime:
 *
 *   - **Upstash Redis** when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *     are set. Required on serverless platforms (Vercel), where every request may
 *     land in a different isolate and in-memory counters are effectively useless.
 *     Called over plain `fetch` so this needs no extra dependency.
 *   - **In-memory** otherwise. Correct on a single long-lived container
 *     (Docker/Coolify/VPS), and the fallback if Redis is unreachable.
 *
 * The Redis path **fails open**: if Upstash errors or times out we drop back to
 * the in-memory counter rather than blocking checkout. A rate limiter is a shield,
 * not a gate — it must never take the store down with it.
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

/** True when a shared Redis store is configured (required on serverless). */
export function isDistributedRateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

type PipelineReply = { result?: unknown; error?: string };

/**
 * Fixed-window counter in Upstash Redis. Returns null when Redis is not
 * configured or the call fails, so the caller can fall back to memory.
 */
async function checkRedis(key: string, opts: RateLimitOptions): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redisKey = `rl:${key}`;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // INCR creates the counter at 1; EXPIRE ... NX sets the window only on that
      // first hit, so the window is fixed rather than sliding forward per request.
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, String(opts.windowSeconds), 'NX'],
        ['PTTL', redisKey],
      ]),
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;

    const replies = (await res.json()) as PipelineReply[];
    const count = Number(replies[0]?.result);
    if (!Number.isFinite(count) || count < 1) return null;

    const pttl = Number(replies[2]?.result);
    const retryAfterSeconds = Number.isFinite(pttl) && pttl > 0
      ? Math.ceil(pttl / 1000)
      : opts.windowSeconds;

    if (count > opts.limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    return { allowed: true, remaining: opts.limit - count, retryAfterSeconds: 0 };
  } catch {
    return null; // fail open — fall back to the in-memory counter
  }
}

/** Check (and consume) a request against a named limit. */
export async function checkLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const shared = await checkRedis(key, opts);
  if (shared) return shared;

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
