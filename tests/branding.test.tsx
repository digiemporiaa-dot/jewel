/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import BrandMark from '@/components/layout/BrandMark';
import { faviconMetadata } from '@/lib/seo/icons';

vi.mock('server-only', () => ({}));

afterEach(cleanup);

const BRAND = 'Maya Jewellers';

describe('the brand mark', () => {
  it('renders the wordmark when there is no logo', () => {
    render(<BrandMark brandName={BRAND} logoUrl={null} height={40} />);
    expect(screen.getByText(BRAND)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders an image once a logo is set', () => {
    render(<BrandMark brandName={BRAND} logoUrl="https://cdn.example.com/logo.png" height={40} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/logo.png');
  });

  it('uses the brand name as the alt text', () => {
    // The brand name keeps its job: it is what a screen reader reads and what
    // shows if the file 404s.
    render(<BrandMark brandName={BRAND} logoUrl="https://cdn.example.com/logo.png" height={40} />);
    expect(screen.getByAltText(BRAND)).toBeTruthy();
  });

  it('treats a blank or whitespace address as no logo', () => {
    render(<BrandMark brandName={BRAND} logoUrl="   " height={40} />);
    expect(screen.getByText(BRAND)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('constrains the height and leaves the width to the artwork', () => {
    // Constraining the width instead would squash a wide wordmark and balloon
    // a tall crest — the operator supplies whatever ratio the brand has.
    render(<BrandMark brandName={BRAND} logoUrl="https://cdn.example.com/logo.png" height={40} />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.style.height).toBe('40px');
    expect(img.style.width).toBe('auto');
  });

  it('reserves the same vertical space with and without a logo', () => {
    // Otherwise a logo arriving late pushes the nav — and the page — down.
    const { container: withLogo } = render(
      <BrandMark brandName={BRAND} logoUrl="https://cdn.example.com/logo.png" height={40} />
    );
    const a = (withLogo.firstElementChild as HTMLElement).style;
    cleanup();
    const { container: without } = render(<BrandMark brandName={BRAND} logoUrl={null} height={40} />);
    const b = (without.firstElementChild as HTMLElement).style;
    expect(a.height).toBe('40px');
    expect(b.minHeight).toBe('40px');
  });
});

describe('the favicon in page metadata', () => {
  it('reflects the configured address', () => {
    expect(faviconMetadata('https://cdn.example.com/icon.png')).toEqual({
      icon: 'https://cdn.example.com/icon.png',
      shortcut: 'https://cdn.example.com/icon.png',
      apple: 'https://cdn.example.com/icon.png',
    });
  });

  it('omits the key entirely when unset, rather than emitting an empty one', () => {
    // `icon: ''` resolves to the current URL, so the browser requests the page
    // as its own icon and shows a blank tab. Better to keep the built-in.
    for (const value of [null, undefined, '', '   ']) {
      expect(faviconMetadata(value)).toBeUndefined();
    }
  });
});

describe('the header and footer actually use it', () => {
  const header = readFileSync(join(__dirname, '..', 'components/layout/Header.tsx'), 'utf8');
  const footer = readFileSync(join(__dirname, '..', 'components/layout/Footer.tsx'), 'utf8');

  it('renders a brand mark in both header layouts', () => {
    // There are two Link blocks — a mobile row and a desktop one — and wiring
    // only the one you happen to be looking at is the easy mistake here.
    expect(header.match(/<BrandMark/g) ?? []).toHaveLength(2);
    expect(header.match(/logoUrl=\{store\.logoUrl\}/g) ?? []).toHaveLength(2);
  });

  it('never prints the brand name as bare text in the header any more', () => {
    // `brandName={store.brandName}` on BrandMark and MobileMenu is fine; a
    // `{store.brandName}` interpolated straight into markup is the old wordmark.
    expect(header).not.toMatch(/>\s*\{store\.brandName\}\s*</);
  });

  it('prefers the dark logo in the footer and falls back to the light one', () => {
    expect(footer).toContain('logoUrl={store.logoUrlDark ?? store.logoUrl}');
  });

  it('keeps the logo a link to the home page', () => {
    for (const source of [header, footer]) {
      const marks = source.split('<BrandMark');
      // Every BrandMark is preceded by an unclosed <Link href="/">.
      for (const before of marks.slice(0, -1)) {
        expect(before.lastIndexOf('<Link href="/"')).toBeGreaterThan(before.lastIndexOf('</Link>'));
      }
    }
  });
});

describe('the admin catches a bad logo before it ships', () => {
  const form = readFileSync(join(__dirname, '..', 'app/admin/(protected)/settings/SettingsForm.tsx'), 'utf8');
  const preview = readFileSync(join(__dirname, '..', 'components/admin/LogoPreview.tsx'), 'utf8');

  it('uploads through the shared image field rather than a pasted URL only', () => {
    expect(form).toContain('name="logoUrl"');
    expect(form).toContain('name="logoUrlDark"');
    expect(form).toContain('<ImageUploadField');
  });

  it('previews both logos on a light and a dark swatch', () => {
    expect(form).toContain('<LogoPreview url={logoUrl}');
    expect(form).toContain('<LogoPreview url={logoUrlDark}');
    expect(preview).toContain("tone=\"light\"");
    expect(preview).toContain("tone=\"dark\"");
  });

  it('warns about an image too small for the header', () => {
    expect(preview).toContain('MIN_LONG_EDGE = 200');
    expect(preview).toContain('will look soft in the header');
  });
});
