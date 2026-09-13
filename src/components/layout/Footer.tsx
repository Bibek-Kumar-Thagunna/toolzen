/**
 * Footer — the site-wide link floor and the honesty line.
 *
 * Server component, and it imports the registry directly. That is the correct
 * side of the boundary: the footer wants every tool's name and slug, which is
 * exactly the data the registry holds, and none of it reaches the client as
 * JavaScript — it arrives as HTML that has already been rendered.
 *
 * ── Why the footer carries every tool ──────────────────────────────────────
 * Two reasons, and only one of them is SEO. Internal links are how a crawler
 * discovers a 24-page site with no external backlinks, so a footer that lists
 * the tools puts every page one hop from every other page. The other reason is
 * that a visitor who lands on one tool from a search result has no other way to
 * learn that the rest exist; the header shows six categories, the footer shows
 * the actual work.
 *
 * ── The 6-link cap ─────────────────────────────────────────────────────────
 * A column is capped at six tools plus a "View all N" link. Uncapped, the image
 * column grows every time a tool is added until the footer is taller than the
 * page it sits under, and the links at the bottom of a 40-item list are worth
 * nothing to either audience. N is read from the registry, never typed: a
 * hardcoded "View all 8" that says 8 while the category holds 11 is a small lie
 * that outlives whoever wrote it. The column heading is itself a link to the
 * category, so the category page is reachable from every column whether or not
 * the cap bites.
 *
 * ── Touch targets ──────────────────────────────────────────────────────────
 * These are dense text links, not toolbar controls, so the 44px floor applied to
 * the header buttons would make the footer absurd. They satisfy WCAG 2.2 2.5.8
 * the other way it can be satisfied: 20px line-height plus `space-y-2` puts 28px
 * between link centres, past the 24px spacing exception.
 *
 * ── The privacy line ───────────────────────────────────────────────────────
 * Computed from the registry, not written by hand. Every tool currently declares
 * `processing: 'browser'`, which the integrity checker verifies means no network
 * I/O in its engine, so the strong claim is true and gets to be stated. Add one
 * server-side tool and this line hedges itself on the next build rather than
 * becoming a lie nobody remembers to edit. There is no "encrypted", no
 * "military-grade" and no "we delete your files" here: the first two are
 * meaningless for work that never leaves the device, and the third would be a
 * claim about a server that does not exist.
 */
import Link from 'next/link';

import { Icon } from '@/components/icons';
import { Logo } from '@/components/Logo';
import { brand, promises } from '@/lib/brand';
import { categoriesWithTools, toolCount, tools } from '@/lib/registry';
import { routes } from '@/lib/site';

import { Container } from './Container';

const MAX_LINKS_PER_COLUMN = 6;

const everyToolRunsInBrowser = tools.every((tool) => tool.processing === 'browser');

const privacyLine = everyToolRunsInBrowser
  ? promises.browserOnly
  : 'Most tools run entirely in your browser; each tool page states where its work happens.';

const siteLinks = [
  { href: routes.tools, label: `All ${toolCount} tools` },
  { href: routes.categories, label: 'Browse categories' },
  // Sitewide, so every guide is two clicks from every page. A section reachable
  // only from its own index is a section a crawler visits once.
  { href: routes.guides, label: 'Guides' },
  { href: routes.about, label: 'About' },
  { href: routes.privacy, label: 'Privacy' },
  { href: routes.terms, label: 'Terms' },
];

const linkClasses =
  'rounded-sm text-sm text-fg-muted transition-colors duration-fast hover:text-fg hover:underline';

export function Footer() {
  // Baked at build time on a static page, so it goes stale until the next
  // deploy. Accepted: opting the whole site out of static rendering for a
  // copyright year would be the worse trade, and the range below means the
  // stale value is a year that was true rather than a wrong one.
  const year = new Date().getFullYear();
  const years = year > brand.foundedYear ? `${brand.foundedYear}–${year}` : `${year}`;

  return (
    <footer className="border-t border-border-subtle bg-surface-sunken">
      <Container className="py-10 sm:py-12">
        <div className="max-w-sm">
          {/* The same mark as the header, one size down. A footer that uses a
              different glyph reads as a different site. */}
          <Logo size={24} />
          <p className="mt-2.5 text-sm text-fg-muted">{brand.tagline}</p>
        </div>

        {/* A second navigation landmark, labelled, so a screen reader user can
            tell it apart from the header's two in the landmarks list. The
            columns are a plain grid rather than one `<ul>` of `<ul>`s: each
            column is its own labelled list, which is what it is. */}
        <nav aria-label="Footer" className="mt-10 sm:mt-12">
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {categoriesWithTools().map(({ category, tools: categoryTools }) => {
              const shown = categoryTools.slice(0, MAX_LINKS_PER_COLUMN);
              const hasMore = categoryTools.length > shown.length;

              return (
                <div key={category.id}>
                  <h2 className="text-sm font-semibold text-fg">
                    <Link
                      href={routes.category(category.slug)}
                      className="rounded-sm hover:underline"
                    >
                      {category.name}
                    </Link>
                  </h2>

                  <ul role="list" className="mt-3 space-y-2">
                    {shown.map((tool) => (
                      <li key={tool.slug}>
                        <Link href={routes.tool(tool.slug)} className={linkClasses}>
                          {tool.name}
                        </Link>
                      </li>
                    ))}

                    {hasMore ? (
                      <li>
                        <Link
                          href={routes.category(category.slug)}
                          className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-accent-fg transition-colors duration-fast hover:underline"
                        >
                          View all {categoryTools.length}
                          <Icon name="chevron-right" size={14} className="shrink-0" />
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}

            <div>
              <h2 className="text-sm font-semibold text-fg">Site</h2>
              <ul role="list" className="mt-3 space-y-2">
                {siteLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClasses}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </nav>
      </Container>

      {/* Own bordered strip rather than a `border-t` row inside the Container
          above, so the rule runs the full width of the viewport instead of
          stopping at the 90rem gutter. */}
      <div className="border-t border-border-subtle">
        <Container className="flex flex-col gap-2 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="text-xs text-fg-muted">
            © {years} {brand.name}
          </p>
          {/* `items-start` and the 1px nudge, not `items-center`: this line wraps
              to two rows at 320px, and a centred icon would drift to the middle
              of the block instead of sitting with the first line of text. */}
          <p className="flex items-start gap-1.5 text-xs text-fg-muted">
            <Icon name="shield" size={14} className="mt-px shrink-0 text-fg-subtle" />
            {privacyLine}
          </p>
        </Container>
      </div>
    </footer>
  );
}
