/**
 * Resolving what a page tells search engines and social networks.
 *
 * One chain, applied everywhere: **the page's own value, then the entity it
 * describes, then the site-wide default.** A page never ends up with no title
 * and no description, because a search engine with nothing to work from invents
 * a snippet, and it is rarely the one the shop would have chosen.
 *
 * Pure — no database, no `next/*` — so the precedence rules and the length
 * limits are testable without rendering anything.
 */

import { absoluteImage, absoluteUrl, canonicalPath, normaliseBase } from '@/lib/seo/url';

/** Site-wide defaults, from the SeoSettings row. */
export type SeoDefaults = {
  siteUrl: string;
  brandName: string;
  titleTemplate: string | null;
  defaultTitle: string | null;
  defaultDescription: string | null;
  defaultOgImageUrl: string | null;
  /** The shop's own handle, for `twitter:site`. */
  twitterHandle: string | null;
  /** Master switch. Off means every page sends `noindex`. */
  indexingEnabled: boolean;
};

/** What one page or entity says about itself. */
export type SeoInput = {
  /** Site-relative path this page lives at, e.g. `/p/gold-ring`. */
  path: string;
  /** The page's own H1 or name, used when there is no seoTitle. */
  fallbackTitle: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  /** The entity's own description, one step better than the site default. */
  fallbackDescription?: string | null;
  ogImageUrl?: string | null;
  /** The entity's own image — a product photo makes a better card than a logo. */
  fallbackImage?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean | null;
};

export type ResolvedSeo = {
  /** The page's own title, before the site template is applied. */
  title: string;
  /** Title with the template applied — what actually appears in a tab. */
  fullTitle: string;
  description: string | null;
  canonical: string;
  ogImage: string | null;
  /** True when this page must not be indexed. */
  noIndex: boolean;
};

/** Google truncates around here; past it the tail is invisible. */
export const TITLE_LIMIT = 60;
export const DESCRIPTION_LIMIT = 160;

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Apply the site's title template.
 *
 * A template without `%s` would give every page in the site the same title,
 * which is worse than having no template, so it is ignored rather than obeyed.
 * The admin refuses to save one, but this is the path that runs against data
 * already in the database.
 */
export function applyTitleTemplate(title: string, template: string | null): string {
  if (!template || !template.includes('%s')) return title;
  return template.replace('%s', title);
}

export function resolveSeo(input: SeoInput, defaults: SeoDefaults): ResolvedSeo {
  const title =
    firstNonEmpty(input.seoTitle, input.fallbackTitle, defaults.defaultTitle, defaults.brandName) ??
    defaults.brandName;

  const description = firstNonEmpty(
    input.seoDescription,
    input.fallbackDescription,
    defaults.defaultDescription
  );

  const ogImage = absoluteImage(
    firstNonEmpty(input.ogImageUrl, input.fallbackImage, defaults.defaultOgImageUrl),
    defaults.siteUrl
  );

  // An override is used as-is; it was validated when it was saved. Anything else
  // is the page's own path, with query and fragment stripped.
  const canonical = input.canonicalUrl?.trim()
    ? canonicalise(input.canonicalUrl, defaults.siteUrl)
    : absoluteUrl(defaults.siteUrl, input.path);

  return {
    title,
    fullTitle: applyTitleTemplate(title, defaults.titleTemplate),
    description,
    canonical,
    ogImage,
    // The site-wide switch wins: when indexing is off, nothing is indexable,
    // whatever an individual page says.
    noIndex: !defaults.indexingEnabled || Boolean(input.noIndex),
  };
}

/**
 * Whether a stored canonical names a different host from this site's.
 *
 * `canonicalise` silently rewrites one to this origin, which is the safe
 * behaviour but leaves the operator believing a value is in force that is not.
 * The admin surfaces this so the discrepancy is visible rather than invisible.
 */
export function canonicalOffSite(value: string | null | undefined, siteUrl: string): boolean {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed.startsWith('/')) return false;
  try {
    return new URL(trimmed).host !== new URL(normaliseBase(siteUrl)).host;
  } catch {
    return false;
  }
}

/** Normalise a stored canonical, which may be relative or absolute. */
function canonicalise(value: string, siteUrl: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) return absoluteUrl(siteUrl, trimmed);
  try {
    const parsed = new URL(trimmed);
    return `${normaliseBase(siteUrl)}${canonicalPath(parsed.pathname)}`;
  } catch {
    // Unparseable values should have been rejected on save; falling back to the
    // site root would be worse than ignoring the override.
    return absoluteUrl(siteUrl, '/');
  }
}

// ── Warnings for the admin ───────────────────────────────────────────────────

export type SeoWarning = {
  field: 'title' | 'description' | 'ogImage' | 'canonical' | 'noIndex';
  severity: 'error' | 'warning';
  message: string;
};

/**
 * What is wrong with this page's SEO, in the operator's terms.
 *
 * Every message says what the consequence is, not just what the rule is —
 * "Google will write its own snippet" is actionable in a way that "description
 * is empty" is not.
 */
export function auditSeo(
  resolved: ResolvedSeo,
  options: { isPublic?: boolean; brandName?: string; rejectedCanonical?: boolean } = {}
): SeoWarning[] {
  const { isPublic = true, brandName, rejectedCanonical = false } = options;
  const warnings: SeoWarning[] = [];

  // The template already appends the brand, so a title that names it too comes
  // out as "Gold Ring — Maya Jewellers · Maya Jewellers". Easy to type, and
  // invisible until you look at a real tab.
  if (brandName && countOccurrences(resolved.fullTitle, brandName) > 1) {
    warnings.push({
      field: 'title',
      severity: 'warning',
      message: `The title contains "${brandName}" twice, because your title template already adds it. Drop it from the page title.`,
    });
  }

  if (resolved.fullTitle.length > TITLE_LIMIT) {
    warnings.push({
      field: 'title',
      severity: 'warning',
      message: `Title is ${resolved.fullTitle.length} characters. Google shows about ${TITLE_LIMIT}, so the end will be cut off.`,
    });
  }

  if (!resolved.description) {
    warnings.push({
      field: 'description',
      severity: 'warning',
      message: 'No description. Google will write its own snippet from the page, and it is rarely the one you would choose.',
    });
  } else if (resolved.description.length > DESCRIPTION_LIMIT) {
    warnings.push({
      field: 'description',
      severity: 'warning',
      message: `Description is ${resolved.description.length} characters. About ${DESCRIPTION_LIMIT} are shown.`,
    });
  }

  if (!resolved.ogImage) {
    warnings.push({
      field: 'ogImage',
      severity: 'warning',
      message: 'No social image. Shared on WhatsApp or Instagram this link will appear as plain text.',
    });
  }

  // A canonical the resolver refused is worse than none: the operator believes
  // it is set, and the page is quietly self-canonicalising instead.
  if (rejectedCanonical) {
    warnings.push({
      field: 'canonical',
      severity: 'error',
      message: 'The canonical URL points at another site, so it was ignored. A canonical naming somebody else\'s domain tells Google this page is a copy of theirs.',
    });
  }

  if (isPublic && resolved.noIndex) {
    warnings.push({
      field: 'noIndex',
      severity: 'error',
      message: 'This page is published but hidden from search results.',
    });
  }

  return warnings;
}

/** Case-insensitive count of one string inside another. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

/**
 * Titles that more than one page is using.
 *
 * Duplicate titles are the most common self-inflicted SEO problem in a
 * catalogue — twenty rings all called "Gold Ring" compete with each other — and
 * it is invisible unless something looks across pages rather than at one.
 */
export function duplicateTitles(
  pages: { path: string; title: string }[]
): { title: string; paths: string[] }[] {
  const byTitle = new Map<string, string[]>();
  for (const page of pages) {
    const key = page.title.trim().toLowerCase();
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), page.path]);
  }

  return [...byTitle.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([, paths]) => ({ title: pages.find((p) => paths.includes(p.path))?.title ?? '', paths }))
    .sort((a, b) => b.paths.length - a.paths.length);
}
