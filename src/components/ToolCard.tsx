/**
 * ============================================================================
 * TOOL CARD
 * ============================================================================
 * One tool, as a link. Used by the homepage, `/tools`, and every category
 * page — three places that would otherwise each grow their own slightly
 * different card and drift apart.
 *
 * ── Why the whole card is one `<a>` ────────────────────────────────────────
 * The alternative pattern — a `<div>` card with a "stretched link" overlay
 * pinned across it — produces a link whose accessible name is the title while
 * its clickable area is the card, which is fine, and a text selection that is
 * impossible, which is not: dragging to select the tagline drags the link
 * instead. A single anchor wrapping the content has one accessible name, one
 * focus ring, one tab stop, and text inside it still selects normally.
 *
 * ── Why the icon is not announced ──────────────────────────────────────────
 * `Icon` without a `label` is `aria-hidden`. The card already says "Compress
 * Image"; an icon announcing "compress" after it is the same word twice.
 *
 * ── The line clamp ────────────────────────────────────────────────────────
 * Taglines are one sentence by editorial rule, but rules slip, and a grid whose
 * cards are different heights looks broken in a way that is hard to attribute.
 * Two lines is enough for every current tagline with room for a longer one.
 *
 * Server component: it renders inside static pages and ships no JavaScript.
 * ============================================================================
 */
import Link from 'next/link';

import { Icon, type IconName } from '@/components/icons';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/site';

export interface ToolCardProps {
  slug: string;
  name: string;
  tagline: string;
  icon: IconName;
  /** Renders a "New" pill. Computed on the server — see `isRecentlyAdded`. */
  isNew?: boolean;
  className?: string;
}

export function ToolCard({ slug, name, tagline, icon, isNew = false, className }: ToolCardProps) {
  return (
    <Link
      href={routes.tool(slug)}
      className={cn(
        'group flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4',
        'transition-colors duration-fast hover:border-accent-border hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        className,
      )}
    >
      {/* Tinted at rest rather than only on hover. A grid of thirty-two grey
          tiles reads as a table of contents; the same grid with the brand
          colour in it reads as a product, and the tint is quiet enough
          (accent at low opacity behind an accent foreground) that it never
          competes with the tool name beside it. */}
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md',
          'border border-transparent bg-accent-subtle text-accent-fg',
          'transition-colors duration-fast group-hover:border-accent-border',
        )}
      >
        <Icon name={icon} size={19} />
      </span>

      {/* `min-w-0` so the clamped tagline can actually clamp: without it this
          flex child sizes to its content and the card grows instead. */}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-fg group-hover:text-accent-fg">{name}</span>
          {isNew ? (
            <Badge variant="accent" size="sm">
              New
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm text-fg-muted">{tagline}</span>
      </span>
    </Link>
  );
}
