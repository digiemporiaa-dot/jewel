import { describe, it, expect } from 'vitest';
import {
  resolveBlockStyle, parseBlockStyle, blockStyleClasses, styleFor,
  syncLegacyFields, styleControlsFor, BLOCK_STYLE_CAPABILITIES,
} from '@/lib/cms/style';
import type { CmsBlockType } from '@prisma/client';

const ALL_TYPES = Object.keys(BLOCK_STYLE_CAPABILITIES) as CmsBlockType[];

describe('block style — backwards compatibility', () => {
  it('resolves a complete style for a block that has never been styled', () => {
    for (const type of ALL_TYPES) {
      const style = resolveBlockStyle(type, { heading: 'x' });
      expect(Object.values(style).every((v) => v !== undefined)).toBe(true);
    }
  });

  it('keeps the backgrounds the blocks originally shipped with', () => {
    // These three rendered on a coloured ground before styles existed; the rest
    // were transparent. Getting this wrong shifts every published page.
    expect(resolveBlockStyle('HERO', {}).background).toBe('paper-2');
    expect(resolveBlockStyle('CTA', {}).background).toBe('velvet');
    expect(resolveBlockStyle('BANNER', {}).background).toBe('velvet');
    expect(resolveBlockStyle('RICH_TEXT', {}).background).toBe('none');
    expect(resolveBlockStyle('FAQ', {}).background).toBe('none');
  });

  it('keeps the column counts the grids originally shipped with', () => {
    expect(resolveBlockStyle('TRUST_ROW', {}).columns).toBe(4);
    expect(resolveBlockStyle('COLLECTION_GRID', {}).columns).toBe(3);
    expect(resolveBlockStyle('TESTIMONIALS', {}).columns).toBe(3);
  });

  it('seeds from the legacy content field rather than overriding it', () => {
    // A page saved before this feature stored alignment inside its content.
    expect(resolveBlockStyle('RICH_TEXT', { align: 'center' }).align).toBe('center');
    expect(resolveBlockStyle('IMAGE_TEXT', { imagePosition: 'right' }).mediaSide).toBe('right');
    expect(resolveBlockStyle('BANNER', { tone: 'paper' }).background).toBe('paper-2');
  });

  it('lets an explicit style win over the legacy field', () => {
    const style = resolveBlockStyle('IMAGE_TEXT', { imagePosition: 'left', style: { mediaSide: 'right' } });
    expect(style.mediaSide).toBe('right');
  });

  it('writes the style back onto the legacy field so the two cannot drift', () => {
    const style = resolveBlockStyle('BANNER', { tone: 'velvet', style: { background: 'paper-2' } });
    expect(syncLegacyFields('BANNER', { text: 'hi', tone: 'velvet' }, style)).toMatchObject({ tone: 'paper' });

    const rich = resolveBlockStyle('RICH_TEXT', { align: 'left', style: { align: 'center' } });
    expect(syncLegacyFields('RICH_TEXT', { body: 'x', align: 'left' }, rich)).toMatchObject({ align: 'center' });
  });
});

describe('block style — validation', () => {
  it('falls back to defaults instead of throwing on junk', () => {
    const style = resolveBlockStyle('HERO', { style: { background: 'neon', spacing: 42, align: null } });
    expect(style.background).toBe('paper-2'); // HERO's default, not 'neon'
    expect(style.spacing).toBe('normal');
    expect(style.align).toBe('left');
  });

  it('survives a style that is not an object at all', () => {
    expect(() => resolveBlockStyle('FAQ', { style: 'purple' })).not.toThrow();
    expect(resolveBlockStyle('FAQ', { style: 'purple' }).align).toBe('center');
  });

  it('strips controls the block type does not offer', () => {
    // A FAQ has no image, so a mediaSide must never be persisted onto one.
    const stored = parseBlockStyle('FAQ', { align: 'left', mediaSide: 'right', columns: 4 });
    expect(stored).toEqual({ align: 'left' });
  });

  it('only offers mediaSide where there is media to place', () => {
    expect(styleControlsFor('IMAGE_TEXT')).toContain('mediaSide');
    for (const type of ALL_TYPES.filter((t) => t !== 'IMAGE_TEXT')) {
      expect(styleControlsFor(type)).not.toContain('mediaSide');
    }
  });
});

describe('block style — class mapping', () => {
  it('switches text to light on a velvet background', () => {
    const s = styleFor('RICH_TEXT', { style: { background: 'velvet' } });
    expect(s.isDark).toBe(true);
    expect(s.section).toContain('bg-velvet');
    // Headings carry an explicit dark colour in globals.css, so inheriting is
    // not enough — the override has to be present.
    expect(s.heading).toBe('text-paper');
    expect(s.muted).toBe('text-paper/70');
    expect(s.border).toContain('paper');
  });

  it('leaves light backgrounds with the default ink colours', () => {
    const s = styleFor('RICH_TEXT', { style: { background: 'paper-2' } });
    expect(s.isDark).toBe(false);
    expect(s.heading).toBe('');
    expect(s.muted).toBe('text-ink-soft');
  });

  it('emits only complete literal class names', () => {
    // Tailwind cannot see a class built by interpolation, so one would silently
    // be absent from the production stylesheet.
    for (const type of ALL_TYPES) {
      for (const background of ['none', 'paper-2', 'velvet', 'brass-tint'] as const) {
        const s = blockStyleClasses(type, { ...resolveBlockStyle(type, {}), background });
        const all = [s.section, s.inner, s.align, s.heading, s.muted, s.border, s.divide, s.columns].join(' ');
        expect(all).not.toMatch(/\$\{|undefined|NaN|\[object/);
      }
    }
  });

  it('gives every type a non-empty inner spacing class', () => {
    for (const type of ALL_TYPES) {
      for (const spacing of ['compact', 'normal', 'roomy'] as const) {
        const s = blockStyleClasses(type, { ...resolveBlockStyle(type, {}), spacing });
        expect(s.inner.trim()).not.toBe('');
        expect(s.inner).toMatch(/py-/);
      }
    }
  });
});
