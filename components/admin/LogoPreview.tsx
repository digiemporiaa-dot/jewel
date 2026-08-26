'use client';

import { useEffect, useState } from 'react';

/**
 * The logo, shown on the two backgrounds it will actually appear on.
 *
 * A logo is uploaded once, against whatever the admin form happens to be — and
 * the admin is white. A mark drawn in deep green passes that inspection and
 * then vanishes on the velvet footer, where nobody is looking. Showing both
 * surfaces at upload time turns a production bug into a thing the operator
 * notices in the second before they press Save.
 *
 * It also measures the file. A logo under ~200px on its long edge is visibly
 * soft in a 40px-tall header on any modern display, and on a jewellery site the
 * logo is the first thing a customer forms an opinion about.
 */

/** Below this on the long edge, a logo will look soft in the header. */
export const MIN_LONG_EDGE = 200;

type Size = { width: number; height: number };

export default function LogoPreview({ url, label }: { url: string; label: string }) {
  const src = url.trim();
  /**
   * One piece of state, stamped with the address it describes.
   *
   * Clearing it at the top of the effect would be a synchronous `setState`
   * during an effect, which React 19 rightly refuses — and it is unnecessary:
   * a result carrying a stale `src` is simply ignored at render, so measurements
   * for a previous logo can never be shown against a new one.
   */
  const [probed, setProbed] = useState<{ src: string; size: Size | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!src) return;
    // Measured off a detached Image rather than a rendered one, so the natural
    // dimensions are read once however many swatches show the file.
    let live = true;
    const probe = new Image();
    probe.onload = () => {
      if (live) setProbed({ src, size: { width: probe.naturalWidth, height: probe.naturalHeight }, failed: false });
    };
    probe.onerror = () => { if (live) setProbed({ src, size: null, failed: true }); };
    probe.src = src;
    return () => { live = false; };
  }, [src]);

  if (!src) return null;

  const current = probed?.src === src ? probed : null;
  const size = current?.size ?? null;
  const failed = current?.failed ?? false;

  const longEdge = size ? Math.max(size.width, size.height) : null;
  // An SVG reports 0×0 in some browsers and its viewBox in others; either way
  // it is resolution-independent and must never be called blurry.
  const vector = /\.svgx?($|\?)/i.test(src);
  const tooSmall = !vector && longEdge !== null && longEdge > 0 && longEdge < MIN_LONG_EDGE;

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft">{label} — on both backgrounds it has to survive</p>
      <div className="grid grid-cols-2 gap-2">
        <Swatch src={src} tone="light" />
        <Swatch src={src} tone="dark" />
      </div>

      {failed && (
        <p className="text-xs text-red-600">That address is not loading. Check it before saving.</p>
      )}

      {size && (
        <p className="text-xs text-ink-soft">
          {size.width} × {size.height} px
        </p>
      )}

      {tooSmall && (
        <p role="status" className="border border-brass/50 bg-brass/5 px-2 py-1.5 text-xs text-ink">
          This image is only {longEdge}px on its long edge. It will look soft in the header —
          upload one at least {MIN_LONG_EDGE}px, or an SVG, which stays sharp at any size.
        </p>
      )}
    </div>
  );
}

function Swatch({ src, tone }: { src: string; tone: 'light' | 'dark' }) {
  const dark = tone === 'dark';
  return (
    <div
      className={[
        'grid h-16 place-items-center border px-3',
        // Two complete class sets — Tailwind cannot see an interpolated one.
        dark ? 'border-velvet bg-velvet' : 'border-line bg-paper',
      ].join(' ')}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-10 w-auto max-w-full object-contain" />
      <span className="sr-only">{dark ? 'On the footer background' : 'On the header background'}</span>
    </div>
  );
}
