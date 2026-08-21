import { describe, it, expect } from 'vitest';
import {
  composeCspWithTags, tagCspSources, enabledTagKeys, appendCspSources,
  hasCspSources, TAG_CSP_SOURCES,
} from '@/lib/marketing/csp';
import { toPublicTagConfig, EMPTY_TAG_CONFIG, type PublicTagConfig } from '@/lib/marketing/tags';
import { baseCsp } from '@/lib/security/csp';

/**
 * The CSP is where this feature silently dies if it is wrong: a correctly pasted
 * GA4 ID with the old policy produces a page that looks perfect and tracks
 * nothing, because the browser blocks the script without disturbing the layout.
 */

const BASE = baseCsp();

function config(overrides: Partial<Record<string, string>>): PublicTagConfig {
  return toPublicTagConfig({ consentMode: 'REQUIRED', ...overrides });
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) return [];
  return found.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

describe('no tags configured', () => {
  it('leaves the policy byte-identical', () => {
    expect(composeCspWithTags(BASE, EMPTY_TAG_CONFIG)).toBe(BASE);
  });

  it('resolves to no hosts at all', () => {
    expect(hasCspSources(tagCspSources(EMPTY_TAG_CONFIG))).toBe(false);
    expect(enabledTagKeys(EMPTY_TAG_CONFIG)).toEqual([]);
  });
});

describe('an enabled tag brings exactly its own hosts', () => {
  it('GA4 adds the tag manager script host and the analytics endpoints', () => {
    const csp = composeCspWithTags(BASE, config({ ga4MeasurementId: 'G-ABCD123456' }));
    expect(directive(csp, 'script-src')).toContain('https://www.googletagmanager.com');
    expect(directive(csp, 'connect-src')).toContain('https://*.google-analytics.com');
    expect(directive(csp, 'connect-src')).toContain('https://*.analytics.google.com');
  });

  it('Meta Pixel adds connect.facebook.net and nothing Google', () => {
    const csp = composeCspWithTags(BASE, config({ metaPixelId: '123456789012345' }));
    expect(directive(csp, 'script-src')).toContain('https://connect.facebook.net');
    expect(directive(csp, 'script-src')).not.toContain('https://www.googletagmanager.com');
  });

  it('Google Ads adds its frame-src for the conversion iframe', () => {
    const csp = composeCspWithTags(BASE, config({ googleAdsId: 'AW-123456789' }));
    expect(directive(csp, 'frame-src')).toContain('https://td.doubleclick.net');
  });

  it('Hotjar adds its websocket origin', () => {
    const csp = composeCspWithTags(BASE, config({ hotjarSiteId: '1234567' }));
    expect(directive(csp, 'connect-src')).toContain('wss://*.hotjar.com');
    expect(directive(csp, 'script-src')).toContain('https://static.hotjar.com');
    expect(directive(csp, 'script-src')).toContain('https://script.hotjar.com');
  });

  it('every provider in the table can be switched on individually', () => {
    const cases: [string, string, keyof typeof TAG_CSP_SOURCES][] = [
      ['gtmId', 'GTM-ABC1234', 'gtm'],
      ['ga4MeasurementId', 'G-ABCD123456', 'ga4'],
      ['googleAdsId', 'AW-123456789', 'googleAds'],
      ['metaPixelId', '123456789012345', 'metaPixel'],
      ['clarityProjectId', 'abc12345', 'clarity'],
      ['hotjarSiteId', '1234567', 'hotjar'],
      ['pinterestTagId', '2612345678901', 'pinterest'],
      ['tiktokPixelId', 'ABCDEFGHIJ1234567890', 'tiktok'],
      ['snapPixelId', '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', 'snap'],
    ];
    for (const [field, value, key] of cases) {
      const csp = composeCspWithTags(BASE, config({ [field]: value }));
      for (const host of TAG_CSP_SOURCES[key].scriptSrc) {
        expect(directive(csp, 'script-src'), `${field} needs ${host}`).toContain(host);
      }
    }
  });
});

describe('a disabled tag brings nothing', () => {
  it('omits the hosts of every provider that is off', () => {
    const csp = composeCspWithTags(BASE, config({ clarityProjectId: 'abc12345' }));
    const scriptSrc = directive(csp, 'script-src');
    expect(scriptSrc).toContain('https://www.clarity.ms');
    expect(scriptSrc).not.toContain('https://connect.facebook.net');
    expect(scriptSrc).not.toContain('https://analytics.tiktok.com');
    expect(scriptSrc).not.toContain('https://sc-static.net');
    expect(directive(csp, 'frame-src')).not.toContain('https://td.doubleclick.net');
  });

  it('does not grant the direct tags hosts they no longer need under GTM', () => {
    // The rendering rule and the policy have to agree: GTM supersedes the direct
    // tags, so their hosts are not granted either. A CSP wider than what the page
    // loads is a permission nobody asked for.
    const csp = composeCspWithTags(
      BASE,
      config({ gtmId: 'GTM-ABC1234', metaPixelId: '123456789012345' })
    );
    expect(directive(csp, 'script-src')).toContain('https://www.googletagmanager.com');
    expect(directive(csp, 'script-src')).not.toContain('https://connect.facebook.net');
  });
});

describe('the baseline cannot be weakened from the admin panel', () => {
  it('keeps every source the base policy already had', () => {
    const csp = composeCspWithTags(BASE, config({ gtmId: 'GTM-ABC1234' }));
    for (const name of ['script-src', 'connect-src', 'img-src', 'frame-src', 'default-src']) {
      for (const source of directive(BASE, name)) {
        expect(directive(csp, name), `${name} lost ${source}`).toContain(source);
      }
    }
  });

  it('never introduces a wildcard script source', () => {
    // Widening script-src to `https:` would remove the protection entirely and
    // reinstate the raw-paste vector through the back door.
    const everything = config({
      gtmId: 'GTM-ABC1234', ga4MeasurementId: 'G-ABCD123456', googleAdsId: 'AW-123456789',
      metaPixelId: '123456789012345', clarityProjectId: 'abc12345', hotjarSiteId: '1234567',
      pinterestTagId: '2612345678901', tiktokPixelId: 'ABCDEFGHIJ1234567890',
      snapPixelId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    });
    const scriptSrc = directive(composeCspWithTags(BASE, everything), 'script-src');
    expect(scriptSrc).not.toContain('https:');
    expect(scriptSrc).not.toContain('*');
    expect(scriptSrc.every((s) => s.startsWith('https://') || s.startsWith("'"))).toBe(true);
  });

  it('never creates a directive the base policy did not declare', () => {
    const names = (csp: string) =>
      csp.split(';').map((d) => d.trim().split(' ')[0]).filter(Boolean);
    const composed = composeCspWithTags(BASE, config({ googleAdsId: 'AW-123456789' }));
    expect(names(composed)).toEqual(names(BASE));
  });

  it('keeps the strict directives untouched', () => {
    const csp = composeCspWithTags(BASE, config({ gtmId: 'GTM-ABC1234' }));
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe('appendCspSources', () => {
  it('does not duplicate a host that is already allowed', () => {
    const once = appendCspSources(BASE, { scriptSrc: ['https://www.googletagmanager.com'], connectSrc: [], imgSrc: [], frameSrc: [] });
    const twice = appendCspSources(once, { scriptSrc: ['https://www.googletagmanager.com'], connectSrc: [], imgSrc: [], frameSrc: [] });
    expect(twice).toBe(once);
    expect(directive(twice, 'script-src').filter((s) => s === 'https://www.googletagmanager.com')).toHaveLength(1);
  });

  it('is a no-op for an empty host list', () => {
    expect(appendCspSources(BASE, { scriptSrc: [], connectSrc: [], imgSrc: [], frameSrc: [] })).toBe(BASE);
  });

  it('skips img-src hosts that a wholesale https: already covers', () => {
    // The base policy allows `img-src ... https:`, so listing individual image
    // hosts there would only lengthen a header sent on every response.
    const csp = composeCspWithTags(BASE, config({ googleAdsId: 'AW-123456789' }));
    expect(directive(csp, 'img-src')).toContain('https:');
    expect(directive(csp, 'img-src')).not.toContain('https://googleads.g.doubleclick.net');
  });
});
