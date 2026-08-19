import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness + readiness probe for the container platform (Coolify, Docker
 * HEALTHCHECK, uptime monitors).
 *
 * Deliberately minimal: it reports whether the process is up and whether the
 * database answers, and nothing else. No version, no environment, no table
 * counts — an unauthenticated endpoint must not become a reconnaissance surface,
 * and the error text is never echoed to the caller (it goes to the logs instead).
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: 'ok', database: 'up', ms: Date.now() - startedAt },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('[health] database check failed', e);
    return NextResponse.json(
      { status: 'degraded', database: 'down' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
