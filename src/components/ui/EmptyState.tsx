/**
 * EmptyState — what a list, queue or result area shows when it has nothing.
 *
 * What: a small glyph in a sunken square, a title, an optional line of
 * explanation, and an optional action slot.
 *
 * Why no illustration: the design brief rules out decorative graphics, and an
 * empty state is the wrong place to spend attention anyway. The user is here
 * because something is missing; the fastest path out is a clear sentence and one
 * button, not a drawing. The glyph exists only to anchor the block visually.
 *
 * Why the title is a `<p>` and not a heading: an empty state can be dropped into
 * any depth of a page, so picking a heading level here would corrupt the
 * document outline in half the places it is used. It is styled at heading
 * weight; it is not part of the outline. Where an empty state genuinely replaces
 * a section's content, the surrounding section already has the heading.
 *
 * `description` is capped at `max-w-sm` on purpose — a centred line longer than
 * that is measurably harder to read, and centred text has no left edge for the
 * eye to return to.
 *
 * Server component. The `action` slot is a `ReactNode`, so a caller passes an
 * already-built `<Button>` or `<Link>` and owns any client behaviour itself.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export type EmptyStateSize = 'sm' | 'md';

const paddingClass: Record<EmptyStateSize, string> = {
  sm: 'gap-3 px-4 py-8',
  md: 'gap-4 px-6 py-12',
};

export interface EmptyStateProps {
  /** Decorative — the title carries the meaning, so it is hidden from AT. */
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: EmptyStateSize;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        paddingClass[size],
        className,
      )}
    >
      {icon ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-subtle">
          <Icon name={icon} size={22} />
        </span>
      ) : null}
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-md font-medium text-fg">{title}</p>
        {description ? <p className="max-w-sm text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
