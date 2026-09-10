'use client';

/**
 * MobileMenu — the header navigation below `md`, as an edge-anchored sheet.
 *
 * ── Why not the existing `ui/Dialog` ───────────────────────────────────────
 * Dialog is a centred box, and its geometry is baked into its own class string:
 * `m-auto`, `max-h-[85dvh]`, `w-[calc(100%_-_2rem)]`, `sm:max-w-lg`,
 * `rounded-lg`, `animate-scale-in`. A navigation sheet is the opposite shape —
 * flush to one edge, full viewport height, square on the flush side, sliding
 * rather than scaling.
 *
 * Reaching that through Dialog's `className` would mean overriding five of those
 * utilities, and src/lib/cn.ts is explicit that this does not work: there is no
 * `tailwind-merge` here, and a class appended to the attribute does not win a
 * conflict — Tailwind resolves conflicts by position in the generated
 * stylesheet. `m-auto` versus `ml-auto mr-0` would come down to plugin order,
 * i.e. to luck. So this is not a taste call: Dialog cannot be reshaped from
 * outside, and its own doc comment says a component that needs true conflict
 * resolution is a component being used wrongly.
 *
 * What this file does instead is reuse Dialog's *reasoning* on a second native
 * `<dialog>`, and the platform hands over the hard parts:
 *   - `showModal()` promotes to the top layer, so no z-index arithmetic against
 *     the sticky header and no escaping an `overflow: hidden` ancestor;
 *   - a real focus trap, including the tab cycle, implemented by the browser;
 *   - Escape to dismiss;
 *   - the rest of the document marked inert;
 *   - focus restored to the element that opened it — the trigger — on close,
 *     per the dialog closing steps, so there is nothing to hand-roll;
 *   - a `::backdrop` pseudo-element.
 *
 * Two gotchas carried over from Dialog, both load-bearing:
 *   - Layout classes sit behind Tailwind's `open:` variant. Hiding a closed
 *     dialog is a *user-agent* rule (`dialog:not([open]) { display: none }`) and
 *     author styles beat UA styles, so a bare `flex` would make the closed sheet
 *     visible on every page.
 *   - `p-0`. Clicking the shaded area reports `event.target` as the `<dialog>`
 *     itself, because the backdrop is that element's own pseudo-element; padding
 *     on the dialog would make its inner gutter read as "outside" and close the
 *     sheet on a stray tap. All padding lives on the rows inside.
 *   - `max-h-none max-w-none` defeat the UA's `dialog:modal` size cap
 *     (`calc(100% - 6px - 2em)`), which would otherwise stop the sheet ~38px
 *     short of the viewport edges.
 *
 * ── The desktop trap ───────────────────────────────────────────────────────
 * The whole component is `md:hidden`, so on a wide viewport it generates no box
 * at all. That is also a hazard: a sheet left open while the viewport crosses to
 * `md` — rotating a tablet, or resizing — would be `display: none` while the
 * document behind it is still inert. An invisible modal over a frozen page. The
 * media listener below closes it at the breakpoint, which is the one piece of
 * JavaScript here that is not optional.
 */
import { useEffect, useId, useRef, useState } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon, type IconName } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/site';

/**
 * Plain, serialisable, and no wider than it needs to be. The registry is a
 * server-only module — it carries every tool's FAQ and prose — so what crosses
 * this boundary is four strings per category, projected by the Header.
 */
export interface CategoryLink {
  id: string;
  name: string;
  href: string;
  icon: IconName;
}

export interface MobileMenuProps {
  categories: CategoryLink[];
  className?: string;
}

/** Same 44px hit-area technique as ThemeToggle; the rationale is documented there. */
const tapTarget44 =
  'relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 ' +
  'after:-translate-x-1/2 after:-translate-y-1/2';

/**
 * Tailwind's `md`. Duplicated in JavaScript because a media query cannot be read
 * out of the Tailwind config at runtime; if the breakpoint moves in
 * tailwind.config.ts, it moves here too.
 */
const MD_QUERY = '(min-width: 768px)';

interface MenuLinkProps {
  href: string;
  icon: IconName;
  label: string;
  current: boolean;
}

/**
 * One row of the sheet. `min-h-11` is 44px — the touch-target floor for a
 * primary navigation control on a phone, and comfortably past WCAG 2.2 2.5.8.
 * The row is the target, not the text inside it.
 */
function MenuLink({ href, icon, label, current }: MenuLinkProps) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex min-h-11 items-center gap-3 rounded-md px-3 text-md transition-colors duration-fast',
          // Three signals for the current page — weight, background and
          // `aria-current` — because colour alone is not one (WCAG 1.4.1).
          current
            ? 'bg-accent-subtle font-medium text-accent-fg'
            : 'font-normal text-fg hover:bg-surface-hover',
        )}
      >
        <Icon
          name={icon}
          size={18}
          className={cn('shrink-0', current ? 'text-accent' : 'text-fg-subtle')}
        />
        {label}
      </Link>
    </li>
  );
}

export function MobileMenu({ categories, className }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const pathname = usePathname();

  const base = useId();
  const panelId = `${base}-panel`;
  const titleId = `${base}-title`;
  const categoriesId = `${base}-categories`;

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    // Checked both ways: `showModal()` on an open dialog throws, and `close()`
    // on a closed one fires a spurious `close` event.
    if (open) {
      if (!node.open) node.showModal();
    } else if (node.open) {
      node.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Browsers disagree on whether the inert page behind a modal can still be
    // wheel- or touch-scrolled, so it is pinned. Save/restore rather than a
    // counter: this composes correctly with ui/Dialog's own reference-counted
    // lock in either nesting order, and two modals open at once is not
    // reachable here — the sheet makes the rest of the document inert.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // Close on navigation. A sheet still sitting over the page you just asked for
  // is the single most common mobile-nav bug. Setting `false` when it is already
  // `false` — every first render — is a no-op React bails out of.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia(MD_QUERY);
    if (media.matches) {
      setOpen(false);
      return;
    }
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [open]);

  return (
    <div className={cn('md:hidden', className)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Site menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        className={tapTarget44}
      >
        <Icon name="menu" size={20} />
      </Button>

      <dialog
        ref={dialogRef}
        id={panelId}
        aria-labelledby={titleId}
        // The single funnel for every dismissal — Escape, `close()`, the button,
        // the backdrop. `cancel` is deliberately not handled: its default action
        // is to close, which fires `close`, so handling both runs this twice.
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className={cn(
          'my-0 ml-auto mr-0 h-dvh max-h-none w-[min(20rem,86vw)] max-w-none',
          'overflow-hidden border-l border-border bg-surface p-0 text-fg shadow-lg',
          'open:flex open:flex-col open:animate-fade-in',
          'backdrop:bg-fg/40',
        )}
      >
        {open ? (
          /* Gated on `open`. A closed dialog is already hidden, but its children
             would still mount on every mobile page view. Nothing is lost to
             crawlers: NavLinks and the footer render the same routes in the
             server HTML. */
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
              <h2 id={titleId} className="px-1 text-md">
                Menu
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className={tapTarget44}
              >
                <Icon name="x" size={18} />
              </Button>
            </div>

            {/* The body scrolls, not the sheet, so the title bar stays put on a
                short landscape viewport. `min-h-0` is what lets a flex child
                shrink below its content height and scroll at all. */}
            <nav
              aria-label="Site"
              className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-3"
            >
              <ul role="list" className="space-y-0.5">
                <MenuLink
                  href={routes.home}
                  icon="home"
                  label="Home"
                  current={pathname === routes.home}
                />
                <MenuLink
                  href={routes.tools}
                  icon="grid"
                  label="All tools"
                  current={pathname === routes.tools}
                />
                <MenuLink
                  href={routes.categories}
                  icon="folder"
                  label="Browse categories"
                  current={pathname === routes.categories}
                />
              </ul>

              <h3
                id={categoriesId}
                className="mt-5 px-3 text-2xs uppercase tracking-wide text-fg-subtle"
              >
                Categories
              </h3>
              <ul role="list" aria-labelledby={categoriesId} className="mt-1 space-y-0.5">
                {categories.map((category) => (
                  <MenuLink
                    key={category.id}
                    href={category.href}
                    icon={category.icon}
                    label={category.name}
                    current={pathname === category.href}
                  />
                ))}
              </ul>

              <ul role="list" className="mt-5 space-y-0.5 border-t border-border-subtle pt-3">
                <MenuLink
                  href={routes.about}
                  icon="info"
                  label="About"
                  current={pathname === routes.about}
                />
              </ul>
            </nav>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
