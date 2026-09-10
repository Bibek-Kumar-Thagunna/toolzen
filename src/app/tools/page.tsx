/**
 * ============================================================================
 * /tools — the whole catalogue
 * ============================================================================
 * Every tool, grouped by category, with a filter box over the top.
 *
 * ── Why the grid is server-rendered *and* the filter is a client component ──
 * `ToolFilter` takes the unfiltered grid as `children` and shows it verbatim
 * whenever the box is empty. So the page a crawler sees — and the page that
 * paints before any JavaScript has run — is the complete, linked, static list.
 * The client bundle is the search index projection (`SearchDoc`: a few hundred
 * bytes per tool, no FAQ, no prose) and the ranking function, and it only ever
 * *replaces* the grid once somebody types.
 *
 * The naive version renders the list from the client component's own state,
 * which ships the catalogue twice, produces an empty page without JavaScript,
 * and puts twenty-four links behind a hydration boundary. This way the links
 * are real HTML.
 *
 * ── `?q=` ──────────────────────────────────────────────────────────────────
 * The filter syncs the query into the URL so a filtered view can be shared and
 * bookmarked. Those URLs are not in the sitemap and carry the canonical of
 * `/tools`, because they are the same page with a subset shown — not something
 * that should compete with it in an index.
 * ============================================================================
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { JsonLd } from "@/components/JsonLd";
import { PageHeader } from "@/components/PageHeader";
import { ToolCard } from "@/components/ToolCard";
import { AdSlot } from "@/components/ads/AdSlot";
import { Icon } from "@/components/icons";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Container } from "@/components/layout/Container";
import { ToolFilter } from "@/components/search/ToolFilter";
import {
  categoriesWithTools,
  isRecentlyAdded,
  toolCount,
  tools,
} from "@/lib/registry";
import { buildSearchIndex } from "@/lib/registry/search";
import { buildMetadata, collectionGraph } from "@/lib/seo";
import { routes } from "@/lib/site";

const title = "All Tools";
const description = `Every tool on the site — ${toolCount} of them, for images, PDFs, text, code and everyday maths. Free, no sign-up, and most run entirely in your browser.`;

export const metadata: Metadata = buildMetadata({
  title,
  description,
  path: routes.tools,
});

const trail = [
  { name: "Home", href: routes.home },
  { name: "Tools", href: routes.tools },
];

export default function ToolsPage() {
  const docs = buildSearchIndex(tools);

  return (
    <Container className="py-6 sm:py-10">
      <JsonLd
        graph={collectionGraph({
          path: routes.tools,
          title,
          description,
          trail,
          items: tools.map((tool) => ({ name: tool.name, slug: tool.slug })),
        })}
      />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        title={`All ${toolCount} tools`}
        description="Grouped the way you would look for them. Type to filter — the box matches names, what a tool is for, and the words people actually use for it."
      />

      {/*
        The Suspense boundary is required, not decorative: `ToolFilter` reads
        `useSearchParams()` to seed itself from `?q=`, and Next refuses to
        prerender a page that does so outside one — a client component that
        depends on the request URL cannot be resolved at build time.

        The fallback is the same grid the filter wraps, which is the whole trick:
        the prerendered HTML contains every tool link, laid out exactly as the
        hydrated page will show it, so a crawler and a JavaScript-less visitor
        get the complete catalogue and there is no layout shift when the filter
        takes over.
      */}
      <div className="mt-8">
        <Suspense fallback={<ToolGrid />}>
          <ToolFilter docs={docs}>
            <ToolGrid />
          </ToolFilter>
        </Suspense>
      </div>
    </Container>
  );
}

/**
 * The unfiltered catalogue. Rendered twice — once as the Suspense fallback and
 * once as the filter's idle state — so it is a component rather than a variable
 * holding an element, which would make the two branches share one instance and
 * defeat the fallback.
 */
function ToolGrid() {
  const grouped = categoriesWithTools();

  return (
    <div className="flex flex-col gap-10">
      {grouped.map(({ category, tools: categoryTools }, index) => (
        <div key={category.id}>
          <h2
            id={`category-${category.id}`}
            className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg"
          >
            <Icon name={category.icon} size={18} className="text-fg-muted" />
            {category.name}
          </h2>
          <p className="mb-3 text-sm text-fg-muted">{category.tagline}</p>

          <ul
            aria-labelledby={`category-${category.id}`}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
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

          {/* The page's single ad unit, after the first category rather
                    than at the top: a listing page's first screen is the thing
                    the visitor came to scan. `MAX_ADS_PER_PAGE` is two, and one
                    is enough on a page with no workflow to monetise. */}
          {index === 0 ? <AdSlot placement="listing" className="mt-6" /> : null}
        </div>
      ))}
    </div>
  );
}
