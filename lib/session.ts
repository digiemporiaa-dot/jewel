import 'server-only';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';

const COOKIE = 'maya_sid';
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/** Read the guest session token (may be undefined in read-only contexts). */
export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

/**
 * Read-or-create the guest session token. Only call from a Server Action or Route
 * Handler (writing cookies is not allowed while rendering).
 */
export async function ensureSessionToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing) return existing;
  const token = randomUUID();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return token;
}
