/**
 * Header — the chrome above every page.
 *
 * Server component, and worth keeping that way: it renders on every route, so
 * anything it imports is a cost paid site-wide. The two things that genuinely
 * need a browser — the theme toggle and the mobile sheet — are islands, and the
 * command palette is not imported at all but passed in as {@link HeaderProps.search}.
 * That prop hole is what stops this file from becoming a client module by
 * accident: the palette needs state, a search index and keyboard handling, and
 * one `import` of it here would drag all of it into the layout's client graph.
 *
 * ── Sticky without layout shift ────────────────────────────────────────────
 * `h-header` is `var(--header-h)` — 3.5rem, 4rem from `md` — declared in
 * globals.css and consumed here and by `scroll-padding-top`, so an in-page
 * anchor never lands underneath the bar. Fixed height plus normal flow means
 * `position: sticky` costs no reflow when the page scrolls: the element already
 * occupies its own space.
 *
 * `bg-canvas/85 backdrop-blur` rather than an opaque bar so long tool output
 * reads as continuing underneath, and the border is `border-subtle` because a
 * full-strength line under a translucent bar reads as heavier than it is.
 *
 * ── Contract with the `search` slot ────────────────────────────────────────
 * The header is a single flex row with a fixed height and, at `md`, six category
 * labels in it. Measured at 768px there is roughly 30px of slack, so the node
 * passed as `search` must be icon-sized (a 40px button) below `lg`, and may
 * become a wide "Search tools ⌘K" box from `lg` up. That is the one thing this
 * file cannot enforce for whoever builds the palette.
 *
 * ── Skip link placement ────────────────────────────────────────────────────
 * `<SkipLink />` is rendered before `<header>` so it is the first focusable
 * element in the document — which only holds if the root layout renders
 * `<Header />` as the first thing in `<body>`. It also keeps it out of the
 * header's `backdrop-filter` stacking context, where a `fixed` child would be
 * trapped.
 */
import type { ReactNode } from 'react';

import Link from 'next/link';

import { brand } from '@/lib/brand';
import { categories } from '@/lib/registry/categories';
import { routes } from '@/lib/site';

import { Container } from './Container';
import { MobileMenu, type CategoryLink } from './MobileMenu';
import { NavLinks } from './NavLinks';
import { SkipLink } from './SkipLink';
import { ThemeToggle } from './ThemeToggle';

export interface HeaderProps {
  /**
   * The command-palette trigger, rendered before the theme toggle. A node, not
   * an import — see the note above. Omitted (e.g. on an error page) the header
   * still works.
   */
  search?: ReactNode;
}

/**
 * Projected once, at module scope, and handed to both the desktop nav and the
 * mobile sheet so the two cannot list different categories. Only these four
 * fields cross into client components: the registry itself carries every tool's
 * FAQ and prose and must never be imported by one.
 *
 * `categories.ts` sorts by `order` for `categoryIds` but exports the array in
 * declaration order, so the sort is repeated here rather than assumed.
 */
const categoryLinks: CategoryLink[] = categories
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((category) => ({
    id: category.id,
    name: category.name,
    href: routes.category(category.slug),
    icon: category.icon,
  }));

export function Header({ search }: HeaderProps) {
  return (
    <>
      <SkipLink />

      <header className="sticky top-0 z-40 h-header border-b border-border-subtle bg-canvas/85 backdrop-blur">
        <Container className="flex h-full items-center gap-1">
          {/* Wordmark. No logo file: a 10px accent diamond and the name set
              tight is a mark, and it costs no request, scales to any density and
              recolours with the theme. Deliberately not one of the category
              glyphs, which would make the brand read as "Generators". */}
          <Link
            href={routes.home}
            className="mr-1 flex shrink-0 items-center gap-2 rounded-sm py-1 pr-1 text-md font-semibold tracking-tight text-fg"
          >
            <span className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-xs bg-accent" />
            {brand.name}
          </Link>

          {/* Below `md` these six links live in the sheet instead. */}
          <NavLinks items={categoryLinks} className="ml-1 hidden md:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {search}
            <ThemeToggle />
            <MobileMenu categories={categoryLinks} />
          </div>
        </Container>
      </header>
    </>
  );
}
