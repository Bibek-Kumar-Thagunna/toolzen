'use client';

/**
 * Dialog — a modal built on the native `<dialog>` element.
 *
 * ── Why native ──────────────────────────────────────────────────────────────
 * `showModal()` gives us, for free and with no dependency:
 *   - top-layer rendering, so no z-index arithmetic and no escaping a parent
 *     with `overflow: hidden` or a `transform`;
 *   - a real `::backdrop` pseudo-element;
 *   - a focus trap implemented by the browser, including the tab cycle;
 *   - Esc to dismiss;
 *   - the rest of the document marked inert, which is the part hand-rolled
 *     modals almost always get wrong.
 *
 * Rejected: a portal into `document.body` plus a manual focus trap. That is
 * roughly 150 lines of focusable-element querying, sentinel nodes and
 * `keydown` interception that has to be maintained against every new focusable
 * element type — and it is still worse for assistive technology than what the
 * platform already ships.
 *
 * ── The `display` trap ──────────────────────────────────────────────────────
 * Hiding a closed `<dialog>` is a *user-agent* rule: `dialog:not([open])
 * { display: none }`. Author styles beat UA styles, so a plain `flex` class on
 * this element would make a closed dialog visible. That is why the layout
 * classes are behind Tailwind's `open:` variant — `open:flex open:flex-col`.
 *
 * ── Backdrop click ──────────────────────────────────────────────────────────
 * A native modal does not close on backdrop click, so we add it. The trick:
 * clicking the shaded area outside the box reports `event.target` as the
 * `<dialog>` element itself, because the backdrop is that element's own
 * pseudo-element. Anything inside reports the inner node. So
 * `event.target === dialogRef.current` means "outside".
 *
 * This only holds while the dialog's own box is entirely covered by children,
 * which is why `p-0` is load-bearing: padding belongs to the dialog element, so
 * a padded dialog would treat clicks on its own inner gutter as backdrop clicks
 * and close on them. All padding lives on the header/body/footer instead. The
 * 1px border is the one remaining sliver that counts as outside; at 1px that is
 * not worth a hit-test.
 *
 * ── Closing ─────────────────────────────────────────────────────────────────
 * We listen for `close` only, not `close` *and* `cancel`. `cancel` (Esc) has a
 * default action of closing the dialog, which then fires `close` — handling both
 * would invoke `onClose` twice per Esc. `close` is the single funnel: Esc,
 * `close()`, backdrop, and any `<form method="dialog">` inside all end there.
 *
 * ── Children are gated on `open` ────────────────────────────────────────────
 * A closed `<dialog>` is already hidden, but its React children would still
 * mount, run effects, boot workers and fetch. Rendering them only while open
 * costs one extra mount per opening and saves all of that on every page that
 * merely *has* a dialog.
 *
 * No `aria-modal="true"`: it is redundant for a dialog opened with
 * `showModal()`, and specifying it by hand is discouraged precisely because the
 * platform already sets the semantics.
 */
import { useEffect, useId, useRef } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * Scroll lock, reference-counted at module scope.
 *
 * `<dialog>` marks the document inert but browsers still differ on whether the
 * page behind a modal can be wheel-scrolled, so we pin it. The counter is the
 * guard against double application: with two dialogs open, a naive
 * save/restore pair would record `'hidden'` as the "previous" value on the
 * second one and leave the page locked forever after both close.
 */
let lockDepth = 0;
let restoreOverflow = '';

function lockDocumentScroll(): () => void {
  const root = document.documentElement;
  if (lockDepth === 0) {
    restoreOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  lockDepth += 1;

  let released = false;
  return () => {
    // React 19 in development mounts, unmounts and remounts effects; a cleanup
    // that ran twice would drive the counter negative and unlock early.
    if (released) return;
    released = true;
    lockDepth -= 1;
    if (lockDepth === 0) root.style.overflow = restoreOverflow;
  };
}

export type DialogSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

export interface DialogProps {
  open: boolean;
  /** Called for every dismissal path: Esc, backdrop, and the close button. */
  onClose: () => void;
  title: string;
  description?: string;
  size?: DialogSize;
  children?: ReactNode;
  footer?: ReactNode;
  /** Accessible name for the close button. Default 'Close'. */
  closeLabel?: string;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  closeLabel = 'Close',
  className,
}: DialogProps) {
  // React 19: `ref` is an ordinary prop and `forwardRef` is unnecessary, but a
  // ref is still how we reach the imperative `showModal()` / `close()` API.
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const base = useId();
  const titleId = `${base}-title`;
  const descriptionId = `${base}-description`;

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    // `node.open` is checked both ways: `showModal()` on an already-open dialog
    // throws, and `close()` on a closed one fires a spurious `close` event.
    if (open) {
      if (!node.open) node.showModal();
    } else if (node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return lockDocumentScroll();
  }, [open]);

  const handleClose = () => {
    // Fires for every closure path — including the `close()` we issue ourselves
    // when `open` goes false, which the parent already knows about.
    if (open) onClose();
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={handleClose}
      onClick={handleClick}
      className={cn(
        // `p-0` is required by the backdrop hit-test above, not cosmetic.
        // Underscores in the arbitrary value become spaces, which `calc()`
        // requires around `-`.
        'm-auto max-h-[85dvh] w-[calc(100%_-_2rem)] overflow-hidden rounded-lg border border-border bg-surface p-0 text-fg shadow-lg',
        // Layout behind `open:` so it cannot defeat the UA's display: none.
        'open:flex open:flex-col open:animate-scale-in',
        // No blur: the design brief rules out glassmorphism, and a plain wash
        // keeps the text behind legible enough to orient by.
        'backdrop:bg-fg/40 backdrop:backdrop-blur-none',
        sizeClass[size],
        className,
      )}
    >
      {open ? (
        <>
          <div className="flex items-start gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-fg-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="-mr-1.5 -mt-1 shrink-0 rounded p-1.5 text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          {/* The body scrolls, not the whole dialog, so the title and the
              actions stay put on a short viewport. `min-h-0` is what allows a
              flex child to shrink below its content height and scroll at all. */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
