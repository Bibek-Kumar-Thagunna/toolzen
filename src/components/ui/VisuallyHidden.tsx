/**
 * VisuallyHidden — text that exists for assistive technology only.
 *
 * What: applies Tailwind's `sr-only` (clipped to a 1px box, not
 * `display: none`, so screen readers still reach it).
 *
 * Why a component instead of everyone typing `sr-only`: the class says *how*,
 * the component says *why*. A reviewer seeing `<VisuallyHidden>` knows the text
 * is a deliberate accessible-name channel and not a leftover; a reviewer seeing
 * `sr-only` cannot tell it apart from a hack. It also gives us one place to
 * change the technique — `sr-only`'s clip-based approach breaks inside a
 * container with `contain: paint`, and if that ever bites we fix it here rather
 * than in fifty files.
 *
 * Rejected: `hidden`, `display: none` and `visibility: hidden` — all three
 * remove the text from the accessibility tree, which is the opposite of the
 * intent.
 *
 * Server component.
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  /** `div` when the hidden text needs to sit between block siblings. */
  as?: 'span' | 'div';
  children?: ReactNode;
}

export function VisuallyHidden({ as = 'span', className, children, ...rest }: VisuallyHiddenProps) {
  // Widened locally so JSX does not have to reconcile two intrinsic element
  // types; the prop above keeps callers to `span` or `div`.
  const Tag: ElementType = as;

  return (
    <Tag className={cn('sr-only', className)} {...rest}>
      {children}
    </Tag>
  );
}
