import type { MetadataRoute } from 'next';

import { brand } from '@/lib/brand';
import { routes } from '@/lib/site';
import { popularTools } from '@/lib/registry';

/**
 * ============================================================================
 * manifest.webmanifest
 * ============================================================================
 * Served at `/manifest.webmanifest`, which is the path `layout.tsx` links from
 * `metadata.manifest` — the two have to agree and Next.js fixes the filename,
 * so this is the file that owns it.
 *
 * ── What this manifest is honestly for ─────────────────────────────────────
 * Not a PWA. There is no service worker in this codebase and no offline mode,
 * so Chrome will not show an install prompt and nothing here claims otherwise.
 * What it does buy is real and cheap: a correct icon and colour when someone
 * adds a tool to their home screen (common for a utility they use weekly), a
 * sensible name in the Android task switcher, and long-press shortcuts to the
 * tools people actually come for.
 *
 * `display: 'standalone'` is therefore about how an added-to-home-screen launch
 * looks, not a claim of app-like capability. If a service worker is ever added,
 * it belongs in a separate file and this one does not change.
 *
 * ── Asset contract ─────────────────────────────────────────────────────────
 * The four icon paths below must exist in `public/`. They are produced by
 * `scripts/generate-brand-assets.mjs` from `brand.name` and the `--c-accent`
 * token, and their existence is checked by `scripts/check-integrity.mjs` — a
 * manifest referencing a 404 is worse than no manifest, because the browser
 * silently falls back to a screenshot of the page as the home-screen icon.
 *
 *   /icons/icon-192.png        192x192  any
 *   /icons/icon-512.png        512x512  any
 *   /icons/maskable-512.png    512x512  maskable (safe zone: inner 80%)
 *   /icons/icon.svg            any      any
 *
 * The same script also produces `/favicon.ico`, `/icons/apple-touch-icon.png`
 * and `/og/default.png`, which are linked from `layout.tsx` and `site.ts`
 * instead of from here.
 *
 * The maskable variant is a separate file rather than a `purpose: 'any
 * maskable'` on one icon: Android crops a maskable icon to whatever shape the
 * launcher uses, so a single asset serving both roles is either clipped as a
 * home-screen icon or floating in dead space everywhere else.
 * ============================================================================
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` pins app identity to the origin root, so changing `start_url` later
    // updates the installed entry instead of creating a second one.
    id: routes.home,
    name: `${brand.name} — ${brand.tagline.replace(/\.$/, '')}`,
    // Home-screen labels truncate around 12 characters on both platforms.
    short_name: brand.name,
    description: brand.description,
    start_url: routes.home,
    scope: routes.home,
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'en',
    dir: 'ltr',
    // Both are the light `--c-canvas`. A manifest cannot express a media query,
    // and the splash screen a dark-mode user sees for ~200ms is a smaller cost
    // than a dark launcher tile on a device set to light.
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['utilities', 'productivity'],
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Android caps these at four and ignores the rest, so the list is sliced
    // rather than trusted to be short. Driven by the registry so it cannot
    // advertise a tool that has been renamed or removed.
    shortcuts: popularTools.slice(0, 4).map((tool) => ({
      name: tool.name,
      short_name: tool.name,
      description: tool.tagline,
      url: routes.tool(tool.slug),
    })),
  };
}
