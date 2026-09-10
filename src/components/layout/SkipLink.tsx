/**
 * SkipLink — the first focusable element in the document.
 *
 * WCAG 2.2 2.4.1 (Bypass Blocks). Every page here starts with the same header
 * and a category nav; without this, a keyboard or screen-reader user tabs
 * through all of it on every single page before reaching the tool they came for.
 *
 * ── Why not `sr-only focus:not-sr-only` ─────────────────────────────────────
 * That is the usual recipe, and it needs `focus:fixed` (or `focus:absolute`) to
 * position the revealed link — which puts two *different* Tailwind plugins in
 * charge of `position` on the same element and leaves the winner to stylesheet
 * order. src/lib/cn.ts is explicit that appending a class does not win a
 * conflict. So this is one position (`fixed`), parked off-screen with a
 * transform and slid in by a `focus:` variant of that same transform utility —
 * a base/variant pair of one property, which Tailwind orders reliably.
 *
 * Being off-screen rather than clipped to 1px is also the better behaviour: the
 * link keeps a real box, so the moment it is focused it is a legible 44px-tall
 * target rather than something that grows into one. A `fixed` element outside
 * the viewport adds nothing to the scrollable area, so it cannot cause the
 * horizontal overflow this layout is otherwise careful about.
 *
 * ── Contract with the root layout ──────────────────────────────────────────
 * The target must exist and must be focusable:
 *
 *   <main id={MAIN_CONTENT_ID} tabIndex={-1}>
 *
 * `tabIndex={-1}` is load-bearing, not defensive. Safari and Firefox scroll to
 * a fragment target but historically do not move focus into it unless it is
 * focusable, which turns a skip link into a scroll button for exactly the
 * people who need it most. It stays out of the tab order at -1.
 *
 * Server component.
 */
import { cn } from '@/lib/cn';

/**
 * Shared so the anchor and the layout's `<main>` cannot drift apart. A skip
 * link pointing at an id that no longer exists is silently useless.
 */
export const MAIN_CONTENT_ID = 'main';

export interface SkipLinkProps {
  className?: string;
}

export function SkipLink({ className }: SkipLinkProps) {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        'fixed left-4 top-4 z-50 -translate-y-[200%]',
        'inline-flex min-h-11 items-center rounded-md border border-border-strong',
        'bg-surface-raised px-4 text-sm font-medium text-fg shadow-md',
        'transition-transform duration-fast ease-out focus:translate-y-0',
        className,
      )}
    >
      Skip to content
    </a>
  );
}
