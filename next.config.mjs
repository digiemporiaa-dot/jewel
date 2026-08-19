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
function uploadConnectSources() {
  const out = new Set();
  for (const url of [process.env.R2_ENDPOINT, process.env.R2_PUBLIC_URL]) {
    if (!url) continue;
    try {
      const { hostname } = new URL(url);
      out.add(`https://${hostname}`);
      out.add(`https://*.${hostname}`);
    } catch { /* ignore malformed env */ }
  }
  return [...out];
}

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
    // Content Security Policy. Razorpay Checkout and Google Fonts are the only
    // third parties allowed; 'unsafe-inline' on styles is required by Tailwind's
    // runtime-injected styles and the inline JSON-LD script tags.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      ["connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com", ...uploadConnectSources()].join(' '),
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
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
