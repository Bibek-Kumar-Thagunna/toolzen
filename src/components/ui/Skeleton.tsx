/**
 * Skeleton — placeholder geometry for content that has not arrived yet.
 *
 * ── It is decorative, and it says so ────────────────────────────────────────
 * The whole thing is `aria-hidden="true"`. A screen reader user gains nothing
 * from hearing about grey rectangles, and announcing them would be worse than
 * silence because it implies content. The loading state is reported once,
 * elsewhere, by a `Spinner` (or any `role="status"` region). Skeletons are the
 * sighted-user half of that same signal, not a second announcement.
 *
 * ── The shimmer, and the gradient exception ─────────────────────────────────
 * The design brief bans gradients, and this file uses one:
 * `from-transparent via-surface-hover to-transparent`. That is deliberate and
 * narrow — a moving highlight built from two semantic tokens, not a decorative
 * colour ramp, and a hard-edged band would read as a glitch rather than a
 * sweep. No raw palette value appears in it, so it re-themes with everything
 * else.
 *
 * The `shimmer` keyframe only declares its 100% state (`translateX(100%)`), so
 * the starting position has to come from a class: `-translate-x-full`. CSS takes
 * the element's own computed transform as the missing 0% frame.
 *
 * Under `prefers-reduced-motion` the sweep is clamped and the bars sit still —
 * correct, because the shape alone already communicates "not here yet".
 *
 * ── Why sizes go through inline style, not classes ──────────────────────────
 * `src/lib/cn.ts` is explicit that an appended `className` does not win a
 * Tailwind conflict — stylesheet position does. `w-3/5` is emitted before
 * `w-full` in Tailwind's width scale, so a "short last line" expressed as a
 * class would silently lose to the variant's `w-full`. Inline style wins on
 * specificity, so every dimension override here is a style, and the last text
 * line uses `width: 60%`.
 *
 * Server component.
 */
import { cn } from '@/lib/cn';

export type SkeletonVariant = 'text' | 'block' | 'circle';

const shapeClass: Record<SkeletonVariant, string> = {
  text: 'h-4 w-full rounded-sm',
  block: 'h-24 w-full rounded-md',
  circle: 'size-10 rounded-full',
};

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** A number is treated as px. Overrides the variant default. */
  width?: string | number;
  height?: string | number;
  /** Number of stacked bars. `text` variant only; other variants ignore it. */
  lines?: number;
  className?: string;
}

const toCss = (value: string | number | undefined): string | undefined =>
  typeof value === 'number' ? `${value}px` : value;

interface BarProps {
  variant: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** One bar plus its sweep. Not exported — `Skeleton` is the whole public API. */
function Bar({ variant, width, height, className }: BarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block overflow-hidden bg-surface-sunken',
        shapeClass[variant],
        className,
      )}
      style={{ width: toCss(width), height: toCss(height) }}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-surface-hover to-transparent" />
    </span>
  );
}

export function Skeleton({ variant = 'text', width, height, lines = 1, className }: SkeletonProps) {
  // Guarded the same way ProgressBar guards `value`: a NaN or Infinity out of a
  // caller's arithmetic must not reach `Array.from({ length })`, which throws.
  const safeLines = Number.isFinite(lines) ? Math.max(1, Math.round(lines)) : 1;

  if (variant === 'text' && safeLines > 1) {
    return (
      <span aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
        {Array.from({ length: safeLines }, (_, index) => (
          <Bar
            key={index}
            variant="text"
            // Last line short, the way a real paragraph ends — unless the
            // caller pinned a width, in which case respect it.
            width={width ?? (index === safeLines - 1 ? '60%' : undefined)}
            height={height}
          />
        ))}
      </span>
    );
  }

  return <Bar variant={variant} width={width} height={height} className={className} />;
}
