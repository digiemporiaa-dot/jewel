import NextAuth from 'next-auth';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { authConfig } from './auth.config';
import { baseCsp } from './lib/security/csp';
import { appendCspSources, hasCspSources, type CspSources } from './lib/marketing/csp';
import { getRedirectMap, resolveRedirect } from './lib/redirects/edge';

/**
 * Three jobs, all of which have to happen before a response leaves:
 *
 *  1. Serve redirects. First, because a renamed page must not render its 404
 *     before anything else gets a say, and because there is no point running the
 *     auth guard on a request that is about to be sent somewhere else.
 *  2. Guard `/admin` — authentication only. Role checks are re-done server-side
 *     in every admin route and server action; a hidden menu is not authorization.
 *  3. Own the Content-Security-Policy. It lives here rather than in
 *     `next.config.mjs` because marketing tag IDs are database values that change
 *     without a redeploy, and a policy declared in the config is fixed at server
 *     start and would override anything set here. One owner, no ambiguity.
 */

const authMiddleware = NextAuth(authConfig).auth;

const NO_SOURCES: CspSources = { scriptSrc: [], connectSrc: [], imgSrc: [], frameSrc: [] };

/**
 * Middleware runs on the Edge runtime, which cannot reach Prisma, so the tag
 * host list comes from an internal route handler and is memoised per isolate.
 *
 * The memo means an admin's change reaches the CSP within `TTL_MS` rather than
 * instantly. That is the price of not querying on every request, and it is
 * bounded: a freshly pasted ID starts working within half a minute, with no
 * redeploy.
 */
const TTL_MS = 30_000;
let memo: { at: number; sources: CspSources } | null = null;
let inFlight: Promise<CspSources> | null = null;

async function fetchTagSources(origin: string): Promise<CspSources> {
  // `INTERNAL_BASE_URL` lets a deployment point this at the container's own
  // loopback address instead of back out through the public proxy.
  const base = process.env.INTERNAL_BASE_URL ?? origin;
  const res = await fetch(`${base.replace(/\/$/, '')}/api/internal/tag-csp`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`tag-csp responded ${res.status}`);
  const data = (await res.json()) as Partial<CspSources>;
  return {
    scriptSrc: data.scriptSrc ?? [],
    connectSrc: data.connectSrc ?? [],
    imgSrc: data.imgSrc ?? [],
    frameSrc: data.frameSrc ?? [],
  };
}

async function getTagSources(origin: string): Promise<CspSources> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.sources;

  // Collapse a stampede: many requests can arrive during a single refresh.
  inFlight ??= fetchTagSources(origin)
    .then((sources) => {
      memo = { at: Date.now(), sources };
      return sources;
    })
    .catch((e) => {
      console.error('[middleware] tag CSP lookup failed', e);
      // Keep serving the last known good list rather than dropping hosts and
      // breaking tracking over a blip. With nothing cached yet, fall back to the
      // base policy — failing closed, which is how a security header should fail.
      if (memo) memo = { at: Date.now(), sources: memo.sources };
      return memo?.sources ?? NO_SOURCES;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Set the policy on a response that is on its way out. `withTags` is false for
 * `/admin`: marketing tags have no business loading on pages that show customer
 * and order data, so those responses keep the untouched baseline.
 */
async function withCsp(res: NextResponse, req: NextRequest, withTags: boolean): Promise<NextResponse> {
  const base = baseCsp();
  const sources = withTags ? await getTagSources(req.nextUrl.origin) : NO_SOURCES;
  // No tags configured → the header is the base string, byte for byte.
  res.headers.set('Content-Security-Policy', hasCspSources(sources) ? appendCspSources(base, sources) : base);
  return res;
}

/**
 * Paths a redirect may never shadow.
 *
 * Checked here as well as on save. A rule on `/checkout` written before this
 * guard existed — or by a direct database edit — would otherwise be a shop that
 * cannot take money, and the middleware is the last place able to refuse it.
 */
function isProtectedPath(pathname: string): boolean {
  return /^\/(admin|api|_next|checkout|cart|my-account)(\/|$)/.test(pathname);
}

/** Tell the Node runtime a rule was used. Failure here is not worth a log line. */
async function recordHit(origin: string, fromPath: string): Promise<void> {
  const base = process.env.INTERNAL_BASE_URL ?? origin;
  await fetch(`${base.replace(/\/$/, '')}/api/internal/redirect-hit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromPath }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const { pathname, search } = req.nextUrl;

  if (!isProtectedPath(pathname)) {
    try {
      const map = await getRedirectMap(req.nextUrl.origin);
      const hit = resolveRedirect(pathname, search, map);
      if (hit) {
        // Counted after the response goes out, never before it: a redirect must
        // not wait on a database round trip, and the Edge cannot reach Prisma.
        ev.waitUntil(recordHit(req.nextUrl.origin, pathname));
        return NextResponse.redirect(new URL(hit.location, req.nextUrl.origin), hit.statusCode);
      }
    } catch (e) {
      // A redirect failure must never take the site down: every request passes
      // through here, so falling through to normal routing is the only safe
      // outcome. The visitor sees the page, or its 404, as they would have.
      console.error('[middleware] redirect resolution failed', e);
    }
  }

  if (pathname.startsWith('/admin')) {
    // The auth guard returns its own response when it redirects an unauthenticated
    // visitor to the sign-in page; otherwise it lets the request continue.
    const guarded = await authMiddleware(req as never, ev as never);
    const res = guarded instanceof NextResponse ? guarded : NextResponse.next();
    return withCsp(res, req, false);
  }

  return withCsp(NextResponse.next(), req, true);
}

export const config = {
  // Everything except static assets and the internal lookup the middleware
  // itself calls — matching that would recurse.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/internal).*)'],
};
