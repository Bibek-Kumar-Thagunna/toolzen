'use client';

/**
 * ThemeToggle — one control, three states: light → dark → system.
 *
 * ── Why three states and not a switch ──────────────────────────────────────
 * A two-state switch has no way back to "follow my OS", so a visitor who taps
 * it once on a phone that switches to dark at sunset is stuck in whatever they
 * picked at 2pm forever. `system` is a real state and it is in the cycle.
 *
 * ── The hydration problem, handled honestly ────────────────────────────────
 * The stored choice lives in `localStorage`, which the server cannot read, so
 * the server has no way to render the correct icon. Three ways out:
 *
 *   1. Render the stored state during SSR — impossible, there is no storage.
 *   2. Render *something* and paper over the difference with
 *      `suppressHydrationWarning` — this is the popular answer and it is wrong.
 *      Suppression does not reconcile anything; React keeps the server's DOM and
 *      stops telling you it disagrees. The icon then stays wrong until an
 *      unrelated re-render, and you have disabled the warning that would have
 *      told you.
 *   3. Render a stable neutral state on both sides, then correct it in an effect.
 *
 * This is (3). `system` is the neutral state — it is genuinely what an unset
 * visitor has — so the server HTML, the first client render and the truth all
 * agree for a new visitor, and for a returning one the icon settles a frame
 * after hydration. Nothing is suppressed and nothing lies: until the effect has
 * run, the accessible name is the state-free "Change theme" rather than a claim
 * about a theme we have not read yet.
 *
 * The *page* does not flash, only this 40px icon: the inline script in <head>
 * (see src/lib/theme.ts) has already applied the class before first paint.
 *
 * ── Announcing the change ──────────────────────────────────────────────────
 * Nothing visible changes near the button — the whole page repaints — so screen
 * reader users get a `role="status"` message. The region is rendered from the
 * first paint with an empty string, because several screen readers ignore a live
 * region that appears in the same tick as its content: the announcement is only
 * made for a *mutation* of an already-observed node.
 */
import { useEffect, useState } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  syncThemeColorMeta,
  watchSystemTheme,
  type Theme,
} from '@/lib/theme';

const icons: Record<Theme, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' };

/** Spoken and written the same way, so the label and the announcement agree. */
const labels: Record<Theme, string> = { light: 'light', dark: 'dark', system: 'system' };

/**
 * Touch target. `size="icon"` is 40x40, which is the design system's floor, and
 * a caller may not simply append `h-11 w-11` — per src/lib/cn.ts a second class
 * on the same property does not reliably win. So the *hit area* is grown to 44px
 * with a centred pseudo-element while the visual box stays 40px: no layout
 * shift, no override, and pointer events still land on the button because the
 * pseudo-element is part of it.
 */
const tapTarget44 =
  'relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 ' +
  'after:-translate-x-1/2 after:-translate-y-1/2';

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('system');
  const [ready, setReady] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    setTheme(readStoredTheme());
    setReady(true);
    // The pre-paint script deliberately does not touch <meta name="theme-color">
    // (it would need a second copy of the canvas colour). One frame late is fine
    // for browser chrome, so it is caught up here.
    syncThemeColorMeta();
  }, []);

  useEffect(() => {
    // Only `system` follows the OS, so only `system` subscribes. Re-applying
    // 'system' writes the value already in storage, which is a no-op with the
    // benefit of keeping one code path for "make the document match".
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [theme]);

  const handleClick = () => {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
    setAnnouncement(`Theme set to ${labels[next]}.`);
    track({ name: 'theme_changed', theme: next });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleClick}
        // States the current value and what a press will do, which is the part
        // an icon cannot convey. Before the effect runs we do not know the
        // value, so we do not assert one.
        aria-label={
          ready ? `Theme: ${labels[theme]}. Switch to ${labels[nextTheme(theme)]}.` : 'Change theme'
        }
        className={cn(tapTarget44, className)}
      >
        <Icon name={icons[theme]} size={18} />
      </Button>

      {/* Ships empty; filled only on interaction. `role="status"` is implicitly
          polite and atomic, so no aria-live/aria-atomic by hand. */}
      <VisuallyHidden role="status">{announcement}</VisuallyHidden>
    </>
  );
}
