/**
 * Redirect resolution for the Edge middleware.
 *
 * Edge-safe: no Prisma, no `server-only`, no Node built-ins. The map is fetched
 * from an internal route handler and memoised per isolate, exactly as the
 * marketing-tag CSP host list is.
 *
 * The resolver itself is exported separately from the fetching so the matching
 * rules can be unit-tested without a server.
 */

export type EdgeRule = { fromPath: string; toPath: string; statusCode: number };
export type RedirectMap = Map<string, { toPath: string; statusCode: number }>;

/** Same normalisation the rules are stored with. Duplicated rather than
 *  imported so this module has no dependency that might drag Node code onto the
 *  Edge; the shared behaviour is pinned by a test that compares the two. */
export function normaliseForLookup(pathname: string): string {
  let path = pathname.split('?')[0]?.split('#')[0] ?? '';
  if (path === '') return '';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return (path || '/').toLowerCase();
}

export function toRedirectMap(rules: EdgeRule[]): RedirectMap {
  const map: RedirectMap = new Map();
  for (const rule of rules) {
    map.set(normaliseForLookup(rule.fromPath), {
      toPath: rule.toPath,
      statusCode: rule.statusCode === 302 ? 302 : 301,
    });
  }
  return map;
}

export type Resolution = { location: string; statusCode: number } | null;

/**
 * Where should this request go?
 *
 * The incoming query string is carried across, because it usually holds the
 * campaign parameters that justify the link existing at all: sending
 * `/diwali-sale?utm_source=meta` to `/c/wedding` without the `utm_source` loses
 * the attribution for every click the shop paid for. A query already on the
 * rule's own target wins, since that was written deliberately.
 */
export function resolveRedirect(
  pathname: string,
  search: string,
  map: RedirectMap
): Resolution {
  const hit = map.get(normaliseForLookup(pathname));
  if (!hit) return null;

  const target = hit.toPath;
  const incoming = search.startsWith('?') ? search.slice(1) : search;

  if (incoming === '') return { location: target, statusCode: hit.statusCode };
  // Do not append to a target that already carries its own query.
  if (target.includes('?')) return { location: target, statusCode: hit.statusCode };

  return { location: `${target}?${incoming}`, statusCode: hit.statusCode };
}

// ── Fetching and memoising ───────────────────────────────────────────────────

/**
 * How long a change takes to reach the Edge. The same trade the CSP makes: an
 * admin's edit is live within this window rather than instantly, in exchange for
 * not querying on every request to the site.
 */
const TTL_MS = 30_000;

let memo: { at: number; map: RedirectMap } | null = null;
let inFlight: Promise<RedirectMap> | null = null;

async function fetchMap(origin: string): Promise<RedirectMap> {
  const base = process.env.INTERNAL_BASE_URL ?? origin;
  const res = await fetch(`${base.replace(/\/$/, '')}/api/internal/redirects`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`redirects responded ${res.status}`);
  const data = (await res.json()) as { rules?: EdgeRule[] };
  return toRedirectMap(data.rules ?? []);
}

export async function getRedirectMap(origin: string): Promise<RedirectMap> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.map;

  inFlight ??= fetchMap(origin)
    .then((map) => {
      memo = { at: Date.now(), map };
      return map;
    })
    .catch((e) => {
      console.error('[middleware] redirect lookup failed', e);
      // Keep the last known good map rather than dropping every redirect over a
      // blip. With nothing cached, an empty map means renamed pages 404 — bad,
      // but the site keeps serving, which is the right way for this to fail.
      if (memo) memo = { at: Date.now(), map: memo.map };
      return memo?.map ?? new Map();
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
