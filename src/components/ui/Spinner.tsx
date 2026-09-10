/**
 * Spinner — busy indicator for an operation of unknown length.
 *
 * What: the `loader` glyph under `animate-spin`, wrapped in a live region with
 * an always-present visually hidden label.
 *
 * Why the hidden label is the important part: `prefers-reduced-motion` is
 * clamped globally in globals.css, so under that setting the glyph is a static
 * three-quarter arc that communicates nothing on its own. The `role="status"`
 * text is what actually reports "busy" in every case, and the rotation is
 * decoration layered on top. That is the right way round — not a fallback.
 *
 * `aria-live="polite"` is redundant with `role="status"` (the role implies it),
 * but some older screen reader / browser pairings only honour the explicit
 * attribute, and a duplicate costs nothing.
 *
 * No colour class: the glyph inherits `currentColor`, so a spinner dropped into
 * a button matches that button's label instead of fighting it. Pass
 * `className="text-fg-muted"` for a standalone one.
 *
 * Server component — an SVG plus a span, no hooks.
 */
import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from './VisuallyHidden';

export interface SpinnerProps {
  /** Rendered size in px. Default 20 — matches the icon set's default. */
  size?: number;
  /**
   * What is busy. Announced, never shown. Prefer something specific
   * ("Compressing image") over the default when the context allows it.
   */
  label?: string;
  className?: string;
}

export function Spinner({ size = 20, label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center justify-center', className)}
    >
      <Icon name="loader" size={size} className="animate-spin" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
