import 'server-only';
import { cookies } from 'next/headers';
import { signValue, verifyValue } from '@/lib/sign';
import { prisma } from '@/lib/prisma';

const COOKIE = 'maya_customer';
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret';
}

/** Set the signed customer session cookie after successful OTP verification. */
export async function setCustomerSession(customerId: string): Promise<void> {
  const store = await cookies();
  const value = JSON.stringify({ id: customerId, iat: Date.now() });
  store.set(COOKIE, signValue(value, secret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function clearCustomerSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Read the current customer id from the signed cookie (tamper-evident). */
export async function getCustomerId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const value = verifyValue(raw, secret());
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

/** Load the current customer (or null). */
export async function getCurrentCustomer() {
  const id = await getCustomerId();
  if (!id) return null;
  // A deleted customer is nobody. Returning the row would let a session
  // outlive an erasure request and put a scrubbed name back on a screen.
  return prisma.customer.findFirst({ where: { id, deletedAt: null } });
}
