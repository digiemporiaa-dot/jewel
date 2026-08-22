import { describe, it, expect } from 'vitest';
import {
  normalisePath, classifyTarget, checkRule, isReservedPath,
  followChain, wouldLoop, flattenTarget, restitchInbound, parseRedirectCsv,
  MAX_HOPS,
} from '@/lib/redirects/rules';
import { toRedirectMap, resolveRedirect, normaliseForLookup } from '@/lib/redirects/edge';

describe('normalising a path', () => {
  it('folds case, so a link from print still works', () => {
    // A shopper typing from a business card or a QR code gets the case wrong
    // constantly; matching case-sensitively turns a working redirect into a 404
    // for exactly those people.
    expect(normalisePath('/Old-Ring')).toBe('/old-ring');
  });

  it('drops a trailing slash', () => {
    expect(normalisePath('/old-ring/')).toBe('/old-ring');
    expect(normalisePath('/old-ring')).toBe('/old-ring');
  });

  it('drops the query string and fragment', () => {
    expect(normalisePath('/old-ring?utm_source=print')).toBe('/old-ring');
    expect(normalisePath('/old-ring#reviews')).toBe('/old-ring');
  });

  it('adds a missing leading slash', () => {
    expect(normalisePath('old-ring')).toBe('/old-ring');
  });

  it('collapses repeated slashes', () => {
    // `//old//ring` is the same page, and a leading `//` would otherwise read as
    // a protocol-relative URL.
    expect(normalisePath('//old//ring')).toBe('/old/ring');
  });

  it('accepts a full URL and keeps only the path', () => {
    expect(normalisePath('https://mayajewellers.in/old-ring?x=1')).toBe('/old-ring');
  });

  it('keeps the root as a single slash', () => {
    expect(normalisePath('/')).toBe('/');
  });

  it('returns empty for nothing', () => {
    expect(normalisePath('')).toBe('');
    expect(normalisePath('   ')).toBe('');
  });
});

describe('classifying a destination', () => {
  it('recognises a site path', () => {
    expect(classifyTarget('/new-ring')).toBe('internal');
  });

  it('recognises an off-site URL', () => {
    expect(classifyTarget('https://instagram.com/mayajewellers')).toBe('external');
  });

  it('treats a protocol-relative URL as off-site, not as a path', () => {
    expect(classifyTarget('//evil.example/x')).toBe('external');
  });

  it('refuses anything that is not a destination', () => {
    expect(classifyTarget('javascript:alert(1)')).toBe('invalid');
    expect(classifyTarget('data:text/html,x')).toBe('invalid');
    expect(classifyTarget('somewhere')).toBe('invalid');
    expect(classifyTarget('')).toBe('invalid');
  });
});

describe('what cannot be saved', () => {
  const base = { fromPath: '/old', toPath: '/new', statusCode: 301 };

  it('accepts an ordinary rule', () => {
    expect(checkRule(base).ok).toBe(true);
  });

  it('refuses a rule with no source', () => {
    expect(checkRule({ ...base, fromPath: '  ' }).ok).toBe(false);
  });

  it('refuses redirecting the home page', () => {
    // This is the one that takes the whole site down.
    const res = checkRule({ ...base, fromPath: '/' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/whole site down/);
  });

  it('refuses a page pointing at itself', () => {
    const res = checkRule({ fromPath: '/old', toPath: '/old', statusCode: 301 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/loop forever/);
  });

  it('catches self-redirects that differ only by case or trailing slash', () => {
    expect(checkRule({ fromPath: '/Old/', toPath: '/old', statusCode: 301 }).ok).toBe(false);
  });

  it('refuses an unusable destination', () => {
    expect(checkRule({ ...base, toPath: 'javascript:alert(1)' }).ok).toBe(false);
    expect(checkRule({ ...base, toPath: '' }).ok).toBe(false);
  });

  it('refuses a status code that is not 301 or 302', () => {
    expect(checkRule({ ...base, statusCode: 200 }).ok).toBe(false);
    expect(checkRule({ ...base, statusCode: 404 }).ok).toBe(false);
    expect(checkRule({ ...base, statusCode: 302 }).ok).toBe(true);
  });

  it('allows an off-site destination', () => {
    // Legitimate: an old campaign page that now lives on Instagram.
    expect(checkRule({ ...base, toPath: 'https://instagram.com/x' }).ok).toBe(true);
  });
});

describe('paths the application owns', () => {
  it('recognises the ones a redirect must never shadow', () => {
    // A redirect on /checkout would be a shop that cannot take money.
    for (const p of ['/checkout', '/cart', '/admin', '/admin/orders', '/api/enquiry', '/my-account']) {
      expect(isReservedPath(p)).toBe(true);
    }
  });

  it('leaves ordinary paths alone', () => {
    expect(isReservedPath('/p/gold-ring')).toBe(false);
    expect(isReservedPath('/c/rings')).toBe(false);
    // A path that merely starts with the same letters is not reserved.
    expect(isReservedPath('/administrator-guide')).toBe(false);
    expect(isReservedPath('/cartier-style-rings')).toBe(false);
  });
});

describe('following a chain', () => {
  const rules = new Map([
    ['/a', '/b'],
    ['/b', '/c'],
  ]);

  it('lands on the final destination', () => {
    const res = followChain('/a', rules);
    expect(res).toEqual({ kind: 'ok', finalTarget: '/c', hops: 2 });
  });

  it('reports no hops for a path with no rule', () => {
    expect(followChain('/z', rules)).toEqual({ kind: 'ok', finalTarget: '/z', hops: 0 });
  });

  it('stops at an off-site destination', () => {
    const external = new Map([['/a', 'https://instagram.com/x']]);
    expect(followChain('/a', external)).toEqual({
      kind: 'ok', finalTarget: 'https://instagram.com/x', hops: 1,
    });
  });

  it('detects a two-rule loop', () => {
    // The case a naive self-check misses: neither rule points at itself.
    const loop = new Map([['/a', '/b'], ['/b', '/a']]);
    const res = followChain('/a', loop);
    expect(res.kind).toBe('loop');
  });

  it('detects a longer loop', () => {
    const loop = new Map([['/a', '/b'], ['/b', '/c'], ['/c', '/a']]);
    expect(followChain('/a', loop).kind).toBe('loop');
  });

  it('gives up on a chain long enough to be a mistake', () => {
    const long = new Map<string, string>();
    for (let i = 0; i < MAX_HOPS + 2; i++) long.set(`/p${i}`, `/p${i + 1}`);
    expect(followChain('/p0', long).kind).toBe('too-long');
  });
});

describe('adding a rule that would close a loop', () => {
  it('is caught when it points back at the start', () => {
    // A→B exists; somebody adds B→A. Neither rule is self-referential, so a
    // per-rule check passes both and the site bounces forever.
    const existing = new Map([['/a', '/b']]);
    expect(wouldLoop({ fromPath: '/b', toPath: '/a' }, existing)).toBe(true);
  });

  it('is caught around a longer cycle', () => {
    const existing = new Map([['/a', '/b'], ['/b', '/c']]);
    expect(wouldLoop({ fromPath: '/c', toPath: '/a' }, existing)).toBe(true);
  });

  it('allows a rule that merely extends a chain', () => {
    const existing = new Map([['/a', '/b']]);
    expect(wouldLoop({ fromPath: '/b', toPath: '/c' }, existing)).toBe(false);
  });

  it('never reports a loop for an off-site destination', () => {
    const existing = new Map([['/a', '/b']]);
    expect(wouldLoop({ fromPath: '/b', toPath: 'https://x.example/a' }, existing)).toBe(false);
  });
});

describe('flattening', () => {
  it('points a new rule at where the chain actually ends', () => {
    // Search engines lose a little ranking per hop, and each hop is a round trip
    // on a mobile connection.
    const existing = new Map([['/b', '/c']]);
    expect(flattenTarget({ fromPath: '/a', toPath: '/b' }, existing)).toBe('/c');
  });

  it('leaves a direct rule alone', () => {
    expect(flattenTarget({ fromPath: '/a', toPath: '/b' }, new Map())).toBe('/b');
  });

  it('leaves an off-site destination untouched', () => {
    const url = 'https://instagram.com/mayajewellers';
    expect(flattenTarget({ fromPath: '/a', toPath: url }, new Map())).toBe(url);
  });

  it('re-points rules that now aim at a redirected page', () => {
    // Adding B→C turns an existing A→B into a two-hop chain, so A is re-pointed
    // straight at C.
    const existing = new Map([['/a', '/b'], ['/x', '/y']]);
    const updates = restitchInbound({ fromPath: '/b', toPath: '/c' }, existing);
    expect(updates).toEqual([{ fromPath: '/a', toPath: '/c' }]);
  });

  it('does not re-point the rule being added', () => {
    const existing = new Map([['/b', '/old']]);
    expect(restitchInbound({ fromPath: '/b', toPath: '/c' }, existing)).toEqual([]);
  });
});

describe('importing a pasted CSV', () => {
  it('reads the common shape', () => {
    const rows = parseRedirectCsv('/old-ring,/new-ring\n/old-set,/new-set,302');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ok: true, rule: { fromPath: '/old-ring', toPath: '/new-ring', statusCode: 301 } });
    expect(rows[1]).toMatchObject({ ok: true, rule: { statusCode: 302 } });
  });

  it('skips a header row instead of reporting it as broken', () => {
    const rows = parseRedirectCsv('From,To,Status\n/old,/new');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ok).toBe(true);
  });

  it('accepts tabs, since people paste from spreadsheets', () => {
    const rows = parseRedirectCsv('/old\t/new');
    expect(rows[0]).toMatchObject({ ok: true, rule: { fromPath: '/old', toPath: '/new' } });
  });

  it('honours quoted cells', () => {
    const rows = parseRedirectCsv('"/old, comma","/new"');
    expect(rows[0]).toMatchObject({ ok: true, rule: { fromPath: '/old, comma' } });
  });

  it('reports every bad row rather than dropping it', () => {
    // An import of two hundred rules must not silently lose the nine that were
    // malformed.
    const rows = parseRedirectCsv([
      '/good,/fine',
      '/only-one-column',
      '/loop,/loop',
      '/bad,javascript:alert(1)',
      '/,/anywhere',
    ].join('\n'));

    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.ok)).toHaveLength(1);
    expect(rows.filter((r) => !r.ok)).toHaveLength(4);
    // Line numbers are kept so the operator can find the row in their file.
    expect(rows[1]).toMatchObject({ ok: false, line: 2 });
  });

  it('ignores blank lines', () => {
    expect(parseRedirectCsv('/a,/b\n\n\n/c,/d')).toHaveLength(2);
  });

  it('normalises as it reads', () => {
    const rows = parseRedirectCsv('/Old-Ring/,/New-Ring/');
    expect(rows[0]).toMatchObject({ ok: true, rule: { fromPath: '/old-ring', toPath: '/new-ring' } });
  });

  it('keeps an off-site destination as typed', () => {
    const rows = parseRedirectCsv('/old,https://Instagram.com/Maya');
    expect(rows[0]).toMatchObject({ ok: true, rule: { toPath: 'https://Instagram.com/Maya' } });
  });
});

// ── Edge resolution ──────────────────────────────────────────────────────────

describe('the map the middleware holds', () => {
  const map = toRedirectMap([
    { fromPath: '/Old-Ring/', toPath: '/p/new-ring', statusCode: 301 },
    { fromPath: '/sale', toPath: '/c/wedding', statusCode: 302 },
    { fromPath: '/social', toPath: 'https://instagram.com/maya', statusCode: 301 },
    { fromPath: '/tracked', toPath: '/c/rings?ref=print', statusCode: 301 },
  ]);

  it('matches regardless of case and trailing slash', () => {
    expect(resolveRedirect('/old-ring', '', map)?.location).toBe('/p/new-ring');
    expect(resolveRedirect('/OLD-RING/', '', map)?.location).toBe('/p/new-ring');
  });

  it('returns nothing for a path with no rule', () => {
    expect(resolveRedirect('/p/something-else', '', map)).toBeNull();
  });

  it('carries the status code through', () => {
    expect(resolveRedirect('/old-ring', '', map)?.statusCode).toBe(301);
    expect(resolveRedirect('/sale', '', map)?.statusCode).toBe(302);
  });

  it('defaults an unexpected status code to a permanent move', () => {
    const odd = toRedirectMap([{ fromPath: '/a', toPath: '/b', statusCode: 418 }]);
    expect(resolveRedirect('/a', '', odd)?.statusCode).toBe(301);
  });

  it('carries campaign parameters across', () => {
    // Dropping utm_source loses the attribution for every click the shop paid
    // for, which is usually the reason the old link exists at all.
    expect(resolveRedirect('/sale', '?utm_source=meta&utm_campaign=diwali', map)?.location)
      .toBe('/c/wedding?utm_source=meta&utm_campaign=diwali');
  });

  it('does not append to a target that carries its own query', () => {
    expect(resolveRedirect('/tracked', '?utm_source=meta', map)?.location).toBe('/c/rings?ref=print');
  });

  it('sends visitors off-site when that is where the page went', () => {
    expect(resolveRedirect('/social', '', map)?.location).toBe('https://instagram.com/maya');
  });

  it('normalises lookups the same way the rules are stored', () => {
    // The Edge module duplicates normalisePath rather than importing it, to keep
    // Node code off the Edge. This pins the two together.
    for (const p of ['/Old-Ring/', '//a//b/', 'bare', '/x?y=1', '/', '/MiXeD/Case']) {
      expect(normaliseForLookup(p)).toBe(normalisePath(p));
    }
  });
});

// ── Releasing a path ─────────────────────────────────────────────────────────

describe('when a path becomes live again', () => {
  /**
   * The case a live run caught. Rename `/pages/a` to `/pages/b`, then change
   * your mind and rename back. Without releasing the path, the first rule
   * survives and points the now-live `/pages/a` at `/pages/b`, which nothing
   * serves any more — a visitor to the correct URL is sent to a dead one.
   *
   * `releasePath` is server-side, so what is pinned here is the rule it applies:
   * a path a real page occupies cannot also be a redirect source.
   */
  it('cannot also be a redirect source', () => {
    const afterRename = new Map([['/pages/a', '/pages/b']]);

    // Renaming back is refused as a loop, which is correct on its own…
    expect(wouldLoop({ fromPath: '/pages/b', toPath: '/pages/a' }, afterRename)).toBe(true);

    // …but only because the stale rule is still there. Once the path is
    // released, the reverse rule is an ordinary, legal redirect.
    const released = new Map<string, string>();
    expect(wouldLoop({ fromPath: '/pages/b', toPath: '/pages/a' }, released)).toBe(false);
    expect(checkRule({ fromPath: '/pages/b', toPath: '/pages/a', statusCode: 301 }).ok).toBe(true);
  });
});
