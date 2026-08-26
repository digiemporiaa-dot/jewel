import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AuthBreaker, ShippingAuthError, authFailureMessage, classifyAuthFailure,
  BLOCKED_COOLDOWN_MS, COOLDOWN_MS, FAILURES_BEFORE_OPEN,
} from '@/lib/shipping/auth-breaker';

// The provider is a server module by design. The breaker it contains is the
// thing under test here, and it is plain state — no request, no Prisma.
vi.mock('server-only', () => ({}));

const T0 = Date.UTC(2026, 7, 26, 6, 0, 0);
const LOCKED_BODY = '{"message":"User blocked due to too many failed login attempts.","status_code":403}';

describe('classifying a login refusal', () => {
  it('reads a lockout out of the body, not the status', () => {
    // The production incident arrived as a 403 — the same status a plain wrong
    // password can produce. Only the body separates them.
    expect(classifyAuthFailure(403, LOCKED_BODY)).toBe('blocked');
  });

  it('treats a bare 401 or 403 as bad credentials', () => {
    expect(classifyAuthFailure(401, '{"message":"Unauthorized"}')).toBe('credentials');
    expect(classifyAuthFailure(403, '{"message":"Forbidden"}')).toBe('credentials');
  });

  it('treats server errors as transient, not as our fault', () => {
    expect(classifyAuthFailure(500, 'Internal Server Error')).toBe('transient');
    expect(classifyAuthFailure(502, '<html>bad gateway</html>')).toBe('transient');
  });
});

describe('the auth breaker', () => {
  it('lets the configured number of credential failures through before opening', () => {
    const b = new AuthBreaker();
    for (let i = 1; i < FAILURES_BEFORE_OPEN; i += 1) {
      b.recordFailure('credentials', 'HTTP 401', T0);
      expect(b.snapshot(T0).open).toBe(false);
    }
    b.recordFailure('credentials', 'HTTP 401', T0);
    expect(b.snapshot(T0).open).toBe(true);
    expect(b.snapshot(T0).openUntil).toBe(T0 + COOLDOWN_MS);
  });

  it('opens on the first reported lockout, and for longer', () => {
    // Waiting for a second attempt here would spend a login on an account that
    // is already locked, which can only extend the lockout.
    const b = new AuthBreaker();
    b.recordFailure('blocked', 'HTTP 403', T0);
    expect(b.snapshot(T0).open).toBe(true);
    expect(b.snapshot(T0).openUntil).toBe(T0 + BLOCKED_COOLDOWN_MS);
    expect(BLOCKED_COOLDOWN_MS).toBeGreaterThan(COOLDOWN_MS);
  });

  it('closes again once the cooldown has passed', () => {
    const b = new AuthBreaker();
    b.recordFailure('blocked', 'HTTP 403', T0);
    expect(b.snapshot(T0 + BLOCKED_COOLDOWN_MS - 1).open).toBe(true);
    expect(b.snapshot(T0 + BLOCKED_COOLDOWN_MS).open).toBe(false);
  });

  it('never opens on transient failures however many arrive', () => {
    const b = new AuthBreaker();
    for (let i = 0; i < 10; i += 1) b.recordFailure('transient', 'HTTP 500', T0);
    expect(b.snapshot(T0).open).toBe(false);
  });

  it('does not let a transient failure launder away earlier credential failures', () => {
    // A 500 between two 401s is no evidence the password became correct.
    const b = new AuthBreaker();
    b.recordFailure('credentials', 'HTTP 401', T0);
    b.recordFailure('transient', 'HTTP 500', T0);
    b.recordFailure('credentials', 'HTTP 401', T0);
    expect(b.snapshot(T0).open).toBe(true);
  });

  it('a success is the only thing that resets the count', () => {
    const b = new AuthBreaker();
    b.recordFailure('credentials', 'HTTP 401', T0);
    b.recordSuccess();
    b.recordFailure('credentials', 'HTTP 401', T0);
    expect(b.snapshot(T0).open).toBe(false);
    expect(b.snapshot(T0).consecutiveFailures).toBe(1);
  });
});

describe('the message staff are shown', () => {
  it('tells them a lockout needs the courier, not another click', () => {
    const msg = authFailureMessage('blocked', T0 + BLOCKED_COOLDOWN_MS, 'HTTP 403');
    expect(msg).toMatch(/locked/i);
    expect(msg).toMatch(/support/i);
    expect(msg).toMatch(/paused until/i);
  });

  it('names the settings to fix for bad credentials', () => {
    const msg = authFailureMessage('credentials', T0 + COOLDOWN_MS, 'HTTP 401');
    expect(msg).toContain('SHIPROCKET_EMAIL');
    expect(msg).toContain('SHIPROCKET_PASSWORD');
  });

  it('says to try again shortly when it is the provider misbehaving', () => {
    const msg = authFailureMessage('transient', 0, 'HTTP 502');
    expect(msg).toMatch(/try again/i);
    expect(msg).not.toMatch(/paused until/i);
  });

  it('never repeats the provider body back to the counter', () => {
    // The body is logged, not displayed: staff need an instruction, not JSON.
    for (const kind of ['blocked', 'credentials'] as const) {
      expect(authFailureMessage(kind, T0 + COOLDOWN_MS, 'HTTP 403')).not.toContain('status_code');
    }
  });

  it('carries the kind and the retry time on the thrown error', () => {
    const e = new ShippingAuthError('nope', 'blocked', T0 + BLOCKED_COOLDOWN_MS);
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('blocked');
    expect(e.retryAt).toBe(T0 + BLOCKED_COOLDOWN_MS);
  });
});

describe('the Shiprocket client against a stubbed courier', () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];

  beforeEach(() => {
    // Deliberately not vi.resetModules(): a fresh module registry would hand
    // back a second copy of ShippingAuthError, and `instanceof` — which the
    // server actions and the cron both rely on to tell a login refusal from any
    // other error — would quietly stop matching. resetShiprocketAuth() clears
    // the state without duplicating the class.
    calls = [];
    process.env.SHIPROCKET_EMAIL = 'ops@example.com';
    process.env.SHIPROCKET_PASSWORD = 'wrong';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SHIPROCKET_EMAIL;
    delete process.env.SHIPROCKET_PASSWORD;
  });

  function stub(respond: (url: string) => Response) {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return respond(url);
    }) as typeof fetch;
  }

  async function freshProvider() {
    const mod = await import('@/lib/shipping/shiprocket');
    mod.resetShiprocketAuth();
    return new mod.ShiprocketProvider();
  }

  it('stops calling /auth/login once the account is reported locked', async () => {
    stub(() => new Response(LOCKED_BODY, { status: 403 }));
    const p = await freshProvider();

    // Six presses of "Create shipment", as happened in production.
    const errors: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      await p.track('AWB1').catch((e: unknown) => errors.push(e));
    }

    const logins = calls.filter((u) => u.includes('/auth/login'));
    expect(logins).toHaveLength(1);
    expect(errors).toHaveLength(6);
    expect(errors.every((e) => e instanceof ShippingAuthError)).toBe(true);
    expect((errors[5] as ShippingAuthError).kind).toBe('blocked');
  });

  it('allows a second attempt on bad credentials, then stops', async () => {
    stub(() => new Response('{"message":"Unauthorized"}', { status: 401 }));
    const p = await freshProvider();
    for (let i = 0; i < 5; i += 1) await p.track('AWB1').catch(() => {});
    expect(calls.filter((u) => u.includes('/auth/login'))).toHaveLength(FAILURES_BEFORE_OPEN);
  });

  it('keeps retrying while the failure is only the provider misbehaving', async () => {
    stub(() => new Response('gateway timeout', { status: 504 }));
    const p = await freshProvider();
    for (let i = 0; i < 4; i += 1) await p.track('AWB1').catch(() => {});
    // A bad afternoon on their side must not pause shipping for an hour.
    expect(calls.filter((u) => u.includes('/auth/login'))).toHaveLength(4);
  });

  it('logs in once and reuses the token across many calls', async () => {
    stub((url) =>
      url.includes('/auth/login')
        ? Response.json({ token: 'tok-abc' })
        : Response.json({ tracking_data: { shipment_track: [{ current_status: 'IN TRANSIT', courier_name: 'X', awb_code: 'AWB1', edd: '' }] } })
    );
    const p = await freshProvider();
    for (let i = 0; i < 5; i += 1) await p.track('AWB1');
    expect(calls.filter((u) => u.includes('/auth/login'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('/courier/track'))).toHaveLength(5);
  });

  it('collapses concurrent callers into a single login', async () => {
    stub((url) =>
      url.includes('/auth/login')
        ? Response.json({ token: 'tok-abc' })
        : Response.json({ tracking_data: { shipment_track: [] } })
    );
    const p = await freshProvider();
    await Promise.all([p.track('A'), p.track('B'), p.track('C'), p.track('D')]);
    expect(calls.filter((u) => u.includes('/auth/login'))).toHaveLength(1);
  });

  it('does not re-enter the login endpoint when an API call 401s', async () => {
    // Dropping the stale token is right; retrying the login in the same breath
    // would walk a rejected account straight back into the lockout.
    stub((url) => (url.includes('/auth/login') ? Response.json({ token: 'tok-abc' }) : new Response('nope', { status: 401 })));
    const p = await freshProvider();
    await p.track('AWB1').catch(() => {});
    expect(calls.filter((u) => u.includes('/auth/login'))).toHaveLength(1);
  });

  it('treats a 200 with no token as the provider misbehaving, not as our credentials', async () => {
    stub(() => Response.json({}));
    const p = await freshProvider();
    const err = await p.track('AWB1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShippingAuthError);
    expect((err as ShippingAuthError).kind).toBe('transient');
  });

  it('runs simulated, with no network at all, when credentials are absent', async () => {
    delete process.env.SHIPROCKET_EMAIL;
    delete process.env.SHIPROCKET_PASSWORD;
    stub(() => new Response('should never be called', { status: 500 }));
    const p = await freshProvider();
    const t = await p.track('AWB1');
    expect(t.rawStatus).toBe('IN TRANSIT');
    expect(calls).toHaveLength(0);
  });
});

describe('no shipment action can reach the error boundary', () => {
  // The production crash was one action out of six missing a try/catch, so the
  // guard rail is that every action goes through the same wrapper — not that
  // six wrappers each exist.
  const source = readFileSync(join(__dirname, '..', 'app/admin/(protected)/shipments/actions.ts'), 'utf8');

  const exported = [...source.matchAll(/export async function (\w+Action)\b/g)].map((m) => m[1]);

  it('finds the actions the panel calls', () => {
    expect(exported).toEqual(expect.arrayContaining([
      'createShipmentAction', 'assignAwbAction', 'schedulePickupAction',
      'generateLabelAction', 'generateManifestAction', 'refreshTrackingAction',
    ]));
  });

  it.each(exported)('%s hands its courier call to the shared guard', (name) => {
    const body = source.slice(source.indexOf(`export async function ${name}`)).split('\n}')[0];
    expect(body).toContain('return guarded(');
  });

  it('has exactly one place where a courier error is caught', () => {
    expect(source.match(/catch \(e\)/g) ?? []).toHaveLength(1);
  });

  it('recognises a login refusal rather than printing a bare status', () => {
    expect(source).toContain('e instanceof ShippingAuthError');
  });

  it('the panel renders whatever error comes back', () => {
    // Without this the guarded result would be caught and dropped on the floor.
    const panel = readFileSync(join(__dirname, '..', 'components/admin/ShipmentPanel.tsx'), 'utf8');
    expect(panel).toContain('res.error');
  });
});
