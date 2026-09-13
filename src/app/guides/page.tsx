/**
 * The guides index.
 *
 * Small on purpose. Its job is to be a crawlable parent for the guide pages and
 * a place a reader can find the others — not to be a blog home page with
 * categories and pagination for three articles. It grows into that shape only
 * if there is ever enough here to need it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { guides } from '@/lib/registry';
import { buildMetadata, collectionGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const title = 'Guides';
const description =
  'Plain explanations of the file problems people actually hit — why an encrypted zip will not open on Windows, whether ZipCrypto is safe, and what to do about each.';

export const metadata: Metadata = buildMetadata({
  title: 'Guides — File Problems, Explained',
  description,
  path: routes.guides,
});

export default function GuidesPage() {
  const trail = [
    { name: 'Home', href: routes.home },
    { name: 'Guides', href: routes.guides },
  ];

  return (
    <>
      <JsonLd
        graph={collectionGraph({
          path: routes.guides,
          title: 'Guides — File Problems, Explained',
          description,
          trail,
          items: guides.map((guide) => ({ name: guide.title, slug: guide.slug })),
        })}
      />

      <Container className="py-6 sm:py-8">
        <Breadcrumbs trail={trail} className="mb-5" />

        <div className="mx-auto max-w-3xl space-y-8">
          <PageHeader title={title} description={description} />

          <ul className="space-y-5">
            {guides.map((guide) => (
              <li
                key={guide.slug}
                className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-border-strong"
              >
                <h2 className="text-lg font-semibold tracking-tight">
                  <Link href={routes.guide(guide.slug)} className="text-fg hover:text-accent-fg">
                    {guide.title}
                  </Link>
                </h2>
                <p className="mt-2 leading-relaxed text-fg-muted">{guide.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </>
  );
}
