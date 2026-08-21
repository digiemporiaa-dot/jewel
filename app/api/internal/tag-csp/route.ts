import { NextResponse } from 'next/server';
import { getTagConfig } from '@/lib/marketing/config';
import { tagCspSources } from '@/lib/marketing/csp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma — never Edge.

/**
 * The CSP host list for the currently enabled tags.
 *
 * `middleware.ts` runs on the Edge runtime and cannot reach Prisma, so it reads
 * the host list from here instead and memoises it. This endpoint exposes nothing
 * private: it returns only third-party hostnames, which are visible in the
 * response's own `Content-Security-Policy` header and in the page source anyway.
 * Tag IDs and the CAPI token are never included.
 */
export async function GET() {
  const config = await getTagConfig();
  return NextResponse.json(tagCspSources(config), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
