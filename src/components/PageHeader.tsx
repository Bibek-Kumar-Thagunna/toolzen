/**
 * Page header — the H1 block every route above the tool shell shares.
 *
 * One H1 per page, always this component, so the document outline is a property
 * of the layout rather than of whoever wrote the page. `eyebrow` is a `<p>` and
 * not an `<h2>` for the same reason: it sits *above* the H1 visually, and a
 * heading above the H1 inverts the outline for anyone navigating by headings.
 *
 * Server component.
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  /** Small label above the title: a category name, a section. Optional. */
  eyebrow?: ReactNode;
  title: string;
  /** One or two sentences. The support line under the H1. */
  description?: ReactNode;
  /** Buttons or badges under the description. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-fg">{eyebrow}</p>
      ) : null}

      {/* `text-balance` keeps a two-line heading from leaving one orphan word on
          the second line, which is the difference between a heading that looks
          typeset and one that looks like it wrapped by accident. */}
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {title}
      </h1>

      {description ? (
        <p className="max-w-prose text-pretty text-md text-fg-muted">{description}</p>
      ) : null}

      {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
    </header>
  );
}
