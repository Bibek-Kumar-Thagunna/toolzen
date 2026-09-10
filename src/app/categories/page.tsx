/**
 * /categories — the six category cards.
 *
 * A thin page by design: its whole job is to be a hub that passes a crawler and
 * a browsing visitor down to the six category pages, each of which carries the
 * real copy. It earns its place in the sitemap because it is the second half of
 * the breadcrumb trail on every tool page, and a breadcrumb link that 404s is
 * worse than no breadcrumb at all.
 *
 * The `ItemList` in its structured data lists tools rather than categories,
 * because `collectionGraph` builds tool URLs — which is the accurate claim for
 * a page that indexes the catalogue.
 */
import type { Metadata } from 'next';

import { CategoryCard } from '@/components/CategoryCard';
import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { categoriesWithTools, toolCount, tools } from '@/lib/registry';
import { buildMetadata, collectionGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const title = 'Tool Categories';
const description = `The ${toolCount} tools on this site, grouped into six categories: images, PDFs, text, developer utilities, calculators and generators.`;

export const metadata: Metadata = buildMetadata({
  title,
  description,
  path: routes.categories,
});

const trail = [
  { name: 'Home', href: routes.home },
  { name: 'Categories', href: routes.categories },
];

export default function CategoriesPage() {
  const grouped = categoriesWithTools();

  return (
    <Container className="py-6 sm:py-10">
      <JsonLd
        graph={collectionGraph({
          path: routes.categories,
          title,
          description,
          trail,
          items: tools.map((tool) => ({ name: tool.name, slug: tool.slug })),
        })}
      />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        title="Browse by category"
        description="Six groups covering images, documents, text, code and everyday maths. Every tool is free and works without an account."
      />

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </Container>
  );
}
