import { NextResponse } from 'next/server';
import { getTagConfig } from '@/lib/marketing/config';
import { tagCspSources } from '@/lib/marketing/csp';
import { videoFrameHosts } from '@/lib/video/csp';

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
 *
 * Video embed hosts are unioned in here too, so the Edge makes one lookup rather
 * than two for the same 30-second memo.
 */
export async function GET() {
  const [config, videoHosts] = await Promise.all([getTagConfig(), videoFrameHosts()]);
  const sources = tagCspSources(config);

  // Video embed hosts ride along on the same lookup rather than adding a second
  // Edge fetch. They are unioned into `frame-src` only when the shop actually
  // has a video: a permanently widened frame-src is a permanently widened
  // attack surface for every shop that never embeds one.
  return NextResponse.json(
    { ...sources, frameSrc: [...new Set([...sources.frameSrc, ...videoHosts])] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
