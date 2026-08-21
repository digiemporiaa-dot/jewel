// Hosts allowed through next/image. On Vercel a wildcard turns the image
// optimizer into an open proxy that anyone can bill to your account, so the list
// is derived from the buckets/CDNs this store actually serves from. Add more with
// IMAGE_HOSTS="cdn.example.com,images.example.net".
function imageRemotePatterns() {
  const hosts = new Set();
  for (const raw of (process.env.IMAGE_HOSTS ?? '').split(',')) {
    const h = raw.trim();
    if (h) hosts.add(h);
  }
  for (const url of [process.env.R2_PUBLIC_URL, process.env.R2_ENDPOINT]) {
    if (!url) continue;
    try { hosts.add(new URL(url).hostname); } catch { /* ignore malformed env */ }
  }
  // No storage configured yet (fresh install / local dev) — stay permissive so
  // seeded and externally hosted images still render.
  if (hosts.size === 0) return [{ protocol: 'https', hostname: '**' }];
  return [...hosts].map((hostname) => ({ protocol: 'https', hostname }));
}

/**
 * Hosts the browser is allowed to talk to directly. Image uploads use presigned
 * PUTs straight to R2, so the bucket host has to be in `connect-src` or the CSP
 * blocks the request before it leaves the page. R2 addresses buckets as
 * subdomains (bucket.account.r2.cloudflarestorage.com), hence the wildcard.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone produces the self-contained server the Dockerfile runs. Vercel
  // builds its own serverless output and does not want it.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  experimental: {
    // Keep server actions body limit modest; large uploads use presigned URLs.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: imageRemotePatterns(),
  },
  async headers() {
    // NOTE: `Content-Security-Policy` is deliberately absent here. Headers
    // declared in this file are fixed when the server starts, but marketing tag
    // IDs are database values that change without a redeploy — and a policy set
    // here would override the one middleware composes. `middleware.ts` is the
    // single owner of the CSP; the baseline it starts from is in
    // `lib/security/csp.ts`.
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        // Never let a proxy or browser cache authenticated or transactional pages.
        source: '/(admin|checkout|cart|my-account|order)/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
