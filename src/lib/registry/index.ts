import type { Category, CategoryId, Tool } from './types.ts';
import { categories, categoryIds, getCategory, isCategoryId } from './categories.ts';
import { imageTools } from './tools/image.ts';
import { pdfTools } from './tools/pdf.ts';
import { fileTools } from './tools/files.ts';
import { textTools } from './tools/text.ts';
import { developerTools } from './tools/developer.ts';
import { calculatorTools } from './tools/calculators.ts';
import { generatorTools } from './tools/generators.ts';

/**
 * ============================================================================
 * THE REGISTRY
 * ============================================================================
 * One array is the single source of truth for the whole site: navigation, the
 * homepage, category pages, `generateStaticParams`, the sitemap, structured
 * data, breadcrumbs, internal linking and search all read from here. Adding a
 * working tool means appending one object and one component; nothing else has
 * to be touched.
 *
 * IMPORTANT — bundle boundary. Each entry carries its full page copy (FAQ,
 * feature list, explanatory prose), so this module is heavy by design and must
 * stay on the server. Server components may import it freely. A client
 * component must never import it; pass it the projection it actually needs
 * instead — see {@link ./search.ts}, whose `SearchDoc` exists precisely so the
 * command palette ships ~24 short records rather than every FAQ answer.
 *
 * Order within a category is declaration order, which is curated: the tool a
 * newcomer most likely wants comes first. Category order comes from
 * `categories.ts`, so the two are edited independently.
 * ============================================================================
 */
const byCategory: Record<CategoryId, Tool[]> = {
  image: imageTools,
  pdf: pdfTools,
  files: fileTools,
  text: textTools,
  developer: developerTools,
  calculators: calculatorTools,
  generators: generatorTools,
};

/** Every tool, ordered by category order then declaration order. */
export const tools: Tool[] = categoryIds.flatMap((id) => byCategory[id]);

const bySlug = new Map<string, Tool>(tools.map((tool) => [tool.slug, tool]));

/**
 * Honest count for headline copy. Never hardcode "24 tools" anywhere — a number
 * that drifts from reality is exactly the kind of small lie the product is
 * positioned against.
 */
export const toolCount = tools.length;

export const toolSlugs: string[] = tools.map((tool) => tool.slug);

export function getTool(slug: string): Tool | undefined {
  return bySlug.get(slug);
}

export function isToolSlug(value: string): boolean {
  return bySlug.has(value);
}

/** Tools in one category, in curated order. Empty array for an unknown id. */
export function toolsInCategory(id: string): Tool[] {
  return isCategoryId(id) ? byCategory[id] : [];
}

/** Categories paired with their tools, ready for a grid. Skips empty ones. */
export function categoriesWithTools(): { category: Category; tools: Tool[] }[] {
  return categories
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((category) => ({ category, tools: byCategory[category.id] }))
    .filter((entry) => entry.tools.length > 0);
}

/** Homepage shortlist. Curated via the `popular` flag, not inferred. */
export const popularTools: Tool[] = tools.filter((tool) => tool.popular === true);

const NEW_FOR_DAYS = 30;

/**
 * Whether the "New" pill should show. Call this **only from a server
 * component**: it reads the clock, so a client component computing it during
 * hydration could disagree with the server-rendered HTML. The pill is baked
 * into the static page at build time and therefore goes stale until the next
 * deploy, which is an acceptable trade for a decorative badge — the alternative
 * is opting the page out of static rendering for a pill.
 */
export function isRecentlyAdded(tool: Tool, now: Date = new Date()): boolean {
  if (tool.isNew !== true) return false;
  const updated = Date.parse(`${tool.updated}T00:00:00Z`);
  if (Number.isNaN(updated)) return false;
  const days = (now.getTime() - updated) / 86_400_000;
  return days >= 0 && days <= NEW_FOR_DAYS;
}

/**
 * Cross-links for the foot of a tool page.
 *
 * Hand-picked `related` slugs come first and in the order they were written,
 * because they encode a real journey ("you compressed an image, you probably
 * want it in a PDF next"). Unknown slugs are dropped rather than throwing:
 * `scripts/check-integrity.mjs` fails the build on a bad slug, so a stale entry
 * is a build error at author time, not a broken page at request time.
 *
 * The list is then topped up so the section is never thin — same category
 * first, popular tools after that. A page with two links is a dead end for both
 * readers and crawlers.
 */
export function relatedTools(tool: Tool, count = 4): Tool[] {
  const out: Tool[] = [];
  const taken = new Set<string>([tool.slug]);

  const add = (candidate: Tool | undefined) => {
    if (!candidate || taken.has(candidate.slug) || out.length >= count) return;
    taken.add(candidate.slug);
    out.push(candidate);
  };

  for (const slug of tool.related) add(bySlug.get(slug));
  for (const sibling of byCategory[tool.category]) add(sibling);
  for (const popular of popularTools) add(popular);

  return out;
}

/**
 * Breadcrumb trail for a tool page. Returned as data rather than markup so the
 * same array feeds both the visible `<nav>` and the BreadcrumbList structured
 * data, which is the only way to guarantee the two never disagree.
 */
export function toolTrail(tool: Tool): { name: string; href: string }[] {
  const category = getCategory(tool.category);
  return [
    { name: 'Home', href: '/' },
    { name: 'Tools', href: '/tools' },
    ...(category ? [{ name: category.name, href: `/categories/${category.slug}` }] : []),
    { name: tool.name, href: `/tools/${tool.slug}` },
  ];
}

/** Most recently updated first, then alphabetical so the order is stable. */
export function recentlyUpdated(limit = 6): Tool[] {
  return tools
    .slice()
    .sort((a, b) => (a.updated === b.updated ? a.name.localeCompare(b.name) : b.updated.localeCompare(a.updated)))
    .slice(0, limit);
}

export { categories, categoryIds, getCategory, isCategoryId };
export type { Category, CategoryId, Tool };
export type {
  AcceptSpec,
  ContentSection,
  FaqItem,
  FeatureItem,
  HowTo,
  ProcessingMode,
  ToolSurface,
} from './types.ts';
