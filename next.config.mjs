/** @type {import('next').NextConfig} */

// Non-CSP security headers live here so they apply even when Next is run
// without the nginx layer (e.g. `npm start` locally, or a PaaS deploy).
// The Content-Security-Policy is set in deploy/nginx/security.conf, because it
// needs to be tuned per ad provider and is easier to audit in one place.
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

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lean container image: only the traced server files are copied into the runner.
  output: 'standalone',
  productionBrowserSourceMaps: false,
  compress: true,

  eslint: { dirs: ['src', 'scripts'] },

  experimental: {
    // Ship smaller client bundles by trimming unreferenced exports of these packages.
    optimizePackageImports: ['pdf-lib'],
  },

  images: {
    // Every image the platform renders is either a local static asset or a
    // client-side blob URL, so the optimiser is not needed and would only
    // burn CPU on a 4 vCPU box.
    unoptimized: true,
  },

  async headers() {
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
  },

  webpack(config) {
    // pdfjs-dist optionally requires the native `canvas` package when running in
    // Node. We only ever use it in the browser, so stub it out.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
