import { NextResponse, type NextRequest } from 'next/server';
import { countHit } from '@/lib/redirects';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma — never Edge.

/**
 * "A redirect was used."
 *
 * Called by the middleware through `event.waitUntil`, so the counter is written
 * after the redirect response has already gone out. The alternative — writing
 * before responding — would make every redirect wait on a database round trip,
 * and the Edge cannot reach Prisma anyway.
 *
 * Internal only: the middleware matcher excludes `/api/internal`, and nothing
 * here reveals or changes anything a caller could not already learn by following
 * the redirect itself. The worst a forged call can do is inflate a counter the
 * shop uses to decide which old rules are still worth keeping.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { fromPath } = (await req.json()) as { fromPath?: string };
    if (typeof fromPath === 'string' && fromPath.length > 0 && fromPath.length < 2048) {
      await countHit(fromPath);
    }
  } catch {
    /* a malformed beacon is not worth a response nobody reads */
  }
  return new NextResponse(null, { status: 204 });
}
