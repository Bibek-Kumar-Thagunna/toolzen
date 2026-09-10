/**
 * Prose — typography for the written pages (about, privacy, terms).
 *
 * ── Why classes and not `@tailwindcss/typography` ──────────────────────────
 * The plugin is excellent and would be the right call for user-supplied
 * Markdown. Here every page is hand-written TSX using the design system's own
 * colour tokens, and the plugin brings its own `--tw-prose-*` palette that has
 * to be re-mapped onto those tokens before a single page renders correctly in
 * dark mode. That is more configuration than the twelve selectors below, plus a
 * dependency, to style four pages.
 *
 * ── The measure ───────────────────────────────────────────────────────────
 * `max-w-prose` is 68ch, set in the Tailwind config and shared with
 * `Container size="prose"`. Line length is a function of the font, not of the
 * viewport, which is why it is expressed in characters.
 *
 * Server component.
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'max-w-prose text-pretty text-fg-muted',
        // Vertical rhythm comes from the flow, not from margins on every child:
        // `space-y` cannot collapse the way stacked margins do, so a heading
        // after a list is spaced the same as a heading after a paragraph.
        '[&>*+*]:mt-4',
        '[&>h2]:mt-10 [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg',
        '[&>h3]:mt-8 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:text-fg',
        '[&>h2+p]:mt-3 [&>h3+p]:mt-2',
        '[&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5',
        '[&>ol]:list-decimal [&>ol]:space-y-1.5 [&>ol]:pl-5',
        '[&_a]:font-medium [&_a]:text-accent-fg [&_a]:underline [&_a]:underline-offset-2',
        '[&_strong]:font-semibold [&_strong]:text-fg',
        '[&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
