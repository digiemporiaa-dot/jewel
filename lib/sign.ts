import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HMAC-signed value helper (pure, testable). Used for the customer
 * session cookie so we don't entangle customer auth with the staff NextAuth
 * instance. Not encryption — the payload is readable — but tamper-evident.
 */

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
function unb64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signValue(value: string, secret: string): string {
  const payload = b64url(value);
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return unb64url(payload);
  } catch {
    return null;
  }
}
