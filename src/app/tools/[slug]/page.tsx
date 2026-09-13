/**
 * ============================================================================
 * TOOL PAGE
 * ============================================================================
 * The page the whole site exists to serve. Twenty-four of them, one per
 * registry entry, all statically generated.
 *
 * ── Why fully static ───────────────────────────────────────────────────────
 * `generateStaticParams` returns every slug and there is no dynamic data on the
 * page, so each URL is written to disk at build time and served as a file. That
 * is not a micro-optimisation: it is the difference between a document that
 * starts arriving in ~50ms from a CDN edge and one that waits on a server
 * round-trip. Every tool here competes with sites that have a decade of links
 * on us, and page speed is one of the few ranking inputs we can simply decide
 * to win.
 *
 * `dynamicParams = false` makes an unknown slug a 404 rather than an attempted
 * render, so `/tools/anything` cannot become a soft-404 that dilutes the site.
 *
 * ── The order on the page ──────────────────────────────────────────────────
 *   breadcrumbs → H1 → promises → THE TOOL → article → ads → related
 *
 * The tool sits immediately under the heading, above the fold, before any
 * prose. Every competitor in this niche puts two paragraphs of introduction and
 * a banner above the widget; the reason they can is that people have already
 * decided to use them. We have not earned that, so the page answers the search
 * query in the first screen and explains itself afterwards to whoever is still
 * reading. It is also the honest layout: somebody who searched "compress image"
 * wants to compress an image.
 *
 * ── Where the ads are, and are not ─────────────────────────────────────────
 * There are two, both below the tool: one inside `ToolResult` that appears only
 * after a result exists, and one at the end of the article. The rail is a
 * separate grid column that exists from 1280px, where it occupies margin that
 * was empty anyway. `MAX_ADS_PER_PAGE` is two and `check-integrity.mjs` asserts
 * it. Nothing above the tool, ever — see `src/lib/ads/config.ts`.
 *
 * ── ToolActivity wraps the whole page, not just the workspace ──────────────
 * It is what flips `busy` while an engine runs, and `busy` holds ad
 * initialisation *everywhere* on the page — including the rail, which is
 * outside the workspace. An iframe expanding in the margin while somebody
 * watches a progress bar is exactly the movement this is here to prevent.
 * ============================================================================
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { ToolCard } from '@/components/ToolCard';
import { AdSlot } from '@/components/ads/AdSlot';
import { Icon } from '@/components/icons';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { ToolActivity } from '@/components/tool/ToolActivity';
import { ToolArticle } from '@/components/tool/ToolArticle';
import { ToolMount } from '@/components/tools/ToolMount';
import { adsDebug, adsEnabled } from '@/lib/ads/config';
import { promises } from '@/lib/brand';
import { cn } from '@/lib/cn';
import {
  getCategory,
  getTool,
  guidesForTool,
  isRecentlyAdded,
  relatedTools,
  toolSlugs,
  toolTrail,
} from '@/lib/registry';
import { toolGraph, toolMetadata } from '@/lib/seo';
import { routes } from '@/lib/site';

/** Every tool URL is written at build time. Nothing renders on demand. */
export function generateStaticParams(): { slug: string }[] {
  return toolSlugs.map((slug) => ({ slug }));
}

/** An unknown slug is a real 404, not a rendered page with an empty middle. */
export const dynamicParams = false;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  return toolMetadata(tool);
}

/**
 * The three claims, restated at the top of every tool page.
 *
 * Not decoration and not a trust badge in the marketing sense: each line is
 * enforced somewhere in the build. `browserOnly` is asserted by the integrity
 * check against the engine's source, `noAccount` is true because there is no
 * auth code in the repository, and `free` is true because there is no billing
 * code either. They are placed above the tool because "will this upload my
 * passport scan to someone's server" is the question a first-time visitor is
 * actually asking, and answering it after the file picker is too late.
 */
function Promises({
  browserProcessed,
  takesFiles,
}: {
  browserProcessed: boolean;
  takesFiles: boolean;
}) {
  // `promises` is `as const`, so its members are string *literal* types and an
  // inferred array of them fights any `string` annotation. Widening each entry
  // as it goes in is the one spelling that satisfies both the array type and
  // the narrowing predicate.
  const candidates: (string | null)[] = [
    browserProcessed ? (takesFiles ? promises.browserOnly : promises.browserOnlyNoFile) : null,
    promises.noAccount,
    promises.free,
  ];
  const lines = candidates.filter((line): line is string => line !== null);

  return (
    <ul className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
      {lines.map((line) => (
        <li key={line} className="flex items-start gap-1.5 text-sm text-fg-muted">
          <Icon name="check-circle" size={15} className="mt-0.5 shrink-0 text-success" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ToolPage({ params }: PageProps) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const trail = toolTrail(tool);
  const category = getCategory(tool.category);
  const related = relatedTools(tool, 4);
  const guides = guidesForTool(tool.slug);
  /** No rail column unless something can actually occupy it. */
  const showRail = adsEnabled || adsDebug;

  return (
    <ToolActivity>
      <JsonLd graph={toolGraph(tool, trail)} />

      <Container className="py-6 sm:py-8">
        <Breadcrumbs trail={trail} className="mb-5" />

        {/*
          One column until 1280px, two above it — but only when there is
          actually a rail to put in the second one.

          `AdSlot` renders nothing when ads are unconfigured, which is the
          default in development and stays the default in production until the
          ad account is approved. A grid that reserved the 300px column
          regardless would leave every tool page with an empty third of the
          screen for months, and the article measured 300px narrower than it
          needs to be — paying the layout cost of advertising before earning a
          penny from it. `adsEnabled` and `adsDebug` are build-time constants
          read from the environment, so this costs nothing at runtime and the
          two states are one redeploy apart.

          `minmax(0,1fr)` rather than a bare `1fr`: a `1fr` track refuses to
          shrink below its content, so one wide code block inside the article
          would push the rail off the screen instead of scrolling inside its own
          box.
        */}
        <div
          className={cn(
            'grid grid-cols-1 gap-8',
            showRail && 'xl:grid-cols-[minmax(0,1fr)_300px]',
          )}
        >
          <div className="min-w-0 space-y-8">
            <div className="space-y-4">
              <PageHeader
                eyebrow={
                  category ? (
                    <Link
                      href={routes.category(category.slug)}
                      className="rounded-sm hover:underline"
                    >
                      {category.name}
                    </Link>
                  ) : undefined
                }
                title={tool.h1}
                description={tool.tagline}
              />
              <Promises
                browserProcessed={tool.processing === 'browser'}
                takesFiles={tool.accepts !== undefined}
              />
            </div>

            {/* The tool. Nothing between it and the heading. */}
            <ToolMount slug={tool.slug} />

            <ToolArticle
              howTo={tool.howTo}
              features={tool.features}
              content={tool.content}
              faq={tool.faq}
            />

            {/*
              Guides that explain this tool's subject.

              Above the ad and above the related tools, because a reader who has
              finished the FAQ and is still here has a question the widget did
              not answer — which is exactly what these pages are for. It is also
              the only route from a tool page into the guides: links otherwise
              run one way, guides to tools, leaving the guides reachable only
              from the footer while the tool pages hold all the internal links.
            */}
            {guides.length > 0 ? (
              <section aria-labelledby="guides" className="space-y-3">
                <h2 id="guides" className="text-xl font-semibold tracking-tight text-fg">
                  Read more about this
                </h2>
                <ul className="space-y-2">
                  {guides.map((guide) => (
                    <li key={guide.slug}>
                      <Link
                        href={routes.guide(guide.slug)}
                        className="font-medium text-accent-fg hover:underline"
                      >
                        {guide.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Ad two of two. Below the FAQ, above the cross-links: reading is
                finished and there is no workflow left to interrupt. */}
            <AdSlot placement="afterContent" />

            {related.length > 0 ? (
              <section aria-labelledby="related" className="space-y-4">
                <h2 id="related" className="text-xl font-semibold tracking-tight text-fg">
                  Related tools
                </h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {related.map((item) => (
                    <li key={item.slug}>
                      <ToolCard
                        slug={item.slug}
                        name={item.name}
                        tagline={item.tagline}
                        icon={item.icon}
                        isNew={isRecentlyAdded(item)}
                      />
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-fg-muted">
                  <Link href={routes.tools} className="font-medium text-accent-fg hover:underline">
                    Browse all tools
                  </Link>
                  {category ? (
                    <>
                      {' · '}
                      <Link
                        href={routes.category(category.slug)}
                        className="font-medium text-accent-fg hover:underline"
                      >
                        More {category.name.toLowerCase()}
                      </Link>
                    </>
                  ) : null}
                </p>
              </section>
            ) : null}
          </div>

          {/*
            `sticky` with `top-20` keeps the unit in view down a long article
            without it ever being the thing you scroll past to reach a control.
            `h-fit` is what lets sticky work inside a grid item at all: a grid
            child stretches to the row height by default, so it is already as
            tall as the article and has nothing to stick within.
          */}
          {showRail ? (
            <aside className="hidden xl:block">
              <div className="sticky top-20 h-fit">
                <AdSlot placement="rail" />
              </div>
            </aside>
          ) : null}
        </div>
      </Container>
    </ToolActivity>
  );
}
