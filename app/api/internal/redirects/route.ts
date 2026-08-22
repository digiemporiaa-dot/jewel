import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Prisma — never Edge.

/**
 * The active redirect map, for the middleware.
 *
 * `middleware.ts` runs on the Edge runtime and cannot reach Prisma, so it reads
 * the map from here and memoises it — the same arrangement the marketing-tag CSP
 * uses.
 *
 * Nothing private is exposed: every path in here is a URL the site will send a
 * browser to if asked, so it is already discoverable by anyone willing to try
 * one. Notes, hit counts and who created a rule are deliberately not included.
 *
 * The cap exists because this is held in memory on every Edge isolate. A shop
 * with more redirects than this has a migration problem rather than a redirect
 * problem, and the overflow is served by the not-found path instead.
 */
const MAX_RULES = 2000;

export async function GET() {
  try {
    const rules = await prisma.redirect.findMany({
      where: { isActive: true },
      select: { fromPath: true, toPath: true, statusCode: true },
      // Oldest first, so which rules fall off the end is stable rather than
      // shifting each time somebody edits one.
      orderBy: { createdAt: 'asc' },
      take: MAX_RULES,
    });

    return NextResponse.json(
      { rules, truncated: rules.length === MAX_RULES },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('[redirects] lookup failed', e);
    // An empty map means "no redirects", which serves 404s for renamed pages.
    // That is bad but recoverable; a 500 here would break every request on the
    // site, because the middleware runs on all of them.
    return NextResponse.json({ rules: [], truncated: false }, { status: 200 });
  }
}
