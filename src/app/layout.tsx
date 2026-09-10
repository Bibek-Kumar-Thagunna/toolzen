import type { Metadata, Viewport } from 'next';

import './globals.css';

import { brand } from '@/lib/brand';
import { site, siteUrl } from '@/lib/site';
import { buildMetadata } from '@/lib/seo';
import { themeInitScript } from '@/lib/theme';
import { tools } from '@/lib/registry';
import { buildSearchIndex } from '@/lib/registry/search';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { SearchTrigger } from '@/components/search/SearchTrigger';
import { Analytics } from '@/components/analytics/Analytics';
import { AdScripts } from '@/components/ads/AdScripts';

/**
 * ============================================================================
 * ROOT LAYOUT
 * ============================================================================
 * Wires together the four things that have to be global: the pre-paint theme
 * script, the chrome, the search index, and the optional third-party scripts.
 *
 * ── The search index is built once, here ──
 * `buildSearchIndex(tools)` runs on the server at build time and its ~14KB
 * result is the only part of the registry that crosses into client code. The
 * registry itself carries every tool's FAQ and prose; importing it from the
 * palette would ship all of that to every visitor. Building it in the layout
 * rather than in each page means one copy in the RSC payload, shared by every
 * route.
 *
 * ── No `title.template` ──
 * Deliberate. Pages produce complete titles through `buildMetadata`, which
 * already appends the brand and enforces the 60-character budget. A template
 * here would append it a second time.
 * ============================================================================
 */

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  ...buildMetadata({
    // The trailing full stop reads badly against the ` · Flint` suffix.
    title: brand.tagline.replace(/\.$/, ''),
    description: brand.description,
    path: '/',
  }),
  applicationName: brand.name,
  authors: [{ name: brand.legalName, url: `${siteUrl}/` }],
  creator: brand.legalName,
  publisher: brand.legalName,
  manifest: '/manifest.webmanifest',
  /**
   * Declared explicitly rather than relying on Next's `app/favicon.ico` file
   * convention, because the assets are generated into `public/` by
   * `scripts/generate-brand-assets.mjs` and one list of them is easier to keep
   * true than a convention plus a manifest plus a script.
   *
   * The SVG is listed after the `.ico` on purpose: browsers pick the last
   * usable candidate, so modern ones take the vector and older ones stop at the
   * bitmap. `apple-touch-icon` is separate because iOS ignores the manifest's
   * `icons` array entirely.
   */
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false, address: false, email: false },
  ...(site.googleSiteVerification
    ? { verification: { google: site.googleSiteVerification } }
    : {}),
};

/**
 * `themeColor` has to match the painted background of each theme or the mobile
 * browser chrome ends up a different colour from the page it frames. The two
 * values are the light and dark `--c-canvas` tokens; the theme script keeps the
 * live `<meta>` in sync when the user overrides the OS preference.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zooming is never disabled. `maximum-scale=1` is a WCAG 1.4.4 failure and
  // there is no reason a utility site would need it.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d0f' },
  ],
  colorScheme: 'light dark',
};

const searchDocs = buildSearchIndex(tools);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={site.lang} suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas font-sans text-fg antialiased">
        {/*
          The one inline script in the codebase, and the one place it is
          justified: it adds the `dark` class before the browser paints any of
          the body below it, which no React component can do — a component runs
          after hydration, by which point the wrong theme has already flashed.
          `suppressHydrationWarning` on <html> above is required precisely
          because this script mutates the class list that React is about to
          reconcile. It is scoped to the element the script touches, not spread
          across the tree.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />

        <Header search={<SearchTrigger docs={searchDocs} />} />

        {/* `tabIndex={-1}` makes this a valid skip-link target in every browser. */}
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus-visible:outline-none">
          {children}
        </main>

        <Footer />

        <Analytics />
        <AdScripts />
      </body>
    </html>
  );
}
