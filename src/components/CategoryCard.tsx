/**
 * Category card — one category, as a link, with an honest count.
 *
 * The count is passed in rather than read from the registry here, because this
 * renders inside grids that already have the tool list in hand; fetching it
 * twice would let the number on the card disagree with the number of cards the
 * page goes on to render.
 *
 * "12 tools" is a fact, so it is rendered as text rather than a badge: a badge
 * is for a state that changes (New, Beta), and dressing a stable count as one
 * trains people to stop reading badges.
 *
 * Server component.
 */
import Link from 'next/link';

import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/site';

export interface CategoryCardProps {
  id: string;
  name: string;
  tagline: string;
  icon: IconName;
  count: number;
  className?: string;
}

export function CategoryCard({ id, name, tagline, icon, count, className }: CategoryCardProps) {
  return (
    <Link
      href={routes.category(id)}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-5',
        'transition-colors duration-fast hover:border-accent-border hover:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        className,
      )}
    >
      <span className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md',
            'border border-border-subtle bg-surface-sunken text-fg-muted',
            'transition-colors duration-fast group-hover:border-accent-border group-hover:bg-accent-subtle group-hover:text-accent-fg',
          )}
        >
          <Icon name={icon} size={20} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-fg group-hover:text-accent-fg">{name}</span>
          <span className="block text-xs text-fg-muted">
            {count} {count === 1 ? 'tool' : 'tools'}
          </span>
        </span>
      </span>

      <span className="text-sm text-fg-muted">{tagline}</span>

      <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-accent-fg">
        Browse
        <Icon
          name="arrow-right"
          size={15}
          className="transition-transform duration-fast group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
