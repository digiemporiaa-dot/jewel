import { describe, it, expect } from 'vitest';
import { redact } from '@/lib/logger';

describe('log redaction — secrets must never reach the logs', () => {
  it('redacts obvious secret keys', () => {
    const out = redact({ password: 'hunter2', otp: '123456', token: 'abc', name: 'Anita' }) as Record<string, unknown>;
    expect(out.password).toBe('[redacted]');
    expect(out.otp).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.name).toBe('Anita'); // non-sensitive data survives
  });

  it('redacts by substring, not exact match', () => {
    const out = redact({ passwordHash: 'x', razorpaySignature: 'y', apiKey: 'z', codeHash: 'w' }) as Record<string, unknown>;
    expect(Object.values(out)).toEqual(['[redacted]', '[redacted]', '[redacted]', '[redacted]']);
  });

  it('redacts nested structures and arrays', () => {
    const out = redact({ user: { name: 'A', password: 'p' }, items: [{ cvv: '999', sku: 'RG-1' }] }) as {
      user: Record<string, unknown>; items: Record<string, unknown>[];
    };
    expect(out.user.password).toBe('[redacted]');
    expect(out.user.name).toBe('A');
    expect(out.items[0]?.cvv).toBe('[redacted]');
    expect(out.items[0]?.sku).toBe('RG-1');
  });

  it('redacts customer PAN', () => {
    const out = redact({ pan: 'ABCDE1234F' }) as Record<string, unknown>;
    expect(out.pan).toBe('[redacted]');
  });

  it('flattens errors without leaking stack traces', () => {
    const out = redact(new Error('boom')) as Record<string, unknown>;
    expect(out).toEqual({ name: 'Error', message: 'boom' });
    expect(out.stack).toBeUndefined();
  });

  it('guards against deeply nested structures', () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[deep]');
  });
});
