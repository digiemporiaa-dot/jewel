import { describe, it, expect } from 'vitest';
import { RateLimiter, LIMITS } from '@/lib/rate-limit';

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
