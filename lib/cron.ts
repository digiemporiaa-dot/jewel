import { timingSafeEqual } from 'node:crypto';

/**
 * Validate a cron request against CRON_SECRET (brief §56 — cron endpoints must
 * never be public). Accepts `Authorization: Bearer <secret>` or
 * `x-cron-secret: <secret>`. Uses a constant-time comparison.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';

  if (header.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(secret));
  } catch {
    return false;
  }
}
