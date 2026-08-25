/**
 * The site's baseline Content-Security-Policy.
 *
 * This used to live in `next.config.mjs`, but headers declared there are fixed
 * once at server start, and marketing tags are database values that change
 * without a redeploy. Since a header set in `next.config.mjs` also wins over one
 * set in middleware, keeping both would leave two policies fighting and the
 * static one silently winning — so the policy now has exactly one owner:
 * `middleware.ts` composes it per request from this base plus the enabled tags.
 *
 * Edge-safe: no imports, no database, no Node built-ins.
 */

/** R2 / S3 hosts for direct browser uploads via presigned URLs. */
function uploadConnectSources(): string[] {
  const out = new Set<string>();
  for (const url of [process.env.R2_ENDPOINT, process.env.R2_PUBLIC_URL]) {
    if (!url) continue;
    try {
      const { hostname } = new URL(url);
      out.add(`https://${hostname}`);
      out.add(`https://*.${hostname}`);
    } catch {
      /* ignore malformed env */
    }
  }
  return [...out];
}

/**
 * Razorpay Checkout and Google Fonts are the only third parties in the baseline.
 * `'unsafe-inline'` on styles is required by Tailwind's runtime-injected styles
 * and the inline JSON-LD script tags.
 *
 * Built lazily rather than as a module constant so the R2 environment variables
 * are read at request time, not at module-evaluation time.
 */
export function baseCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    ["connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com", ...uploadConnectSources()].join(' '),
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

