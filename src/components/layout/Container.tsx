/**
 * Container — the one horizontal-rhythm primitive.
 *
 * Every page, section, header and footer funnels its width and side padding
 * through this component. The alternative — repeating
 * `mx-auto w-full max-w-shell px-4 sm:px-6 lg:px-8` per page — looks harmless
 * and fails in a specific, expensive way: the strings drift. One page ends up
 * `px-4 md:px-6`, another `max-w-7xl`, and a third forgets `w-full` and
 * collapses inside a flex parent. The symptom is that the header, the tool and
 * the footer no longer share a left edge, which reads as sloppiness on every
 * page at once and is tedious to find because nothing is technically broken.
 *
 * With one component, "the gutter is 16px on phones and 32px on desktop" is a
 * fact about the product, changed in one line, and a reviewer can see at a
 * glance that a new page is aligned with every existing one.
 *
 * ── The three widths ───────────────────────────────────────────────────────
 *   shell (90rem) — page chrome and grids. Wide enough that a 6-across tool
 *                   grid does not look sparse on a 1440px display.
 *   tool  (52rem) — a single tool's controls. Past ~52rem a form's labels and
 *                   inputs drift so far apart they stop reading as pairs.
 *   prose (68ch)  — long-form copy, measured in characters because line length
 *                   is a function of the font, not of the viewport.
 *
 * `as` exists so the semantic element and the width are chosen together:
 * `<Container as="main">` is the page's landmark and its measure in one node,
 * rather than a `<main>` wrapping a `<div>` that does the real work.
 *
 * No padding-y here. Vertical rhythm belongs to the page, which knows whether a
 * section follows a hero or another section; baking it in would mean every
 * caller fighting it with a negative margin.
 *
 * Server component.
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ContainerSize = 'shell' | 'tool' | 'prose';

const sizeClasses: Record<ContainerSize, string> = {
  shell: 'max-w-shell',
  tool: 'max-w-tool',
  prose: 'max-w-prose',
};

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  /** Semantic element. Deliberately a closed list, not `ElementType`. */
  as?: 'div' | 'section' | 'main' | 'article';
  size?: ContainerSize;
  children?: ReactNode;
}

export function Container({
  as = 'div',
  size = 'shell',
  className,
  children,
  ...rest
}: ContainerProps) {
  // Widened locally so JSX does not have to reconcile four intrinsic element
  // types; the prop above is what keeps callers honest. Same pattern as
  // VisuallyHidden.
  const Tag: ElementType = as;

  return (
    <Tag
      className={cn('mx-auto w-full px-4 sm:px-6 lg:px-8', sizeClasses[size], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
