import 'server-only';
import { headers } from 'next/headers';

/**
 * Best-effort client identity for rate limiting. Uses the forwarded IP set by the
 * reverse proxy (Coolify/nginx). Falls back to a constant so a missing header
 * degrades to a shared bucket rather than disabling the limit entirely.
 */
export async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return h.get('x-real-ip') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
