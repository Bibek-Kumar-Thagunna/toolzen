/**
 * ProgressBar — determinate and indeterminate progress for long client-side
 * work (image encode, PDF merge, batch export).
 *
 * ── There is always a text channel ──────────────────────────────────────────
 * `prefers-reduced-motion` is clamped globally to 0.01ms with
 * `animation-iteration-count: 1`, which means the indeterminate stripe finishes
 * instantly and parks itself off the end of the track: a sighted user with that
 * setting would see an empty box. So the indeterminate case *always* renders its
 * label as visible text, and the determinate case offers `showPercent`. Motion
 * is never the only thing carrying the state.
 *
 * ── Labelling ───────────────────────────────────────────────────────────────
 * `label` is the accessible name (`aria-label`) and is not rendered for the
 * determinate case. That keeps the name from silently drifting away from, or
 * duplicating, on-screen text: a caller that wants a visible caption renders its
 * own heading and passes the same string. Where we do print text — the percent
 * figure, and the indeterminate label — it is `aria-hidden`, because
 * `aria-valuetext` and `aria-label` already say it and a screen reader should
 * hear it once.
 *
 * ── Why the track has a ring ────────────────────────────────────────────────
 * `bg-surface-sunken` against `bg-surface` is a 2-value difference in light
 * theme: at 0% the bar would be invisible and the user could not tell progress
 * exists. `ring-1 ring-inset` defines the bounds without changing the box size.
 *
 * Server component: pure props in, markup out.
 */
import { cn } from '@/lib/cn';

export type ProgressBarSize = 'sm' | 'md';
export type ProgressBarVariant = 'accent' | 'success' | 'danger';

const trackClass: Record<ProgressBarSize, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
};

const fillClass: Record<ProgressBarVariant, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  danger: 'bg-danger',
};

export interface ProgressBarProps {
  /** 0–100. Omit (or pass a non-finite number) for indeterminate. */
  value?: number;
  /** Accessible name. Required — an unnamed progress bar tells AT nothing. */
  label: string;
  showPercent?: boolean;
  size?: ProgressBarSize;
  variant?: ProgressBarVariant;
  className?: string;
}

export function ProgressBar({
  value,
  label,
  showPercent = false,
  size = 'md',
  variant = 'accent',
  className,
}: ProgressBarProps) {
  // Explicit guard: `Number.isFinite` rejects `undefined`, `NaN`, `Infinity` and
  // `-Infinity`. Narrowing to a local rather than to a boolean flag so the
  // clamp below cannot be reached with a non-number. A NaN here is not a
  // cosmetic bug — it makes the element's value unreadable to AT and emits
  // `width: NaN%` into the DOM.
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const determinate = numeric !== null;
  const pct = numeric === null ? 0 : Math.min(100, Math.max(0, Math.round(numeric)));

  const caption = !determinate ? (
    <span aria-hidden="true" className="text-sm text-fg-muted">
      {label}
    </span>
  ) : showPercent ? (
    <span aria-hidden="true" className="tabular text-sm text-fg-muted">
      {pct}%
    </span>
  ) : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {caption ? (
        <div className={cn('flex', determinate ? 'justify-end' : 'justify-start')}>{caption}</div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        // Omitting `aria-valuenow` entirely is what makes a progressbar
        // indeterminate. A placeholder 0 would claim "no progress yet".
        aria-valuenow={determinate ? pct : undefined}
        aria-valuetext={determinate ? `${pct}%` : undefined}
        className={cn(
          'w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border',
          trackClass[size],
        )}
      >
        {determinate ? (
          // Inline style is correct here: the width is an arbitrary runtime
          // value, so there is no class to generate for it. Tailwind cannot
          // produce `w-[37%]` from a variable at build time, and inline style
          // also beats any class on specificity, which is what we want.
          <div
            className={cn('h-full rounded-full transition-[width] duration-fast', fillClass[variant])}
            style={{ width: `${pct}%` }}
          />
        ) : (
          // The keyframe supplies both the translate and the `scaleX(0.4)` that
          // narrows this to a stripe, so the element itself is full width.
          <div className={cn('h-full w-full rounded-full animate-indeterminate', fillClass[variant])} />
        )}
      </div>
    </div>
  );
}
