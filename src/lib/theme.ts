/**
 * ============================================================================
 * THEME
 * ============================================================================
 * Everything the product knows about light and dark lives here: the storage
 * key, the media query string, the name of the class that flips the palette,
 * and the order the toggle cycles through. No component re-types any of them.
 *
 * WHY `THEME_STORAGE_KEY` IS A CONSTANT, NOT A LITERAL AT EACH USE SITE.
 * The key has to agree in three places: `readStoredTheme`, `applyTheme`, and
 * {@link themeInitScript}. The third is a *string* of JavaScript, so it is
 * invisible to the compiler, to the test runner and to rename-symbol. A typo in
 * a literal there would fail nothing: the pre-paint script would quietly read a
 * key nobody writes, and the only symptom is a returning visitor seeing one
 * frame of the wrong theme — a bug that never reproduces for the person who
 * introduced it. Interpolating one constant into the script makes that class of
 * mistake impossible, which is worth more than the two characters it saves.
 *
 * This module is deliberately NOT `'use client'`. It is imported by a client
 * component (ThemeToggle) and by the server (the root layout needs the init
 * script string), so it has to be safe in both. Every function that touches the
 * DOM checks that there is one rather than assuming.
 * ============================================================================
 */

/** What the user chose. `system` is a choice too, not the absence of one. */
export type Theme = 'light' | 'dark' | 'system';

/** What the palette actually is, once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'flint-theme';

/**
 * The class `tailwind.config.ts` keys `darkMode: 'class'` on, and the selector
 * `globals.css` hangs the dark token block off. Changing it means changing all
 * three, so it is named once here to make that obvious.
 */
const DARK_CLASS = 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Cycle order for the toggle. `light → dark → system`, with `system` last so
 * that a visitor's first click is an explicit, remembered decision rather than
 * a no-op that appears to do nothing on a machine already set to light.
 */
export const THEME_SEQUENCE: readonly Theme[] = ['light', 'dark', 'system'];

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Next state in the cycle. An unrecognised input restarts at `light`. */
export function nextTheme(current: Theme): Theme {
  const at = THEME_SEQUENCE.indexOf(current);
  return THEME_SEQUENCE[(at + 1) % THEME_SEQUENCE.length];
}

/**
 * Pure, and takes the OS preference as an argument rather than reading it, so
 * the interesting logic is testable in Node with no DOM and no mocking.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** The OS preference right now. `false` on the server and in old engines. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Subscribe to OS preference changes. Returns an unsubscribe function, so the
 * caller's effect cleanup is a one-liner and the query string stays in this
 * file. `addEventListener` on a MediaQueryList — not the deprecated
 * `addListener` — is supported by every browser we target.
 */
export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  media.addEventListener('change', handler);
  return () => media.removeEventListener('change', handler);
}

/**
 * The stored choice, or `system` when there is nothing usable there.
 *
 * Three failure modes collapse to the same answer on purpose: no key yet (first
 * visit), a value that is not one of the three (an old build, or a user editing
 * storage), and `localStorage` *throwing* — which is not hypothetical. Safari
 * in private browsing and any browser with third-party storage blocked raise a
 * SecurityError on property access, before `getItem` is even reached.
 */
export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Point `<meta name="theme-color">` at whatever the canvas colour currently
 * resolves to, so the browser's own chrome (Android address bar, iOS status
 * bar) matches the page instead of staying on the light value baked into the
 * document head.
 *
 * The value is read back out of the cascade rather than hardcoded: `--c-canvas`
 * is already defined for both themes in globals.css, and duplicating those
 * channels here would create a second source of truth that drifts. No-ops when
 * the tag is absent, so the root layout owns whether it exists at all.
 */
export function syncThemeColorMeta(): void {
  if (typeof document === 'undefined') return;
  // Every tag, not the first. Next.js emits one `theme-color` per media query
  // (light and dark), so writing only to `querySelector`'s first match would
  // leave the other one authoritative whenever the user's chosen theme
  // disagrees with the OS — the exact case this function exists to handle.
  const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (tags.length === 0) return;
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue('--c-canvas')
    .trim();
  if (!channels) return;
  for (const meta of tags) meta.content = `rgb(${channels})`;
}

/**
 * Persist a choice and make the document reflect it. The single write path —
 * the toggle calls this, and so does the OS-preference listener while on
 * `system`, where re-writing the same value is harmless and keeps one code
 * path instead of two.
 *
 * A no-op without a document, so a stray call during server rendering is a
 * non-event rather than a crash.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage full, or blocked. The theme still applies for this page view;
    // it just will not survive a reload. Failing to remember is not a reason
    // to fail to render.
  }

  const resolved = resolveTheme(theme, systemPrefersDark());
  document.documentElement.classList.toggle(DARK_CLASS, resolved === 'dark');
  syncThemeColorMeta();
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * The only inline script in the product, and the one case where an inline
 * script is the correct tool rather than a shortcut.
 *
 * It has to run synchronously, in `<head>`, before the first paint. No React
 * component can do that: a component's effect runs after hydration, which is
 * after the browser has already painted, so a returning visitor whose choice is
 * `dark` would see a white flash and then a repaint. That flash is not a polish
 * issue — it is a bright rectangle in a dark room, and it happens on every
 * navigation that is not a client-side route change.
 *
 * Constraints it is written to:
 *   - Self-contained. It cannot import, because it runs before any bundle.
 *   - Wrapped in try/catch. `localStorage` access throws outright in Safari
 *     private mode; an uncaught throw in a blocking head script would abort the
 *     rest of it and, worse, is a parse-time landmine for anything appended
 *     later. A failed read simply leaves the light default in place.
 *   - Only adds the class, never removes it. There is nothing to remove: this
 *     is the first code to touch the element.
 *   - Anything that is not exactly `'light'` or `'dark'` — absent, `'system'`,
 *     or corrupt — falls through to the OS preference, which is the same
 *     precedence `readStoredTheme` + `resolveTheme` apply at runtime.
 *
 * It deliberately does NOT touch `<meta name="theme-color">`: that would need a
 * querySelector plus a hardcoded colour literal, i.e. a second copy of the
 * canvas token. `ThemeToggle` syncs it via {@link syncThemeColorMeta} on mount,
 * one frame later, which is soon enough for browser chrome.
 *
 * Deployment note: the string is a constant, so a strict CSP does not need
 * `'unsafe-inline'` for it. Generate the hash with
 *   node -e "import('node:crypto').then(c=>console.log('sha256-'+c.createHash('sha256').update(process.argv[1]).digest('base64')))" "<script text>"
 * and add it to `script-src` in the nginx CSP.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const themeInitScript: string = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||(t!=='light'&&matchMedia('${DARK_QUERY}').matches))document.documentElement.classList.add('${DARK_CLASS}')}catch(e){}})()`;
