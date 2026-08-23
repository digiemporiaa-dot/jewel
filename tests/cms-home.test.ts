import { describe, it, expect } from 'vitest';
import {
  HOME_SLUG, HOME_BLUEPRINT, HOME_PAGE_TITLE,
  isHomeSlug, storefrontPathForPage, pageKindLabel,
} from '@/lib/cms/home';
import { parseBlockData, BLOCK_SCHEMAS, BLOCK_LABELS } from '@/lib/cms/blocks';
import { parseBlockStyle, resolveBlockStyle, BLOCK_STYLE_CAPABILITIES } from '@/lib/cms/style';

describe('homepage slug', () => {
  it('recognises only the reserved slug', () => {
    expect(isHomeSlug(HOME_SLUG)).toBe(true);
    expect(isHomeSlug('about')).toBe(false);
    expect(isHomeSlug('home-page')).toBe(false);
    expect(isHomeSlug('')).toBe(false);
  });

  it('serves the homepage at / and everything else under /pages', () => {
    expect(storefrontPathForPage(HOME_SLUG)).toBe('/');
    expect(storefrontPathForPage('about')).toBe('/pages/about');
  });

  it('labels the homepage in admin lists and nothing else', () => {
    expect(pageKindLabel(HOME_SLUG)).toBe('Homepage');
    expect(pageKindLabel('about')).toBeNull();
  });
});

describe('homepage blueprint', () => {
  /**
   * The blueprint is what `/` renders on a shop that has never opened the CMS,
   * and what "Set up homepage" copies into the database. A block that fails its
   * own schema would be silently skipped by BlockRenderer — a missing hero on
   * every fresh install, with nothing in a log to say why. So every block is
   * validated here, against the same parser the storefront uses.
   */
  it('every block passes its own content schema', () => {
    for (const block of HOME_BLUEPRINT) {
      const parsed = parseBlockData(block.type, block.data);
      expect(parsed.success, `${block.type}: ${parsed.success ? '' : parsed.error.issues[0]?.message}`).toBe(true);
    }
  });

  it('every block style survives validation unchanged', () => {
    for (const block of HOME_BLUEPRINT) {
      const declared = block.data.style ?? {};
      const kept = parseBlockStyle(block.type, declared);
      // Anything dropped here is a control the type does not offer — a value
      // written in this file that would never take effect.
      expect(Object.keys(kept).sort(), `${block.type}`).toEqual(Object.keys(declared).sort());
    }
  });

  it('resolves to a complete style for every block', () => {
    for (const block of HOME_BLUEPRINT) {
      const style = resolveBlockStyle(block.type, block.data);
      const controls = BLOCK_STYLE_CAPABILITIES[block.type].controls;
      for (const control of controls) {
        expect(style[control], `${block.type}.${control}`).toBeDefined();
      }
    }
  });

  it('uses block types the registry knows about', () => {
    for (const block of HOME_BLUEPRINT) {
      expect(BLOCK_SCHEMAS[block.type]).toBeDefined();
      expect(BLOCK_LABELS[block.type]).toBeDefined();
    }
  });

  it('opens with a hero and offers both calls to action', () => {
    const hero = HOME_BLUEPRINT[0];
    if (!hero) throw new Error('blueprint is empty');
    expect(hero.type).toBe('HERO');
    const parsed = parseBlockData('HERO', hero.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const d = parsed.data as { heading: string; ctaHref: string; ctaHref2: string };
    expect(d.heading.length).toBeGreaterThan(0);
    // Shop the catalogue, or come to the showroom. A jeweller whose business is
    // walk-ins loses the second one if the hero only ever renders one button.
    expect(d.ctaHref).toBe('/c/new-arrivals');
    expect(d.ctaHref2).toBe('/appointments');
  });

  it('shows all three product rows the storefront had before', () => {
    const sources = HOME_BLUEPRINT.filter((b) => b.type === 'PRODUCT_GRID').map((b) => b.data.source);
    expect(sources).toEqual(['new', 'featured', 'bestsellers']);
  });

  it('has a title that is an internal name, not a page title', () => {
    // It shows in the admin list. It must never reach a browser tab — the
    // homepage's `<title>` comes from SEO settings, not from this.
    expect(HOME_PAGE_TITLE).toBe('Homepage');
  });
});

describe('category grid block', () => {
  it('defaults to eight categories and rejects an absurd count', () => {
    const ok = parseBlockData('CATEGORY_GRID', { heading: 'Shop by Category' });
    expect(ok.success).toBe(true);
    if (ok.success) expect((ok.data as { limit: number }).limit).toBe(8);

    expect(parseBlockData('CATEGORY_GRID', { limit: 40 }).success).toBe(false);
    expect(parseBlockData('CATEGORY_GRID', { limit: 1 }).success).toBe(false);
  });
});

describe('product grid extras', () => {
  it('accepts an eyebrow and a view-all link, and defaults them to blank', () => {
    const parsed = parseBlockData('PRODUCT_GRID', { source: 'new', limit: 8 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const d = parsed.data as { eyebrow: string; viewAllHref: string };
    expect(d.eyebrow).toBe('');
    expect(d.viewAllHref).toBe('');
  });
});
