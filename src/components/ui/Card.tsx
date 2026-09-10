/**
 * Card — the bordered surface that tool panels, result blocks and grid items
 * are built from.
 *
 * What: one container plus five thin slots (`CardHeader`, `CardTitle`,
 * `CardDescription`, `CardBody`, `CardFooter`) that carry layout and type scale
 * and nothing else.
 *
 * Why `interactive` does not set `cursor-pointer`: a pointer cursor on a
 * `<div>` advertises a control that does not exist — nothing to focus, nothing
 * for Enter/Space, nothing announced. `interactive` only lifts the shadow and
 * strengthens the border on hover; the affordance itself must be a real `<a>`
 * or `<button>` rendered inside the card.
 *
 * Rejected: an `href` prop turning the whole card into an anchor. It makes every
 * nested control an invalid `<a>` descendant and breaks text selection.
 *
 * Why the slots carry no outer margin: `src/lib/cn.ts` documents that a
 * caller's `className` is appended but does not win Tailwind conflicts, so a
 * default `mb-4` here would be un-overridable. Vertical rhythm belongs to the
 * caller — normally `<Card className="space-y-4">`.
 *
 * Server component: no hooks, no handlers, zero client JavaScript.
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type CardVariant = 'default' | 'raised' | 'sunken' | 'plain';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const variantClass: Record<CardVariant, string> = {
  default: 'border border-border bg-surface',
  raised: 'border border-border bg-surface-raised shadow-sm',
  sunken: 'border border-border-subtle bg-surface-sunken',
  // No fill and no outline: for a card nested inside another card, where a
  // second border reads as a box drawn inside a box.
  plain: '',
};

const paddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li';
  variant?: CardVariant;
  padding?: CardPadding;
  /** Hover feedback for a card that *contains* a link or button. See note above. */
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({
  as = 'div',
  variant = 'default',
  padding = 'md',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  // Widened to `ElementType` so JSX does not have to reconcile the ref and
  // event-handler types of four different intrinsic elements. `CardProps` still
  // constrains callers to the four tags, so nothing is lost at the boundary.
  const Tag: ElementType = as;

  return (
    <Tag
      className={cn(
        'rounded-lg',
        variantClass[variant],
        paddingClass[padding],
        interactive &&
          'transition-shadow duration-fast hover:border-border-strong hover:shadow-md',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardHeader({ className, children, ...rest }: CardHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * Heading level. Defaults to `h3` because a card usually sits under a page
   * `h1` and a section `h2`. Pick the level that keeps the outline correct —
   * never the one that happens to look right, since size is set here anyway.
   */
  as?: 'h2' | 'h3' | 'h4';
  children?: ReactNode;
}

export function CardTitle({ as = 'h3', className, children, ...rest }: CardTitleProps) {
  const Tag: ElementType = as;

  // Only the size is set here: the `@layer base` rule in globals.css already
  // gives every h1–h4 `font-semibold text-fg text-balance`.
  return (
    <Tag className={cn('text-md', className)} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
}

export function CardDescription({ className, children, ...rest }: CardDescriptionProps) {
  return (
    <p className={cn('text-sm text-fg-muted', className)} {...rest}>
      {children}
    </p>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardBody({ className, children, ...rest }: CardBodyProps) {
  // `min-w-0` is the one real default: without it a long unbroken token (a
  // hash, a JWT, a base64 blob) forces a flex or grid parent wider than the
  // viewport instead of wrapping.
  return (
    <div className={cn('min-w-0', className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function CardFooter({ className, children, ...rest }: CardFooterProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} {...rest}>
      {children}
    </div>
  );
}
