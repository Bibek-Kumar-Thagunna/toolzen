/**
 * Button — every clickable affordance in the product except prose links.
 *
 * Decisions recorded here so they are not re-litigated:
 *
 *  - React 19 pattern: `ref` is an ordinary prop on function components, so
 *    there is no `forwardRef` wrapper. It is declared as `ref?: Ref<...>` and
 *    passed straight through to the DOM node.
 *  - No `'use client'`. This file only maps props onto a `<button>`, so it
 *    renders on the server. A page that needs `onClick` marks *itself* as a
 *    client module and Button joins that graph at zero extra cost.
 *  - `type` defaults to `"button"`, not the platform default `"submit"`.
 *    Rejected the platform default: tool panels put several buttons inside one
 *    `<form>`, and an accidental submit reloads the page and discards the
 *    user's work. `type="submit"` is one explicit prop away.
 *  - One class per axis, never two. Border radius lives in the variant map
 *    instead of the shared base string because `link` needs a different value,
 *    and a second radius class appended later would not reliably win — see the
 *    specificity note in src/lib/cn.ts.
 *  - `danger` pairs `bg-danger` with `text-fg-onAccent`. Both themes were
 *    measured: white on rgb(180 35 24) is 6.6:1, near-black rgb(23 13 4) on
 *    rgb(248 113 113) is 6.9:1. There is no danger-hover token, so hover and
 *    active are alpha steps of the same token, measured at 4.8:1 or better
 *    against the label in both themes.
 *  - Focus is the single global `:focus-visible` ring from globals.css.
 *    Nothing here clips or offsets it, so there is no per-component ring.
 */
import type { ButtonHTMLAttributes, Ref } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium ' +
  'select-none whitespace-nowrap transition-colors duration-fast ease-out ' +
  'disabled:pointer-events-none disabled:opacity-[0.55]';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'rounded bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active',
  secondary: 'rounded border border-border bg-surface text-fg shadow-xs hover:bg-surface-hover',
  ghost: 'rounded bg-transparent text-fg hover:bg-surface-hover',
  danger: 'rounded bg-danger text-fg-onAccent hover:bg-danger/90 active:bg-danger/85',
  link:
    'rounded-sm bg-transparent text-accent-fg underline decoration-accent/30 ' +
    'underline-offset-2 hover:decoration-accent/70',
};

/**
 * 40px at `md` is the mobile touch-target floor; `sm` is for dense toolbars.
 * No `leading-*` here: the button is a fixed-height flex container, so the
 * label is centred regardless of line-height, and adding one would put two
 * classes on the same property for no gain.
 */
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-base',
  lg: 'h-11 px-5 text-md',
  icon: 'h-10 w-10 p-0',
};

/**
 * `link` opts out of the height/padding scale entirely — it is text, not a box.
 * WCAG 2.2 target-size (2.5.8) exempts targets inline in a sentence, and the
 * `text-base` line-height is already 24px, which clears the 24px minimum for a
 * standalone one.
 */
const linkSizeClasses: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-md',
  icon: 'text-base',
};

const iconPixels: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20, icon: 20 };

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * The class string on its own, so an `<a>` or `next/link` can look identical
 * without the invalid `<a><button></a>` nesting. A link styled this way that
 * needs to look unavailable should use `aria-disabled` — the `disabled:`
 * utilities in `base` only apply to real form controls.
 */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonClassOptions = {}): string {
  return cn(
    base,
    variantClasses[variant],
    variant === 'link' ? linkSizeClasses[size] : sizeClasses[size],
    // `w-full` would fight `w-10`, so a square button ignores it.
    fullWidth && size !== 'icon' && 'w-full',
    className,
  );
}

type ButtonOwnProps = {
  variant?: ButtonVariant;
  /**
   * Swaps `iconLeft` for a spinning `loader` and disables the control. The
   * label stays rendered: a spinner that replaces the text destroys the
   * accessible name and reflows the button width.
   */
  loading?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLButtonElement>;
};

/** The non-union shape. Every union member below is assignable to it. */
type ButtonResolvedProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonOwnProps & { size?: ButtonSize };

/**
 * Discriminated on `size` so the type system enforces the accessible name that
 * an icon-only button cannot get from its (absent) text content. Passing
 * `size="icon"` makes the first member unassignable — its `size` excludes
 * `'icon'` — leaving the second, which requires `aria-label`. Intersecting a
 * required `aria-label` over the optional one inherited from `AriaAttributes`
 * flips it to required, because a property is optional only when it is
 * optional in every constituent.
 */
export type ButtonProps =
  | (ButtonResolvedProps & { size?: Exclude<ButtonSize, 'icon'> })
  | (ButtonResolvedProps & { size: 'icon'; 'aria-label': string });

export function Button(props: ButtonProps) {
  // Annotating with the supertype keeps the object rest below off a union
  // type; both members satisfy it, so nothing is cast or lost.
  const resolved: ButtonResolvedProps = props;
  const {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    fullWidth = false,
    className,
    children,
    disabled,
    type = 'button',
    ref,
    ...rest
  } = resolved;

  const leftGlyph = loading ? 'loader' : iconLeft;
  const glyphPixels = variant === 'link' ? 16 : iconPixels[size];

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      // Trade-off: `disabled` also drops the button out of the tab order, so a
      // screen reader user cannot land on it to hear `aria-busy`. Accepted
      // because it is the only reliable way to block a double submit; the
      // status of the work itself belongs in a live region on the page.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {leftGlyph ? (
        <Icon
          name={leftGlyph}
          size={glyphPixels}
          className={cn('shrink-0', loading && 'animate-spin')}
        />
      ) : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={glyphPixels} className="shrink-0" /> : null}
    </button>
  );
}
