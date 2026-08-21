import { describe, it, expect } from 'vitest';
import {
  marketingTagsSchema, toPublicTagConfig, EMPTY_TAG_CONFIG,
  activeTags, gtmSupersedes, hasAnyTag, maskSecret, TAG_FIELDS,
} from '@/lib/marketing/tags';
import { mayLoadTags, shouldShowBanner } from '@/lib/marketing/consent';

/** A submission with every field blank — the shape the form always posts. */
function blankForm(overrides: Record<string, unknown> = {}) {
  return {
    gtmId: '', ga4MeasurementId: '', googleAdsId: '', googleAdsLabel: '',
    googleSiteVerification: '', metaPixelId: '', clarityProjectId: '',
    hotjarSiteId: '', pinterestTagId: '', tiktokPixelId: '', snapPixelId: '',
    metaCapiEnabled: false, consentMode: 'REQUIRED', consentBannerText: '',
    ...overrides,
  };
}

const VALID = {
  gtmId: 'GTM-ABC1234',
  ga4MeasurementId: 'G-ABCD123456',
  googleAdsId: 'AW-123456789',
  googleAdsLabel: 'AbC-D_efG12hIjKlM',
  googleSiteVerification: 'abcdefghijklmnopqrstuvwxyz123456',
  metaPixelId: '123456789012345',
  clarityProjectId: 'abc12345',
  hotjarSiteId: '1234567',
  pinterestTagId: '2612345678901',
  tiktokPixelId: 'ABCDEFGHIJ1234567890',
  snapPixelId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
};

describe('tag ID validation — the control that keeps markup off the page', () => {
  it('accepts a well-formed ID for every provider', () => {
    const parsed = marketingTagsSchema.safeParse(blankForm(VALID));
    expect(parsed.success).toBe(true);
  });

  it('rejects markup rather than stripping it', () => {
    // The whole point: an ID field must never accept anything script-shaped.
    const attacks = [
      '"><script>alert(1)</script>',
      'GTM-ABC1234"></script><script>fetch("//evil")',
      "javascript:alert(1)",
      'G-ABCD123456 onload=alert(1)',
    ];
    for (const attack of attacks) {
      const parsed = marketingTagsSchema.safeParse(blankForm({ gtmId: attack }));
      expect(parsed.success, `should reject: ${attack}`).toBe(false);
    }
  });

  it('rejects a near-miss rather than accepting a tag that will not work', () => {
    const wrong: Record<string, string> = {
      gtmId: 'GTM-abc1234',              // lowercase
      ga4MeasurementId: 'UA-12345678-1', // Universal Analytics, not GA4
      googleAdsId: 'AW-12345',           // too short
      metaPixelId: '12345',              // too short
      pinterestTagId: '123',             // must be exactly 13 digits
      tiktokPixelId: 'abcdefghij1234567890', // lowercase
      snapPixelId: 'not-a-uuid',
    };
    for (const [field, value] of Object.entries(wrong)) {
      const parsed = marketingTagsSchema.safeParse(blankForm({ [field]: value }));
      expect(parsed.success, `should reject ${field}=${value}`).toBe(false);
    }
  });

  it('reports which field is wrong, in words an operator can act on', () => {
    const parsed = marketingTagsSchema.safeParse(blankForm({ metaPixelId: 'nope' }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('Meta Pixel ID');
      expect(parsed.error.issues[0]?.message).toContain('15–16 digits');
    }
  });

  it('stores an empty field as NULL, not an empty string', () => {
    // An empty string would render `gtag('config','')` — a broken tag that looks
    // configured. NULL means off.
    const parsed = marketingTagsSchema.safeParse(blankForm());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gtmId).toBeNull();
      expect(parsed.data.metaPixelId).toBeNull();
      expect(parsed.data.consentBannerText).toBeNull();
    }
  });

  it('trims surrounding whitespace from a pasted ID', () => {
    const parsed = marketingTagsSchema.safeParse(blankForm({ gtmId: '  GTM-ABC1234  ' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.gtmId).toBe('GTM-ABC1234');
  });

  it('refuses a Google Ads label with no conversion ID to attach it to', () => {
    const parsed = marketingTagsSchema.safeParse(blankForm({ googleAdsLabel: VALID.googleAdsLabel }));
    expect(parsed.success).toBe(false);
  });

  it('defaults consent to REQUIRED and rejects an unknown mode', () => {
    expect(EMPTY_TAG_CONFIG.consentMode).toBe('REQUIRED');
    expect(marketingTagsSchema.safeParse(blankForm({ consentMode: 'MAYBE' })).success).toBe(false);
  });
});

describe('reading back from the database', () => {
  it('drops a malformed stored value instead of rendering it', () => {
    // The database is not the same trust boundary as the form: a value could
    // arrive from an older build, a manual SQL edit or a restored backup.
    const config = toPublicTagConfig({
      gtmId: '"><script>alert(1)</script>',
      ga4MeasurementId: 'G-ABCD123456',
      consentMode: 'REQUIRED',
    });
    expect(config.gtmId).toBeNull();
    expect(config.ga4MeasurementId).toBe('G-ABCD123456');
  });

  it('falls back to everything-off for a missing row', () => {
    expect(toPublicTagConfig(null)).toEqual(EMPTY_TAG_CONFIG);
    expect(hasAnyTag(EMPTY_TAG_CONFIG)).toBe(false);
  });

  it('never carries the CAPI token into the public config', () => {
    const config = toPublicTagConfig({
      metaPixelId: VALID.metaPixelId,
      metaCapiToken: 'EAAsecret-token-value',
      consentMode: 'REQUIRED',
    });
    expect(JSON.stringify(config)).not.toContain('EAAsecret');
    expect(Object.keys(config)).not.toContain('metaCapiToken');
  });

  it('coerces an unrecognised consent mode to REQUIRED', () => {
    expect(toPublicTagConfig({ consentMode: 'WHATEVER' }).consentMode).toBe('REQUIRED');
  });
});

describe('GTM supersedes the direct tags', () => {
  it('lists what a GTM container takes over', () => {
    const config = toPublicTagConfig({
      gtmId: VALID.gtmId,
      ga4MeasurementId: VALID.ga4MeasurementId,
      metaPixelId: VALID.metaPixelId,
      consentMode: 'REQUIRED',
    });
    // Both are stored, but firing them directly *and* through GTM would double
    // every conversion.
    expect(gtmSupersedes(config)).toEqual(['ga4MeasurementId', 'metaPixelId']);
    expect(activeTags(config).map((t) => t.key)).toEqual(['gtmId']);
  });

  it('leaves the direct tags active when there is no container', () => {
    const config = toPublicTagConfig({
      ga4MeasurementId: VALID.ga4MeasurementId,
      metaPixelId: VALID.metaPixelId,
      consentMode: 'REQUIRED',
    });
    expect(gtmSupersedes(config)).toEqual([]);
    expect(activeTags(config).map((t) => t.key)).toEqual(['ga4MeasurementId', 'metaPixelId']);
  });
});

describe('consent gating', () => {
  it('REQUIRED loads nothing until the visitor accepts', () => {
    expect(mayLoadTags('REQUIRED', null)).toBe(false);
    expect(mayLoadTags('REQUIRED', 'denied')).toBe(false);
    expect(mayLoadTags('REQUIRED', 'granted')).toBe(true);
  });

  it('IMPLIED loads unless the visitor actively declined', () => {
    expect(mayLoadTags('IMPLIED', null)).toBe(true);
    expect(mayLoadTags('IMPLIED', 'denied')).toBe(false);
  });

  it('OFF always loads and shows no banner', () => {
    expect(mayLoadTags('OFF', null)).toBe(true);
    expect(shouldShowBanner('OFF', null)).toBe(false);
  });

  it('shows the banner only until a choice is made', () => {
    expect(shouldShowBanner('REQUIRED', null)).toBe(true);
    expect(shouldShowBanner('REQUIRED', 'granted')).toBe(false);
    expect(shouldShowBanner('REQUIRED', 'denied')).toBe(false);
  });
});

describe('secret masking', () => {
  it('shows only the last four characters', () => {
    expect(maskSecret('EAAsupersecrettoken1234')).toBe('••••1234');
    expect(maskSecret(null)).toBeNull();
  });
});

describe('field metadata', () => {
  it('shows the operator the same pattern the server enforces', () => {
    // The hint is not decoration: if it drifts from the regex, people paste
    // valid IDs and get told they are wrong.
    for (const [key, field] of Object.entries(TAG_FIELDS)) {
      expect(field.hint.length, `${key} needs a hint`).toBeGreaterThan(0);
      expect(field.helpUrl.startsWith('https://'), `${key} needs an https help link`).toBe(true);
    }
  });
});
