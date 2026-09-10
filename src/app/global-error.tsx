'use client';

import { useEffect } from 'react';

/**
 * ============================================================================
 * GLOBAL ERROR BOUNDARY — the last one that can catch anything
 * ============================================================================
 * `error.tsx` catches a failure *inside* a page. This file catches a failure in
 * the root layout itself, which means Next.js has thrown away the layout and
 * everything it provided: the `<html>` and `<body>` elements, the header, the
 * footer, and — the part that dictates how this file is written — the
 * `import './globals.css'` that every Tailwind class in the codebase depends
 * on. Next.js documents that the root layout's styles are not applied here.
 *
 * So this is the one component in the product that cannot use the design
 * system. Written with `className="text-fg"` it would render as black text on
 * a white page in dark mode, or as unstyled 16px Times New Roman — a page that
 * looks *more* broken than the error it is reporting. Every value below is
 * therefore inline and self-contained:
 *
 *   - Layout and colour come from `style` attributes and one constant `<style>`
 *     block (the only way to express a `prefers-color-scheme` query without a
 *     stylesheet).
 *   - The two colours are the light and dark `--c-canvas`/`--c-fg` token values
 *     copied by hand. They are duplicated from globals.css on purpose: reading
 *     the real tokens would require the stylesheet this file assumes is missing.
 *     If the palette changes, this file drifting is a cosmetic bug on a page
 *     almost nobody sees; importing the tokens would be a blank page.
 *   - The font is a system stack, for the same reason.
 *
 * It keeps the rule from `error.tsx`: **a normal user never sees a technical
 * error.** `error.message` may be a bundler path or a chunk hash. The message
 * is ours; the only machine detail offered is Next's `digest`, a short hash
 * that a bug report can be matched against a server log line.
 * ============================================================================
 */

/**
 * Constant, so a strict CSP can hash-pin it rather than allowing
 * `'unsafe-inline'` for styles. Contains no `<`, `>` or `&`, which also makes
 * it safe as a `<style>` child under HTML's raw-text parsing rules.
 */
const CRITICAL_CSS = `
:root{color-scheme:light dark}
html,body{margin:0;padding:0}
body{background:#ffffff;color:#16171a;
font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
-webkit-font-smoothing:antialiased}
.ge-wrap{max-width:38rem;margin:0 auto;padding:6rem 1.25rem}
.ge-eyebrow{margin:0;font-size:.6875rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#5c5f66}
.ge-title{margin:.75rem 0 0;font-size:1.875rem;line-height:1.2;font-weight:600;letter-spacing:-.02em}
.ge-body{margin:1rem 0 0;font-size:1rem;line-height:1.6;color:#5c5f66}
.ge-actions{margin:2rem 0 0;display:flex;flex-wrap:wrap;gap:.75rem}
.ge-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.5rem;
padding:0 1rem;border-radius:.375rem;border:1px solid transparent;font:inherit;font-size:.875rem;
font-weight:500;cursor:pointer;text-decoration:none}
.ge-btn-primary{background:#c0430b;color:#ffffff}
.ge-btn-secondary{background:#ffffff;color:#16171a;border-color:#d2d0cd}
.ge-btn:focus-visible{outline:2px solid #c0430b;outline-offset:2px}
.ge-digest{margin:2.5rem 0 0;font-size:.75rem;color:#5c5f66}
.ge-digest code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){
body{background:#0c0d0f;color:#ecedef}
.ge-eyebrow,.ge-body,.ge-digest{color:#a0a4ac}
.ge-btn-primary{background:#f97316;color:#170d04}
.ge-btn-secondary{background:#131417;color:#ecedef;border-color:#35383f}
.ge-btn:focus-visible{outline-color:#f97316}
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[flint] root layout error', error);
  }, [error]);

  return (
    // `lang` is hardcoded rather than read from `site.lang`: this component must
    // not import a module that could itself be implicated in the failure.
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong</title>
        {/* Not a React text child: React escapes `&` and `<` in text, and a
            `<style>` element is raw text in HTML, so the entities would reach
            the CSS parser literally. The string is a constant, so this carries
            none of the usual risk. */}
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
      </head>
      <body>
        <div className="ge-wrap">
          <p className="ge-eyebrow">Something went wrong</p>
          <h1 className="ge-title">The page failed to load</h1>
          <p className="ge-body">
            This one is on us, not on anything you did. The tools run inside your browser, so
            nothing you were working on has been sent anywhere — reloading gives a clean start.
          </p>

          <div className="ge-actions">
            <button type="button" onClick={reset} className="ge-btn ge-btn-primary">
              Try again
            </button>
            {/*
              A plain `<a>`, not `next/link`. If the root layout threw, the
              router may be in exactly the state that caused it; a full document
              request is the one navigation guaranteed to escape it.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above: a full document request is the point. */}
            <a href="/" className="ge-btn ge-btn-secondary">
              Go to the homepage
            </a>
          </div>

          {error.digest ? (
            <p className="ge-digest">
              If you report this, quoting <code>{error.digest}</code> lets us find the exact
              failure.
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
