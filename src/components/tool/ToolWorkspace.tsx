import type { ReactNode } from 'react';

import { AdFreeZone } from '@/components/ads/AdContext';
import { Alert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { cn } from '@/lib/cn';

/**
 * ============================================================================
 * TOOL WORKSPACE
 * ============================================================================
 * The bordered surface a tool lives in: input, controls, progress, result. It
 * does three jobs, and each one exists so that no individual tool has to
 * remember it.
 *
 * ── 1. It is an ad-free zone, structurally ─────────────────────────────────
 * The children are wrapped in {@link AdFreeZone}, so an `<AdSlot>` rendered
 * anywhere inside — now, or by someone adding a section in a year — renders
 * nothing at all. The rule "no ad may appear among the tool controls" is
 * therefore enforced by the component tree rather than by review: there is no
 * prop that would let a slot opt back in.
 *
 * ── 2. It owns the error surface ───────────────────────────────────────────
 * One place, at the top of the workspace, `role="alert"`. Tools pass a sentence
 * and nothing else. Because there is exactly one slot, a tool cannot show two
 * contradictory errors, and because it is inside the workspace it moves with the
 * tool on small screens instead of scrolling away above the fold.
 *
 * ── 3. It owns the live region ─────────────────────────────────────────────
 * A visually hidden, polite live region for phase changes: "Compressing 3 of
 * 20", "Done — 20 images ready". Sighted users get this from the progress bar
 * and the result panel; without the live region a screen reader user gets
 * silence between pressing a button and the result appearing, which is
 * indistinguishable from a page that did nothing.
 *
 * `aria-atomic` is set so the whole sentence is re-read on change rather than
 * only the words that differ — "3 of 20" alone is not a useful announcement.
 * ============================================================================
 */

export interface ToolWorkspaceProps {
  /** Names the region for assistive technology, e.g. "Compress images". */
  label: string;
  /** A sentence for the user. Never an exception message — see `useToolRun`. */
  error?: string | null;
  /** Announced politely when it changes. Keep it short and plain. */
  status?: string | null;
  /** Rendered above the surface, outside the card: a short instruction line. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ToolWorkspace({
  label,
  error,
  status,
  intro,
  children,
  className,
}: ToolWorkspaceProps) {
  return (
    <AdFreeZone>
      <section aria-label={label} className={cn('space-y-3', className)}>
        {intro ? <p className="text-sm text-fg-muted">{intro}</p> : null}

        {/* The live region is always in the tree, even when empty: a region
            inserted at the same moment as its text is not announced by most
            screen readers, because there was nothing there to change. */}
        <VisuallyHidden as="div" role="status" aria-live="polite" aria-atomic="true">
          {status ?? ''}
        </VisuallyHidden>

        {error ? <Alert variant="danger">{error}</Alert> : null}

        {/* `padding="lg"` on desktop-sized cards and a tighter inner rhythm:
            the workspace is the hero of the page, so it gets the room. */}
        <Card padding="lg" className="space-y-4">
          {children}
        </Card>
      </section>
    </AdFreeZone>
  );
}
