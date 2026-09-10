/**
 * Breadcrumbs — the visible trail. Data in, list out.
 *
 * The `trail` array comes from `toolTrail()` in the registry rather than being
 * derived from the URL here. That is the whole point of it returning data: the
 * same array feeds this `<nav>` and the BreadcrumbList structured data, so the
 * two physically cannot disagree. A page that shows "Image tools" while telling
 * Google "PDF tools" is a rich-result penalty that no amount of care in one
 * file prevents if the two are computed separately.
 *
 * NOTE: no JSON-LD is emitted here. Structured data is owned by src/lib/seo.ts,
 * which builds the BreadcrumbList from the same `trail`.
 *
 * ── 320px ──────────────────────────────────────────────────────────────────
 * A tool trail is `Home › Tools › Image tools › Compress Image`, which is far
 * wider than a 320px screen. Two mechanisms, both needed:
 *   - the list wraps, so the trail becomes two or three short lines instead of
 *     one line that pushes the document wider than the viewport;
 *   - the final crumb — the only one whose length we do not control, since it is
 *     a tool name — truncates. `min-w-0` on its `<li>` is what permits that: a
 *     flex item refuses to shrink below its content width until you say so, and
 *     without it `truncate` has nothing to truncate against and the page scrolls
 *     sideways instead.
 *
 * The last crumb is text, not a link. A link to the page you are already on is
 * a dead control, and `aria-current="page"` is the state a screen reader
 * announces for it.
 *
 * Server component.
 */
import Link from 'next/link';

import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';

/** Structurally what `toolTrail()` returns. */
export interface BreadcrumbItem {
  name: string;
  href: string;
}

export interface BreadcrumbsProps {
  trail: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ trail, className }: BreadcrumbsProps) {
  // A one-item trail is just the current page's own name — a breadcrumb with
  // nothing to go back to is noise, so render nothing.
  if (trail.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      {/* `role="list"` is not redundant in practice: Safari drops list
          semantics from a list whose display is changed to flex, and this one
          has to be flex to lay the separators out. */}
      <ol role="list" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {trail.map((item, index) => {
          const isLast = index === trail.length - 1;

          return (
            <li key={item.href} className="flex min-w-0 items-center gap-x-1">
              {index > 0 ? (
                // Decorative: `Icon` without a `label` is already aria-hidden
                // and focusable="false", so the trail reads as
                // "Home, Tools, Image tools" rather than a chevron between
                // every word.
                <Icon name="chevron-right" size={14} className="shrink-0 text-fg-subtle" />
              ) : null}

              {isLast ? (
                <span aria-current="page" className="max-w-full truncate font-medium text-fg">
                  {item.name}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="rounded-sm whitespace-nowrap text-fg-muted transition-colors duration-fast hover:text-fg hover:underline"
                >
                  {item.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
