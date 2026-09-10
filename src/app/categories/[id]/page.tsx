/**
 * ============================================================================
 * CATEGORY PAGE
 * ============================================================================
 * One page per category, statically generated, with the category's own written
 * intro above the grid.
 *
 * ── Why these pages carry real copy ────────────────────────────────────────
 * A category page that is nothing but a grid of links is the classic thin page:
 * it competes with `/tools` for the same queries, adds nothing a crawler has
 * not already seen, and is the first thing an AdSense reviewer flags. The
 * `description` in the registry is written per category and is the reason each
 * of these is a page rather than an anchor on `/tools`.
 *
 * ── Sibling links at the foot ──────────────────────────────────────────────
 * Every category links to the other five. Six pages that each link to the other
 * five is a fully connected hub — no page on the site is more than two hops
 * from any other, which is the cheapest crawl-depth win available to a site
 * with no inbound links yet.
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
import { categories, getCategory, isRecentlyAdded, toolsInCategory } from '@/lib/registry';
import { categoryMetadata, collectionGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

export function generateStaticParams(): { id: string }[] {
  return categories.map((category) => ({ id: category.slug }));
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const category = getCategory(id);
  if (!category) return {};
  return categoryMetadata(category);
}

export default async function CategoryPage({ params }: PageProps) {
  const { id } = await params;
  const category = getCategory(id);
  if (!category) notFound();

  const categoryTools = toolsInCategory(category.id);
  const siblings = categories.filter((other) => other.id !== category.id);

  const trail = [
    { name: 'Home', href: routes.home },
    { name: 'Categories', href: routes.categories },
    { name: category.name, href: routes.category(category.slug) },
  ];

  return (
    <Container className="py-6 sm:py-10">
      <JsonLd
        graph={collectionGraph({
          path: routes.category(category.slug),
          title: category.metaTitle,
          description: category.metaDescription,
          trail,
          items: categoryTools.map((tool) => ({ name: tool.name, slug: tool.slug })),
        })}
      />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Icon name={category.icon} size={14} />
            {categoryTools.length} {categoryTools.length === 1 ? 'tool' : 'tools'}
          </span>
        }
        title={category.name}
        description={category.tagline}
      />

      <p className="mt-4 max-w-prose text-pretty text-fg-muted">{category.description}</p>

      <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <AdSlot placement="listing" className="mt-8" />

      <section aria-labelledby="other-categories" className="mt-12 space-y-3">
        <h2 id="other-categories" className="text-lg font-semibold text-fg">
          Other categories
        </h2>
        <ul className="flex flex-wrap gap-2">
          {siblings.map((other) => (
            <li key={other.id}>
              <Link
                href={routes.category(other.slug)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors duration-fast hover:border-accent-border hover:bg-accent-subtle hover:text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <Icon name={other.icon} size={14} />
                {other.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}
