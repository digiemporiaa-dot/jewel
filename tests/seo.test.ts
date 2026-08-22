import { describe, it, expect } from 'vitest';
import {
  canonicalPath, absoluteUrl, absoluteImage, checkCanonical, normaliseBase,
} from '@/lib/seo/url';
import {
  resolveSeo, applyTitleTemplate, auditSeo, duplicateTitles,
  TITLE_LIMIT, DESCRIPTION_LIMIT, type SeoDefaults,
} from '@/lib/seo/resolve';

const SITE = 'https://mayajewellers.in';

const DEFAULTS: SeoDefaults = {
  siteUrl: SITE,
  brandName: 'Maya Jewellers',
  titleTemplate: '%s · Maya Jewellers',
  defaultTitle: 'Maya Jewellers — Fine jewellery, crafted in Delhi',
  defaultDescription: 'Hallmarked gold and diamond jewellery from Delhi.',
  defaultOgImageUrl: '/og-default.jpg',
  indexingEnabled: true,
};

describe('canonical paths', () => {
  it('drops the query string', () => {
    // `?variant=22k` and `?utm_source=meta` are the same page. Letting either
    // become its own canonical splits one product's ranking across many URLs.
    expect(canonicalPath('/p/gold-ring?variant=22k')).toBe('/p/gold-ring');
    expect(canonicalPath('/p/gold-ring?utm_source=meta&utm_campaign=diwali')).toBe('/p/gold-ring');
  });

  it('drops the fragment', () => {
    expect(canonicalPath('/p/gold-ring#reviews')).toBe('/p/gold-ring');
  });

  it('drops a trailing slash, so one page is not two canonicals', () => {
    expect(canonicalPath('/collections/')).toBe('/collections');
    expect(canonicalPath('/collections')).toBe('/collections');
  });

  it('keeps the root as a single slash', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('')).toBe('/');
    expect(canonicalPath('/?utm_source=x')).toBe('/');
  });

  it('adds a leading slash to a bare path', () => {
    expect(canonicalPath('p/gold-ring')).toBe('/p/gold-ring');
  });

  it('builds an absolute URL without doubling the slash', () => {
    expect(absoluteUrl('https://x.example/', '/p/ring')).toBe('https://x.example/p/ring');
    expect(absoluteUrl('https://x.example', '/p/ring')).toBe('https://x.example/p/ring');
    expect(normaliseBase('https://x.example///')).toBe('https://x.example');
  });
});

describe('validating an operator-typed canonical', () => {
  it('accepts a path on this site', () => {
    const res = checkCanonical('/p/gold-ring', SITE);
    expect(res).toEqual({ ok: true, url: `${SITE}/p/gold-ring` });
  });

  it('accepts an absolute URL on this site and normalises it', () => {
    const res = checkCanonical(`${SITE}/p/gold-ring?variant=22k`, SITE);
    expect(res).toEqual({ ok: true, url: `${SITE}/p/gold-ring` });
  });

  it('refuses a URL on another site', () => {
    // The case that matters: an operator pastes a marketplace or competitor
    // listing they were comparing against, and hands them the ranking.
    const res = checkCanonical('https://competitor.example/gold-ring', SITE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/must be on mayajewellers\.in/);
  });

  it('refuses a protocol-relative URL, which is off-site in disguise', () => {
    const res = checkCanonical('//evil.example/page', SITE);
    expect(res.ok).toBe(false);
  });

  it('refuses a non-http scheme', () => {
    expect(checkCanonical('javascript:alert(1)', SITE).ok).toBe(false);
    expect(checkCanonical('data:text/html,x', SITE).ok).toBe(false);
    expect(checkCanonical('ftp://x.example/f', SITE).ok).toBe(false);
  });

  it('refuses nonsense', () => {
    expect(checkCanonical('not a url', SITE).ok).toBe(false);
    expect(checkCanonical('   ', SITE).ok).toBe(false);
  });

  it('is not fooled by a hostname that merely starts the same', () => {
    expect(checkCanonical('https://mayajewellers.in.evil.example/x', SITE).ok).toBe(false);
  });
});

describe('social images', () => {
  it('makes a relative image absolute', () => {
    // Facebook and WhatsApp fetch og:image verbatim; a relative path silently
    // produces no card at all.
    expect(absoluteImage('/uploads/ring.jpg', SITE)).toBe(`${SITE}/uploads/ring.jpg`);
    expect(absoluteImage('uploads/ring.jpg', SITE)).toBe(`${SITE}/uploads/ring.jpg`);
  });

  it('leaves an absolute image alone', () => {
    expect(absoluteImage('https://cdn.example/ring.jpg', SITE)).toBe('https://cdn.example/ring.jpg');
  });

  it('gives a protocol-relative image a scheme', () => {
    expect(absoluteImage('//cdn.example/ring.jpg', SITE)).toBe('https://cdn.example/ring.jpg');
  });

  it('returns null for nothing', () => {
    expect(absoluteImage(null, SITE)).toBeNull();
    expect(absoluteImage('  ', SITE)).toBeNull();
  });
});

describe('the inheritance chain', () => {
  const page = { path: '/p/gold-ring', fallbackTitle: '22K Gold Floral Ring' };

  it('prefers the page-specific title', () => {
    const out = resolveSeo({ ...page, seoTitle: 'Handcrafted 22K Ring' }, DEFAULTS);
    expect(out.title).toBe('Handcrafted 22K Ring');
  });

  it('falls back to the entity name', () => {
    expect(resolveSeo(page, DEFAULTS).title).toBe('22K Gold Floral Ring');
  });

  it('treats a blank override as absent rather than as an empty title', () => {
    expect(resolveSeo({ ...page, seoTitle: '   ' }, DEFAULTS).title).toBe('22K Gold Floral Ring');
  });

  it('walks description from page, to entity, to site default', () => {
    expect(resolveSeo({ ...page, seoDescription: 'Own' }, DEFAULTS).description).toBe('Own');
    expect(resolveSeo({ ...page, fallbackDescription: 'Entity' }, DEFAULTS).description).toBe('Entity');
    expect(resolveSeo(page, DEFAULTS).description).toBe(DEFAULTS.defaultDescription);
  });

  it('prefers a product photo over the site default card', () => {
    const out = resolveSeo({ ...page, fallbackImage: '/uploads/ring.jpg' }, DEFAULTS);
    expect(out.ogImage).toBe(`${SITE}/uploads/ring.jpg`);
  });

  it('never leaves a page with no title at all', () => {
    const bare = resolveSeo({ path: '/x', fallbackTitle: '' }, { ...DEFAULTS, defaultTitle: null });
    expect(bare.title).toBe('Maya Jewellers');
  });
});

describe('the title template', () => {
  it('is applied to the page title', () => {
    expect(resolveSeo({ path: '/x', fallbackTitle: 'Rings' }, DEFAULTS).fullTitle)
      .toBe('Rings · Maya Jewellers');
  });

  it('is ignored when it has no %s', () => {
    // Obeying it would give every page in the site an identical title, which is
    // worse than having no template.
    expect(applyTitleTemplate('Rings', 'Maya Jewellers')).toBe('Rings');
  });

  it('is optional', () => {
    expect(applyTitleTemplate('Rings', null)).toBe('Rings');
  });

  it('leaves the untemplated title available separately', () => {
    const out = resolveSeo({ path: '/x', fallbackTitle: 'Rings' }, DEFAULTS);
    expect(out.title).toBe('Rings');
    expect(out.fullTitle).not.toBe(out.title);
  });
});

describe('the canonical a page ends up with', () => {
  it('is its own path by default', () => {
    expect(resolveSeo({ path: '/p/gold-ring', fallbackTitle: 'R' }, DEFAULTS).canonical)
      .toBe(`${SITE}/p/gold-ring`);
  });

  it('ignores a variant query string', () => {
    // Variant choice lives in component state rather than the URL precisely so
    // one product stays one canonical.
    expect(resolveSeo({ path: '/p/gold-ring?variant=22k', fallbackTitle: 'R' }, DEFAULTS).canonical)
      .toBe(`${SITE}/p/gold-ring`);
  });

  it('honours a stored override', () => {
    const out = resolveSeo(
      { path: '/p/gold-ring-copy', fallbackTitle: 'R', canonicalUrl: '/p/gold-ring' },
      DEFAULTS
    );
    expect(out.canonical).toBe(`${SITE}/p/gold-ring`);
  });

  it('normalises an absolute override to this site', () => {
    const out = resolveSeo(
      { path: '/x', fallbackTitle: 'R', canonicalUrl: `${SITE}/p/gold-ring?utm=1` },
      DEFAULTS
    );
    expect(out.canonical).toBe(`${SITE}/p/gold-ring`);
  });
});

describe('indexing', () => {
  it('is on by default', () => {
    expect(resolveSeo({ path: '/x', fallbackTitle: 'R' }, DEFAULTS).noIndex).toBe(false);
  });

  it('honours a per-page noIndex', () => {
    expect(resolveSeo({ path: '/x', fallbackTitle: 'R', noIndex: true }, DEFAULTS).noIndex).toBe(true);
  });

  it('is overridden site-wide by the master switch', () => {
    // A shop still being set up should not be indexed, whatever each page says.
    const off = { ...DEFAULTS, indexingEnabled: false };
    expect(resolveSeo({ path: '/x', fallbackTitle: 'R', noIndex: false }, off).noIndex).toBe(true);
  });
});

describe('the warnings an operator sees', () => {
  const ok = resolveSeo(
    { path: '/x', fallbackTitle: 'Rings', seoDescription: 'A short description.', fallbackImage: '/a.jpg' },
    { ...DEFAULTS, titleTemplate: null }
  );

  it('says nothing when a page is fine', () => {
    expect(auditSeo(ok)).toEqual([]);
  });

  it('flags a title that will be cut off', () => {
    const long = resolveSeo({ path: '/x', fallbackTitle: 'R'.repeat(TITLE_LIMIT + 5) }, DEFAULTS);
    expect(auditSeo(long).some((w) => w.field === 'title')).toBe(true);
  });

  it('explains what a missing description costs', () => {
    const none = resolveSeo(
      { path: '/x', fallbackTitle: 'R' },
      { ...DEFAULTS, defaultDescription: null }
    );
    const warning = auditSeo(none).find((w) => w.field === 'description');
    expect(warning?.message).toMatch(/write its own snippet/);
  });

  it('flags an over-long description', () => {
    const long = resolveSeo(
      { path: '/x', fallbackTitle: 'R', seoDescription: 'd'.repeat(DESCRIPTION_LIMIT + 1) },
      DEFAULTS
    );
    expect(auditSeo(long).some((w) => w.field === 'description')).toBe(true);
  });

  it('flags a missing social image', () => {
    const none = resolveSeo({ path: '/x', fallbackTitle: 'R' }, { ...DEFAULTS, defaultOgImageUrl: null });
    expect(auditSeo(none).some((w) => w.field === 'ogImage')).toBe(true);
  });

  it('treats a published-but-hidden page as an error, not a nicety', () => {
    const hidden = resolveSeo({ path: '/x', fallbackTitle: 'R', noIndex: true }, DEFAULTS);
    const warning = auditSeo(hidden, { isPublic: true }).find((w) => w.field === 'noIndex');
    expect(warning?.severity).toBe('error');
  });

  it('does not flag noIndex on a page that is not public anyway', () => {
    const hidden = resolveSeo({ path: '/x', fallbackTitle: 'R', noIndex: true }, DEFAULTS);
    expect(auditSeo(hidden, { isPublic: false }).some((w) => w.field === 'noIndex')).toBe(false);
  });
});

describe('duplicate titles across the catalogue', () => {
  it('finds pages competing with each other', () => {
    // Twenty rings all called "Gold Ring" compete for the same query, and it is
    // invisible unless something looks across pages rather than at one.
    const dupes = duplicateTitles([
      { path: '/p/a', title: 'Gold Ring' },
      { path: '/p/b', title: 'Gold Ring' },
      { path: '/p/c', title: 'Diamond Pendant' },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.paths).toEqual(['/p/a', '/p/b']);
  });

  it('ignores case and surrounding space', () => {
    const dupes = duplicateTitles([
      { path: '/p/a', title: 'Gold Ring' },
      { path: '/p/b', title: '  gold ring ' },
    ]);
    expect(dupes).toHaveLength(1);
  });

  it('says nothing when every title is distinct', () => {
    expect(duplicateTitles([{ path: '/p/a', title: 'A' }, { path: '/p/b', title: 'B' }])).toEqual([]);
  });

  it('lists the worst offenders first', () => {
    const dupes = duplicateTitles([
      { path: '/p/a', title: 'Ring' }, { path: '/p/b', title: 'Ring' }, { path: '/p/c', title: 'Ring' },
      { path: '/p/d', title: 'Pendant' }, { path: '/p/e', title: 'Pendant' },
    ]);
    expect(dupes[0]?.paths).toHaveLength(3);
  });
});

describe('the brand appearing twice in a title', () => {
  it('is flagged, because the template already adds it', () => {
    // Seeded titles said "22K Gold Floral Ring — Maya Jewellers", and the
    // template made that "… — Maya Jewellers · Maya Jewellers". Easy to type,
    // invisible until you look at a real browser tab.
    const doubled = resolveSeo(
      { path: '/p/x', fallbackTitle: '22K Gold Floral Ring — Maya Jewellers' },
      DEFAULTS
    );
    const warning = auditSeo(doubled, { brandName: 'Maya Jewellers' })
      .find((w) => w.field === 'title' && w.message.includes('twice'));
    expect(warning).toBeDefined();
  });

  it('is not flagged when the brand appears only once', () => {
    const fine = resolveSeo({ path: '/p/x', fallbackTitle: '22K Gold Floral Ring' }, DEFAULTS);
    expect(
      auditSeo(fine, { brandName: 'Maya Jewellers' }).some((w) => w.message.includes('twice'))
    ).toBe(false);
  });

  it('ignores case, since operators do not type it consistently', () => {
    const doubled = resolveSeo({ path: '/p/x', fallbackTitle: 'Ring — maya jewellers' }, DEFAULTS);
    expect(
      auditSeo(doubled, { brandName: 'Maya Jewellers' }).some((w) => w.message.includes('twice'))
    ).toBe(true);
  });

  it('says nothing when no brand name is supplied to check against', () => {
    const doubled = resolveSeo({ path: '/p/x', fallbackTitle: 'Ring — Maya Jewellers' }, DEFAULTS);
    expect(auditSeo(doubled).some((w) => w.message.includes('twice'))).toBe(false);
  });
});
