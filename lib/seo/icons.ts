import type { Metadata } from 'next';

/**
 * The browser-tab icon, from settings.
 *
 * Split out of the root layout so it can be asserted directly. The rule it
 * encodes is small but easy to get backwards: an unset favicon must produce
 * *no* `icons` key at all, so Next falls back to whatever `app/icon` or
 * `favicon.ico` the build ships. Emitting `icon: null`, or an empty string,
 * gives every page a `<link rel="icon" href="">` that resolves to the current
 * URL — a request for the page itself, returned as HTML, which browsers show as
 * a blank tab icon. A missing icon is better than a broken one.
 */
export function faviconMetadata(faviconUrl: string | null | undefined): Metadata['icons'] | undefined {
  const url = faviconUrl?.trim();
  if (!url) return undefined;
  return { icon: url, shortcut: url, apple: url };
}
