/**
 * Badge — a small, non-interactive label for state and metadata (privacy mode,
 * file type, "new", "beta", error counts).
 *
 * What: seven variants over the semantic token triplets, two sizes, an optional
 * leading icon and an optional dot.
 *
 * Why `-subtle` background + `-fg` text + `-border` border rather than a solid
 * fill: those three tokens are authored as a set for each theme, so the pair
 * clears 4.5:1 in both light and dark without a second palette. A solid
 * `bg-success` with white text would need its own on-colour per theme.
 *
 * Why `rounded` and not `rounded-full`: a pill reads as a chip you can dismiss.
 * A badge here is a label, not a control.
 *
 * Server component. Not focusable, not clickable — if you need a clickable
 * filter, that is a `<button>`, not a badge.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

export type BadgeSize = 'sm' | 'md';

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'border-border bg-surface-sunken text-fg-muted',
  accent: 'border-accent-border bg-accent-subtle text-accent-fg',
  success: 'border-success-border bg-success-subtle text-success-fg',
  warning: 'border-warning-border bg-warning-subtle text-warning-fg',
  danger: 'border-danger-border bg-danger-subtle text-danger-fg',
  info: 'border-info-border bg-info-subtle text-info-fg',
  // No fill: for badges sitting on an already-tinted row where a second wash
  // would muddy it.
  outline: 'border-border-strong text-fg-muted',
};

const sizeClass: Record<BadgeSize, string> = {
  sm: 'gap-1 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide',
  md: 'gap-1.5 px-2 py-0.5 text-xs font-medium',
};

const iconSize: Record<BadgeSize, number> = { sm: 12, md: 14 };

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Decorative — the badge text is the accessible content, so the icon is hidden from AT. */
  icon?: IconName;
  /**
   * A 6px dot in the variant's foreground colour.
   *
   * A dot on its own is colour-only signalling and fails WCAG 1.4.1, so this is
   * only for badges whose adjacent text already names the state — "Online",
   * "Queued", "3 errors". Never `<Badge dot />` with no text, and never a dot
   * as the sole difference between two badges.
   */
  dot?: boolean;
  children?: ReactNode;
}

export function Badge({
  variant = 'neutral',
  size = 'sm',
  icon,
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded border align-middle',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {dot ? (
        // `bg-current` inherits the variant's text colour, so the dot can never
        // drift out of sync with the label it belongs to.
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {icon ? <Icon name={icon} size={iconSize[size]} className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
