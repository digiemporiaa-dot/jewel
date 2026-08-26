import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shiprocket's webhook dashboard refuses to save any URL whose text contains
 * these, returning "Address is not allowed". Confirmed against the live form.
 * "sr" and "kr" are two characters, so they turn up by accident easily — which
 * is exactly why this is a test and not a comment on the folder name.
 */
const BANNED = ['shiprocket', 'sr', 'kr'] as const;

const ROOT = join(__dirname, '..');
const ALIAS_DIR = 'app/api/webhooks/logistics';
const ALIAS_PATH = '/api/webhooks/logistics';
const ORIGIN_ROUTE = 'app/api/webhooks/shiprocket/route.ts';

describe('Shiprocket webhook alias path', () => {
  it('exists as a route', () => {
    expect(existsSync(join(ROOT, ALIAS_DIR, 'route.ts'))).toBe(true);
  });

  it.each(BANNED)('the public path does not contain %s', (needle) => {
    expect(ALIAS_PATH.toLowerCase()).not.toContain(needle);
  });

  it('the path the test asserts on is the path the route actually serves', () => {
    // Guards the pair above: renaming the folder without renaming ALIAS_PATH
    // would leave the substring check passing against a string nothing serves.
    expect(`/${ALIAS_DIR.replace(/^app/, '')}`.replace('//', '/')).toBe(ALIAS_PATH);
  });

  it('re-exports the handler instead of copying it', () => {
    const alias = readFileSync(join(ROOT, ALIAS_DIR, 'route.ts'), 'utf8');
    expect(alias).toContain("export { POST } from '../shiprocket/route'");
    // A copy would have to bring these with it. Their absence is the proof
    // there is only one implementation to keep correct.
    expect(alias).not.toContain('export async function POST');
    expect(alias).not.toContain('timingSafeEqual');
    expect(alias).not.toContain('webhookEvent');
  });

  it('leaves the original route in place and still exporting POST', () => {
    const origin = readFileSync(join(ROOT, ORIGIN_ROUTE), 'utf8');
    expect(origin).toContain('export async function POST');
  });

  it('both routes force dynamic rendering', () => {
    // Next reads segment config by static analysis of the segment's own file,
    // so this one cannot be inherited through the re-export.
    for (const file of [join(ALIAS_DIR, 'route.ts'), ORIGIN_ROUTE]) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain("export const dynamic = 'force-dynamic'");
    }
  });
});
