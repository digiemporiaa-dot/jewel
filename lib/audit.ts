import 'server-only';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Append an immutable audit record for a sensitive action (brief §44). Audit logs
 * are append-only and never editable from the normal admin UI. Failures here must
 * never break the underlying action, so we swallow errors after logging.
 */
export async function writeAudit(entry: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}): Promise<void> {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      ip =
        h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        h.get('x-real-ip') ??
        null;
      userAgent = h.get('user-agent');
    } catch {
      // headers() is unavailable outside a request scope (e.g. cron) — that's fine.
    }

    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        ip,
        userAgent,
      },
    });
  } catch (e) {
    console.error('[audit] failed to write audit log', e);
  }
}
