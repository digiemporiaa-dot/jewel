/**
 * URLs for search engines.
 *
 * Small functions, but they carry the whole weight of the feature: a canonical
 * tag is an instruction to a search engine about which URL owns a piece of
 * content, and getting one wrong is how a shop hands its rankings to somebody
 * else. So an operator-supplied canonical is *validated*, not trusted, and the
 * rule is narrow on purpose — same site only.
 *
 * Pure and dependency-free, so every rule here is unit-testable.
 */

/** Strip a trailing slash so `${base}${path}` never doubles up. */
export function normaliseBase(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, '');
}

/**
 * A site-relative path, canonicalised.
 *
 * Query strings and fragments are removed: `/p/ring?variant=22k` and
 * `/p/ring?utm_source=meta` are the same page, and letting either become its own
 * canonical splits the ranking of one product across many URLs. Variant choice
 * lives in component state rather than the URL precisely so this stays true.
 */
export function canonicalPath(path: string): string {
  const withoutQuery = path.split('?')[0]?.split('#')[0] ?? '/';
  if (withoutQuery === '' || withoutQuery === '/') return '/';
  const withLeading = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  // Trailing slashes are dropped so `/collections` and `/collections/` do not
  // become two canonicals for one page.
  return withLeading.replace(/\/+$/, '') || '/';
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${normaliseBase(siteUrl)}${canonicalPath(path)}`;
}

export type CanonicalCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Validate an operator-typed canonical URL.
 *
 * Accepts a site-relative path, or an absolute URL on this site's own origin.
 * Rejects everything else — including a perfectly well-formed URL pointing at
 * another domain, which is the case that matters: pasting a competitor's or a
 * marketplace's URL here tells Google *they* own this page's content. Operators
 * do this by accident, copying from a listing they were comparing against.
 *
 * `javascript:` and `data:` never reach a browser from a `<link rel=canonical>`,
 * but they are rejected anyway rather than stored and rendered.
 */
export function checkCanonical(input: string, siteUrl: string): CanonicalCheck {
  const value = input.trim();
  if (value === '') return { ok: false, reason: 'Empty' };

  const base = normaliseBase(siteUrl);

  if (value.startsWith('/')) {
    // `//evil.example` is protocol-relative — an off-site URL wearing a path's
    // clothing.
    if (value.startsWith('//')) {
      return { ok: false, reason: 'That looks like a link to another website. A canonical URL must point at a page on this site.' };
    }
    return { ok: true, url: `${base}${canonicalPath(value)}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a valid URL. Use a path like /p/gold-ring, or leave it blank.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'A canonical URL must be an http or https address.' };
  }

  let baseHost: string;
  try {
    baseHost = new URL(base).host;
  } catch {
    return { ok: false, reason: 'The site URL is not configured, so a canonical cannot be checked.' };
  }

  if (parsed.host !== baseHost) {
    return {
      ok: false,
      reason: `A canonical URL must be on ${baseHost}. Pointing it at another site tells search engines that site owns this page.`,
    };
  }

  return { ok: true, url: `${base}${canonicalPath(parsed.pathname)}` };
}

/**
 * Absolute URL for an image that may be stored relative.
 *
 * Social scrapers do not resolve relative paths — Facebook and WhatsApp fetch
 * the URL verbatim — so a relative `og:image` silently produces no card at all.
 */
export function absoluteImage(image: string | null | undefined, siteUrl: string): string | null {
  const value = image?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  return `${normaliseBase(siteUrl)}${value.startsWith('/') ? value : `/${value}`}`;
}
