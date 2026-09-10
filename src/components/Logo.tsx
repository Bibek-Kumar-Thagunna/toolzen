/**
 * ============================================================================
 * THE MARK
 * ============================================================================
 * A stack of three balanced stones with a face on the top one.
 *
 * ── Why a stack of stones ─────────────────────────────────────────────────
 * The name is "tool" plus "zen", and a balanced cairn is the most direct
 * picture of the second half — calm, deliberate, nothing extra. It also says
 * something true about the product: small things stacked carefully. Twenty-four
 * separate tools, each doing one job, is exactly that shape.
 *
 * ── Why it has a face ─────────────────────────────────────────────────────
 * Everything else on this site is restrained: hairline borders, near-black
 * buttons, one accent used sparingly. That restraint is right for a utility
 * people use in a hurry, and it is one degree away from feeling cold. Two eyes
 * and a small curve is the cheapest possible warmth, and it lives in the one
 * place where personality costs the interface nothing.
 *
 * ── Drawn for 16 pixels first ─────────────────────────────────────────────
 * The real test of a mark is the browser tab, where it is about the size of a
 * full stop. Three stacked shapes of clearly different widths keep a readable
 * silhouette at that size; the face simply becomes texture. Earlier drafts with
 * a single round stone lost all identity when shrunk — they turned into a dot.
 *
 * The whole mark is filled shapes with no strokes, so it never needs a stroke
 * width scaled per size and never goes hairline-thin on a retina display.
 *
 * Server component. `currentColor` is not used: the three tones are the mark's
 * identity, and a monochrome variant is `<Logo mono />` for the places that
 * genuinely need one.
 * ============================================================================
 */
import { brand } from '@/lib/brand';
import { cn } from '@/lib/cn';

export interface LogoMarkProps {
  size?: number;
  /**
   * Draw in a single colour, taking `currentColor` for the stones. For a
   * favicon on a coloured tile, or anywhere the mark sits on the accent.
   */
  mono?: boolean;
  className?: string;
}

export function LogoMark({ size = 28, mono = false, className }: LogoMarkProps) {
  // The tones are literal rather than token-driven: this is a logo, and a logo
  // that changes colour with the theme is not a logo. It reads correctly on
  // both the white and the near-black canvas.
  const dark = mono ? 'currentColor' : '#0f766e';
  const mid = mono ? 'currentColor' : '#14b8a6';
  const light = mono ? 'currentColor' : '#5eead4';
  const face = mono ? 'var(--logo-face, #ffffff)' : '#0f766e';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Bottom stone — the widest, and the only one that touches the baseline. */}
      <ellipse cx="24" cy="40" rx="16" ry="5.4" fill={dark} opacity={mono ? 0.9 : 1} />
      {/* Middle. */}
      <ellipse cx="24" cy="30.5" rx="12" ry="5.2" fill={mid} opacity={mono ? 0.7 : 1} />
      {/* Top, drawn as a pebble rather than a circle so it reads as stone. */}
      <path
        d="M24 12c5.2 0 8.8 3.7 8.8 8.2 0 4.2-3.6 6.6-8.8 6.6s-8.8-2.4-8.8-6.6C15.2 15.7 18.8 12 24 12z"
        fill={light}
        opacity={mono ? 0.5 : 1}
      />
      <circle cx="20.9" cy="19.6" r="1.35" fill={face} />
      <circle cx="27.1" cy="19.6" r="1.35" fill={face} />
      <path
        d="M21.4 23a3.4 3.4 0 0 0 5.2 0"
        stroke={face}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export interface LogoProps {
  /** Height of the mark in px. The wordmark scales with it. */
  size?: number;
  /** Mark only, no wordmark. For tight spaces. */
  markOnly?: boolean;
  className?: string;
}

/**
 * Mark plus wordmark.
 *
 * The name is set at the same optical weight as a heading rather than in caps
 * or with letter-spacing tricks — a wordmark that needs tracking to look
 * deliberate usually is not.
 */
export function Logo({ size = 28, markOnly = false, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      {markOnly ? null : (
        <span
          className="text-lg font-semibold tracking-tight text-fg"
          style={{ fontSize: size * 0.64 }}
        >
          {brand.name}
        </span>
      )}
    </span>
  );
}
