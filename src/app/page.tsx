/**
 * ============================================================================
 * HOMEPAGE
 * ============================================================================
 * The shop window. Three jobs, in this order: say what this is, get the visitor
 * into a tool, and show a crawler the whole catalogue.
 *
 * ── No advertising here, deliberately ──────────────────────────────────────
 * `/` is in `AD_FREE_ROUTES` and the page renders no `AdSlot` at all. The
 * homepage has the lowest commercial intent on the site — nobody arrives here
 * to buy anything, they arrive to find out whether we are worth using — and it
 * is where the "no clutter" claim either lands or does not. One banner here
 * costs more in first impression than it could return in revenue.
 *
 * ── Why every tool is linked from this page ────────────────────────────────
 * Twenty-four links is not too many to render and it puts every tool one hop
 * from the root, which is the simplest thing you can do for crawl depth on a
 * new site with no external links pointing at the deeper pages. As the
 * catalogue grows past ~40 this becomes a category-only grid and `/tools`
 * carries the full list; until then, flat is better.
 *
 * ── The H1 carries the brand, not a keyword ────────────────────────────────
 * A homepage that shouts "FREE ONLINE TOOLS" ranks for nothing — that phrase is
 * owned by sites with a decade of links — and reads as spam to the person who
 * came here from a link. The tool pages are where the keywords live and where
 * the ranking is won; the homepage's job is to be the thing people remember the
 * name of and come back to. `pageTitle` drops the brand suffix here because the
 * title already ends with it.
 * ============================================================================
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { CategoryCard } from '@/components/CategoryCard';
import { JsonLd } from '@/components/JsonLd';
import { ToolCard } from '@/components/ToolCard';
import { Icon, type IconName } from '@/components/icons';
import { Container } from '@/components/layout/Container';
import { buttonClasses } from '@/components/ui/Button';
import { brand, promises } from '@/lib/brand';
import {
  categoriesWithTools,
  isRecentlyAdded,
  popularTools,
  toolCount,
  tools,
} from '@/lib/registry';
import { buildMetadata, homeGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const description = `${toolCount} free tools for images, PDFs, text, code and everyday maths. Most run entirely in your browser, so your files are never uploaded. No account, no watermarks, no limits.`;

export const metadata: Metadata = buildMetadata({
  title: `${brand.name} — ${brand.tagline}`,
  description,
  path: '/',
});

/** The three claims, as cards. Each one is enforced somewhere in the build. */
const pillars: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Your files never leave your device',
    body: 'Images, PDFs and text are read, processed and written by your own browser. There is no upload endpoint behind these pages — closing the tab is the deletion step.',
  },
  {
    icon: 'zap',
    title: 'No queue, no waiting',
    body: 'Nothing is sent anywhere, so nothing waits in line behind somebody else’s job. Work starts the moment you press the button and runs as fast as your device can go.',
  },
  {
    icon: 'check-circle',
    title: 'Free, and honest about it',
    body: 'No account, no email, no trial that expires. No watermarks and no artificial file limits — the only caps are the ones your browser genuinely imposes, and each tool says what they are.',
  },
];

export default function HomePage() {
  const grouped = categoriesWithTools();

  return (
    <>
      <JsonLd graph={homeGraph(description)} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Container className="py-10 sm:py-16">
        <div className="max-w-3xl space-y-5">
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            {brand.tagline}
          </h1>
          <p className="text-pretty text-lg text-fg-muted">
            {toolCount} tools for images, PDFs, text, code and everyday maths. Most of them run
            entirely inside this tab — your files are never uploaded, and there is nothing to sign
            up for.
          </p>

          <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {[promises.browserOnly, promises.noAccount, promises.free].map((line) => (
              <li key={line} className="flex items-start gap-1.5 text-sm text-fg-muted">
                <Icon name="check-circle" size={15} className="mt-0.5 shrink-0 text-success" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {/* `buttonClasses` rather than `<Button>`: these navigate, so they
              have to be real anchors — a button that pushes history is invisible
              to "open in new tab", to a middle click, and to a crawler. */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={routes.tools} className={buttonClasses({ variant: 'primary', size: 'lg' })}>
              Browse all {toolCount} tools
              <Icon name="arrow-right" size={20} className="shrink-0" />
            </Link>
            <Link
              href={routes.categories}
              className={buttonClasses({ variant: 'secondary', size: 'lg' })}
            >
              By category
            </Link>
          </div>
        </div>
      </Container>

      {/* ── Popular ──────────────────────────────────────────────────────── */}
      {popularTools.length > 0 ? (
        <Container className="pb-12 sm:pb-16">
          <section aria-labelledby="popular" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="popular" className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                Most used
              </h2>
              <Link
                href={routes.tools}
                className="text-sm font-medium text-accent-fg hover:underline"
              >
                See everything
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {popularTools.map((tool) => (
                <li key={tool.slug}>
                  <ToolCard
                    slug={tool.slug}
                    name={tool.name}
                    tagline={tool.tagline}
                    icon={tool.icon}
                    isNew={isRecentlyAdded(tool)}
                  />
                </li>
              ))}
            </ul>
          </section>
        </Container>
      ) : null}

      {/* ── Why ──────────────────────────────────────────────────────────── */}
      <div className="border-y border-border bg-surface-sunken">
        <Container className="py-12 sm:py-16">
          <section aria-labelledby="why" className="space-y-6">
            <h2 id="why" className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Why these are different
            </h2>
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {pillars.map((pillar) => (
                <li key={pillar.title} className="space-y-2">
                  <span className="flex size-9 items-center justify-center rounded-md border border-accent-border bg-accent-subtle text-accent-fg">
                    <Icon name={pillar.icon} size={18} />
                  </span>
                  <h3 className="font-medium text-fg">{pillar.title}</h3>
                  <p className="text-sm text-fg-muted">{pillar.body}</p>
                </li>
              ))}
            </ul>
          </section>
        </Container>
      </div>

      {/* ── Everything, by category ──────────────────────────────────────── */}
      <Container className="py-12 sm:py-16">
        <section aria-labelledby="catalogue" className="space-y-8">
          <div className="space-y-2">
            <h2 id="catalogue" className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              All {toolCount} tools
            </h2>
            <p className="max-w-prose text-fg-muted">
              Grouped the way you would look for them. Every tool is free and works without an
              account.
            </p>
          </div>

          <div className="space-y-10">
            {grouped.map(({ category, tools: categoryTools }) => (
              <div key={category.id} className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
                    <Icon name={category.icon} size={18} className="text-fg-muted" />
                    <Link href={routes.category(category.slug)} className="hover:underline">
                      {category.name}
                    </Link>
                  </h3>
                  <p className="text-sm text-fg-muted">{category.tagline}</p>
                </div>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryTools.map((tool) => (
                    <li key={tool.slug}>
                      <ToolCard
                        slug={tool.slug}
                        name={tool.name}
                        tagline={tool.tagline}
                        icon={tool.icon}
                        isNew={isRecentlyAdded(tool)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </Container>

      {/* ── Categories, as a closing index ───────────────────────────────── */}
      <div className="border-t border-border bg-surface-sunken">
        <Container className="py-12 sm:py-16">
          <section aria-labelledby="categories" className="space-y-5">
            <h2 id="categories" className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
              Browse by category
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map(({ category, tools: categoryTools }) => (
                <li key={category.id}>
                  <CategoryCard
                    id={category.slug}
                    name={category.name}
                    tagline={category.tagline}
                    icon={category.icon}
                    count={categoryTools.length}
                  />
                </li>
              ))}
            </ul>
            <p className="pt-1 text-sm text-fg-muted">
              {tools.length} tools and counting.{' '}
              <Link href={routes.about} className="font-medium text-accent-fg hover:underline">
                What this is and who made it
              </Link>
              .
            </p>
          </section>
        </Container>
      </div>
    </>
  );
}
