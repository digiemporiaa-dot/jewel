import type { PublicTagConfig } from '@/lib/marketing/tags';
import { hasAnyTag } from '@/lib/marketing/tags';

/**
 * Composing the Content-Security-Policy from the enabled tags.
 *
 * This is the step that otherwise silently breaks the whole feature. The base
 * policy in `next.config.mjs` allows only `'self'` and Razorpay, so a correctly
 * pasted GA4 ID would produce a page that looks perfectly fine and tracks
 * nothing — the failure is invisible because the browser blocks the script and
 * the layout is unaffected.
 *
 * `next.config.mjs` headers are fixed once at server start, but tag IDs are
 * database values that change without a redeploy, so the tag-dependent part of
 * the policy is applied per request in `middleware.ts` instead.
 *
 * Pure and dependency-free so the composition can be tested directly.
 */

export type CspSources = {
  scriptSrc: readonly string[];
  connectSrc: readonly string[];
  imgSrc: readonly string[];
  frameSrc: readonly string[];
};

const NONE: CspSources = { scriptSrc: [], connectSrc: [], imgSrc: [], frameSrc: [] };

/**
 * Hosts each provider needs. Kept as an explicit table rather than a wildcard:
 * widening `script-src` to `https:` would remove the protection entirely and
 * quietly reinstate the raw-script-paste vector through the back door.
 */
export const TAG_CSP_SOURCES = {
  gtm: {
    scriptSrc: ['https://www.googletagmanager.com'],
    connectSrc: ['https://www.googletagmanager.com'],
    imgSrc: [],
    frameSrc: [],
  },
  ga4: {
    scriptSrc: ['https://www.googletagmanager.com'],
    connectSrc: ['https://*.google-analytics.com', 'https://*.analytics.google.com'],
    imgSrc: ['https://*.google-analytics.com'],
    frameSrc: [],
  },
  googleAds: {
    scriptSrc: ['https://www.googletagmanager.com', 'https://www.googleadservices.com'],
    connectSrc: ['https://www.google.com', 'https://www.googleadservices.com'],
    imgSrc: ['https://www.google.com', 'https://googleads.g.doubleclick.net'],
    frameSrc: ['https://td.doubleclick.net'],
  },
  metaPixel: {
    scriptSrc: ['https://connect.facebook.net'],
    connectSrc: ['https://www.facebook.com'],
    imgSrc: ['https://www.facebook.com'],
    frameSrc: [],
  },
  clarity: {
    scriptSrc: ['https://www.clarity.ms'],
    connectSrc: ['https://*.clarity.ms'],
    imgSrc: [],
    frameSrc: [],
  },
  hotjar: {
    scriptSrc: ['https://static.hotjar.com', 'https://script.hotjar.com'],
    connectSrc: ['https://*.hotjar.com', 'wss://*.hotjar.com'],
    imgSrc: [],
    frameSrc: [],
  },
  pinterest: {
    scriptSrc: ['https://s.pinimg.com'],
    connectSrc: ['https://ct.pinterest.com'],
    imgSrc: ['https://ct.pinterest.com'],
    frameSrc: [],
  },
  tiktok: {
    scriptSrc: ['https://analytics.tiktok.com'],
    connectSrc: ['https://analytics.tiktok.com'],
    imgSrc: [],
    frameSrc: [],
  },
  snap: {
    scriptSrc: ['https://sc-static.net'],
    connectSrc: ['https://tr.snapchat.com'],
    imgSrc: [],
    frameSrc: [],
  },
} as const satisfies Record<string, CspSources>;

export type TagCspKey = keyof typeof TAG_CSP_SOURCES;

/**
 * Which providers actually load, given the config.
 *
 * Mirrors the rendering rule exactly: when a GTM container is present the direct
 * Google/Meta tags are not rendered, so their hosts are not granted either. A
 * CSP wider than what the page loads is a permission nobody asked for.
 */
export function enabledTagKeys(config: PublicTagConfig): TagCspKey[] {
  const keys: TagCspKey[] = [];
  const viaGtm = config.gtmId !== null;

  if (viaGtm) keys.push('gtm');
  if (config.ga4MeasurementId && !viaGtm) keys.push('ga4');
  if (config.googleAdsId && !viaGtm) keys.push('googleAds');
  if (config.metaPixelId && !viaGtm) keys.push('metaPixel');

  // Behaviour and social pixels are not GTM-managed here, so they load either
  // way. A client who prefers to run them through GTM simply leaves these blank.
  if (config.clarityProjectId) keys.push('clarity');
  if (config.hotjarSiteId) keys.push('hotjar');
  if (config.pinterestTagId) keys.push('pinterest');
  if (config.tiktokPixelId) keys.push('tiktok');
  if (config.snapPixelId) keys.push('snap');

  return keys;
}

/** Union of the hosts required by the enabled tags. */
export function tagCspSources(config: PublicTagConfig): CspSources {
  const keys = enabledTagKeys(config);
  if (keys.length === 0) return NONE;

  const script = new Set<string>();
  const connect = new Set<string>();
  const img = new Set<string>();
  const frame = new Set<string>();

  for (const key of keys) {
    const s = TAG_CSP_SOURCES[key];
    s.scriptSrc.forEach((v) => script.add(v));
    s.connectSrc.forEach((v) => connect.add(v));
    s.imgSrc.forEach((v) => img.add(v));
    s.frameSrc.forEach((v) => frame.add(v));
  }

  return {
    scriptSrc: [...script],
    connectSrc: [...connect],
    imgSrc: [...img],
    frameSrc: [...frame],
  };
}

const DIRECTIVE_FOR: Record<keyof CspSources, string> = {
  scriptSrc: 'script-src',
  connectSrc: 'connect-src',
  imgSrc: 'img-src',
  frameSrc: 'frame-src',
};

/**
 * Add resolved hosts to an existing policy string.
 *
 * Only ever *appends*, and only to a directive the base policy already declares.
 * It never creates a directive that was absent and never removes a source, so a
 * configuration change can widen the policy exactly as far as the enabled tags'
 * own hosts and no further — the baseline protection cannot be weakened from the
 * admin panel.
 *
 * This is the single implementation; the middleware calls it with hosts it
 * resolved over the network, and `composeCspWithTags` calls it with hosts
 * derived from a config object.
 */
export function appendCspSources(baseCsp: string, sources: CspSources): string {
  const additions = (Object.keys(DIRECTIVE_FOR) as (keyof CspSources)[])
    .map((key) => [DIRECTIVE_FOR[key], sources[key]] as const)
    .filter(([, hosts]) => hosts.length > 0);
  if (additions.length === 0) return baseCsp;

  return baseCsp
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((directive) => {
      const spaceAt = directive.indexOf(' ');
      const name = spaceAt === -1 ? directive : directive.slice(0, spaceAt);

      const addition = additions.find(([directiveName]) => directiveName === name);
      if (!addition) return directive;

      const existing = new Set(directive.slice(name.length).trim().split(/\s+/).filter(Boolean));
      // `img-src` and `connect-src` may already allow `https:` wholesale;
      // restating individual hosts there would only lengthen the header.
      if (existing.has('https:') && (name === 'img-src' || name === 'connect-src')) return directive;

      const missing = addition[1].filter((host) => !existing.has(host));
      return missing.length === 0 ? directive : `${directive} ${missing.join(' ')}`;
    })
    .join('; ');
}

/**
 * Compose the policy for a tag configuration. With nothing configured the input
 * string is returned unchanged, byte for byte.
 */
export function composeCspWithTags(baseCsp: string, config: PublicTagConfig): string {
  if (!hasAnyTag(config)) return baseCsp;
  return appendCspSources(baseCsp, tagCspSources(config));
}

/** True when the resolved host list would change the policy at all. */
export function hasCspSources(sources: CspSources): boolean {
  return (
    sources.scriptSrc.length > 0 ||
    sources.connectSrc.length > 0 ||
    sources.imgSrc.length > 0 ||
    sources.frameSrc.length > 0
  );
}
