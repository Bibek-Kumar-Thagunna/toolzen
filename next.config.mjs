/** @type {import('next').NextConfig} */

/**
 * ============================================================================
 * OUTPUT MODE
 * ============================================================================
 * Chosen by the deploy rather than hardcoded, because the right answer differs
 * per host and the wrong one fails in confusing ways.
 *
 *   unset         Vercel, and `npm start` locally. This is the default and what
 *                 Vercel wants: it detects the framework and routes everything
 *                 itself, and a hardcoded mode only gets in its way. (A
 *                 hardcoded `standalone` also breaks `next start`, which is the
 *                 warning that led to this being configurable.)
 *
 *   'export'      A folder of plain HTML in `out/`. Every page in this project
 *                 is statically generated already, so nothing is lost — and the
 *                 result runs on any static host: Cloudflare Pages, Netlify,
 *                 GitHub Pages, an S3 bucket. That matters commercially:
 *                 Vercel's free Hobby plan is for non-commercial use only, so
 *                 the day advertising is switched on this site needs either a
 *                 paid plan or a host whose free tier permits it. Keeping a
 *                 static export working means that is a choice, not a trap.
 *
 *   'standalone'  A self-contained Node server, for a Docker image or a VPS.
 *
 * Set `NEXT_OUTPUT=export` or `NEXT_OUTPUT=standalone` at build time.
 * ============================================================================
 */
const output =
  process.env.NEXT_OUTPUT === 'export' || process.env.NEXT_OUTPUT === 'standalone'
    ? process.env.NEXT_OUTPUT
    : undefined;

const isExport = output === 'export';

// Non-CSP security headers live here so they apply even when Next is run
// without the nginx layer (e.g. `npm start` locally, or a PaaS deploy).
// The Content-Security-Policy is set in vercel.json for Vercel, and in
// deploy/nginx/security.conf for a self-hosted deploy, because it needs to be
// tuned per ad provider and is easier to audit in one place.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    // Camera is intentionally NOT disabled: mobile image tools use
    // `<input capture>` so users can shoot a photo straight into a tool.
    value: 'geolocation=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

async function headers() {
  return [
    { source: '/:path*', headers: securityHeaders },
    {
      // Everything under /pdf/ is a version-stamped copy of a pdfjs-dist
      // worker, written by scripts/copy-pdf-worker.mjs. The version is in the
      // filename precisely so `immutable` is a true statement: an upgrade
      // produces a new URL rather than new bytes at an old one, which is the
      // difference between a hard cache and a stale worker that disagrees
      // with the bundle that loaded it.
      source: '/pdf/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      // Icons and social cards, written by scripts/generate-brand-assets.mjs.
      //
      // Cached for a day rather than a year, and deliberately not `immutable`:
      // these paths are stable (`/og/tool/image-compressor.png` keeps its name
      // across a rebrand) so an `immutable` year would leave Twitter, Slack and
      // Google serving the old card long after the name on it changed. A day is
      // long enough that no real visitor fetches one twice, and short enough
      // that a rebrand propagates without renaming thirty-one files.
      source: '/(og|icons)/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
      ],
    },
  ];
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  compress: true,

  ...(output ? { output } : {}),

  eslint: { dirs: ['src', 'scripts'] },

  experimental: {
    // Ship smaller client bundles by trimming unreferenced exports of these packages.
    optimizePackageImports: ['pdf-lib'],
  },

  images: {
    // Every image the platform renders is either a local static asset or a
    // client-side blob URL, so the optimiser is not needed and would only
    // burn CPU. It is also a hard requirement of `output: 'export'`.
    unoptimized: true,
  },

  /**
   * A static export has no server to set headers with, and Next rejects this
   * function outright in that mode rather than silently ignoring it.
   *
   * The headers are not lost when exporting — they move to the host's own
   * config, which is where a static site's headers have to live anyway:
   * `vercel.json` here, a `_headers` file on Cloudflare Pages or Netlify, a
   * server block on nginx.
   */
  ...(isExport ? {} : { headers }),

  webpack(config) {
    // pdfjs-dist optionally requires the native `canvas` package when running in
    // Node. We only ever use it in the browser, so stub it out.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
