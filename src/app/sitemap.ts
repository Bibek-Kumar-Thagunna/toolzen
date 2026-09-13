import type { MetadataRoute } from 'next';

import { routes, siteUrl, isIndexableDeployment } from '@/lib/site';
import { categories } from '@/lib/registry/categories';
import { guides, tools, toolsInCategory } from '@/lib/registry';

/**
 * Marked static explicitly.
 *
 * Next treats a metadata route as dynamic unless told otherwise, and under
 * `output: "export"` it refuses to build one rather than guessing. Nothing here
 * reads the request — the values come from the registry and the environment at
 * build time — so declaring it is accurate, and it keeps a static export
 * working without changing anything about the default Vercel build.
 */
export const dynamic = 'force-static';


/**
 * ============================================================================
 * sitemap.xml
 * ============================================================================
 * Every indexable URL on the site, generated from the registry so that adding a
 * tool cannot be followed by forgetting to list it. There is no hand-maintained
 * array of paths anywhere in this file — the only literals are the four static
 * pages that are not registry-driven.
 *
 * ── `lastModified` is honest, or absent ─────────────────────────────────────
 * Tool entries use `tool.updated`, the date the page's content last changed.
 * The static pages have no such field, so they get *no* `lastModified` at all
 * rather than `new Date()`. Stamping today's date on every URL on every build
 * is the most common sitemap mistake: it tells a crawler that all 31 pages
 * changed this morning, which is false, and once a crawler learns the signal is
 * noise it stops using it — including for the pages where it is true and
 * useful. A missing date costs nothing; a lying date costs the signal.
 *
 * Category pages derive their date from the newest `updated` among their tools,
 * which is accurate: a category page is a list of its tools, so it changes
 * exactly when one of them does.
 *
 * ── On `priority` and `changeFrequency` ────────────────────────────────────
 * Google has said for years that it ignores both. They are still emitted
 * because Bing, Yandex and several smaller crawlers do read them, they are free,
 * and the values here are true statements about the site rather than an attempt
 * to game anything: the homepage and the tool index really do change more often
 * than the terms page, and a tool page really is more important than `/about`.
 *
 * ── Size ───────────────────────────────────────────────────────────────────
 * The protocol caps a single sitemap at 50,000 URLs and 50MB. This site has
 * roughly 24 tools + 6 categories + 5 pages, so one file is correct and a
 * sitemap index would be pure ceremony. Splitting becomes worth doing around
 * a few thousand URLs, which is a different product.
 * ============================================================================
 */

/** Newest `updated` among a set of tools, or `undefined` for an empty set. */
function newestUpdate(entries: readonly { updated: string }[]): Date | undefined {
  let newest: number | undefined;
  for (const entry of entries) {
    const at = Date.parse(entry.updated);
    // A malformed date is skipped rather than emitted as `Invalid Date`, which
    // would serialise to a broken `<lastmod>` and invalidate the whole file.
    if (Number.isNaN(at)) continue;
    if (newest === undefined || at > newest) newest = at;
  }
  return newest === undefined ? undefined : new Date(newest);
}

export default function sitemap(): MetadataRoute.Sitemap {
  // A build with no public origin has no URLs worth publishing. Returning an
  // empty sitemap is the honest answer, and it pairs with the `Disallow: /`
  // that `robots.ts` emits under the same condition.
  if (!isIndexableDeployment) return [];

  const url = (path: string) => `${siteUrl}${path}`;

  const toolEntries: MetadataRoute.Sitemap = tools.map((tool) => ({
    url: url(routes.tool(tool.slug)),
    lastModified: newestUpdate([tool]),
    changeFrequency: 'monthly',
    // Popular tools are the ones people search for by name; the difference is
    // small on purpose, because every tool page here is a real destination.
    priority: tool.popular === true ? 0.9 : 0.8,
  }));

  const categoryEntries: MetadataRoute.Sitemap = categories
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((category) => ({
      url: url(routes.category(category.slug)),
      lastModified: newestUpdate(toolsInCategory(category.id)),
      changeFrequency: 'weekly',
      priority: 0.7,
    }));

  const indexEntries: MetadataRoute.Sitemap = [
    {
      url: url(routes.home),
      lastModified: newestUpdate(tools),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: url(routes.tools),
      lastModified: newestUpdate(tools),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: url(routes.guides),
      lastModified: newestUpdate(guides),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: url(routes.categories),
      lastModified: newestUpdate(tools),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];

  /**
   * Guides. Priority sits just under a tool page: these are real destinations
   * that answer a question in full, but the tools are what the site is for and
   * a guide's job includes sending the reader to one.
   */
  const guideEntries: MetadataRoute.Sitemap = guides.map((guide) => ({
    url: url(routes.guide(guide.slug)),
    lastModified: newestUpdate([guide]),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // No `lastModified`: see the note above. These change when someone edits
  // them, and nothing in the codebase records when that was.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: url(routes.about), changeFrequency: 'yearly', priority: 0.4 },
    { url: url(routes.privacy), changeFrequency: 'yearly', priority: 0.4 },
    { url: url(routes.terms), changeFrequency: 'yearly', priority: 0.3 },
  ];

  return [...indexEntries, ...categoryEntries, ...toolEntries, ...guideEntries, ...staticEntries];
}
