import { describe, it, expect } from 'vitest';
import { RateLimiter, LIMITS, checkLimit, isDistributedRateLimitConfigured } from '@/lib/rate-limit';

describe('rate limiter', () => {
  it('allows requests up to the limit, then blocks', () => {
    const rl = new RateLimiter();
    const opts = { limit: 3, windowSeconds: 60 };
    const now = 1_000_000;

    expect(rl.check('k', opts, now).allowed).toBe(true);
    expect(rl.check('k', opts, now).allowed).toBe(true);
    const third = rl.check('k', opts, now);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = rl.check('k', opts, now);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    const rl = new RateLimiter();
    const opts = { limit: 1, windowSeconds: 60 };
    const now = 1_000_000;

    expect(rl.check('k', opts, now).allowed).toBe(true);
    expect(rl.check('k', opts, now + 30_000).allowed).toBe(false);
    // Window has passed — allowed again.
    expect(rl.check('k', opts, now + 61_000).allowed).toBe(true);
  });

  it('tracks keys independently (one caller cannot block another)', () => {
    const rl = new RateLimiter();
    const opts = { limit: 1, windowSeconds: 60 };
    const now = 1_000_000;

    expect(rl.check('ip:1.1.1.1', opts, now).allowed).toBe(true);
    expect(rl.check('ip:1.1.1.1', opts, now).allowed).toBe(false);
    // A different client is unaffected.
    expect(rl.check('ip:2.2.2.2', opts, now).allowed).toBe(true);
  });

  it('prunes expired buckets so memory cannot grow unbounded', () => {
    const rl = new RateLimiter();
    const opts = { limit: 5, windowSeconds: 60 };
    const now = 1_000_000;

    rl.check('a', opts, now);
    rl.check('b', opts, now);
    expect(rl.size).toBe(2);

    rl.prune(now + 61_000);
    expect(rl.size).toBe(0);
  });

  it('OTP presets are strict enough to blunt abuse', () => {
    // Sending: a handful per quarter-hour; verifying: bounded guesses.
    expect(LIMITS.otpSend.limit).toBeLessThanOrEqual(5);
    expect(LIMITS.otpSend.windowSeconds).toBeGreaterThanOrEqual(600);
    expect(LIMITS.otpVerify.limit).toBeLessThanOrEqual(10);
  });
});

describe('distributed backend selection', () => {
  it('reports no shared store when Upstash is unconfigured', () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isDistributedRateLimitConfigured()).toBe(false);
  });

  it('reports a shared store once both Upstash variables are present', () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    expect(isDistributedRateLimitConfigured()).toBe(true);
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('still enforces the limit in-memory when no shared store is configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const key = `fallback:${Math.random()}`;
    const opts = { limit: 2, windowSeconds: 60 };

    expect((await checkLimit(key, opts)).allowed).toBe(true);
    expect((await checkLimit(key, opts)).allowed).toBe(true);
    expect((await checkLimit(key, opts)).allowed).toBe(false);
  });

  it('fails OPEN to memory when the shared store is unreachable — a limiter must never take checkout down', async () => {
    // Unroutable host: the fetch rejects, so checkRedis returns null.
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    const key = `degraded:${Math.random()}`;
    const opts = { limit: 1, windowSeconds: 60 };

    expect((await checkLimit(key, opts)).allowed).toBe(true);
    // Fallen back to the in-memory counter, which still enforces the limit.
    expect((await checkLimit(key, opts)).allowed).toBe(false);

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });
});
