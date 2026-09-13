/**
 * ============================================================================
 * GUIDE PAGE
 * ============================================================================
 * A guide answers a question; a tool page offers a widget. The layouts differ
 * for that reason and not for variety.
 *
 * ── The order on the page ──────────────────────────────────────────────────
 *   breadcrumbs → H1 → THE ANSWER → tool hand-off → sections → FAQ →
 *   sources → related
 *
 * The answer comes first, in full, before any explanation. Somebody who
 * searched "why can't Windows open my password-protected zip" wants that
 * sentence, and every page currently ranking for it makes them scroll past an
 * introduction to reach it. Putting it at the top is better for the reader and
 * it is also the honest shape: if the answer cannot be stated in two sentences
 * at the top, the page does not understand its subject.
 *
 * The tool hand-off sits directly under the answer rather than at the bottom,
 * because by that point the reader knows what is wrong and the next thing they
 * want is to fix it. Burying the link under two thousand words would be
 * optimising the page for time-on-page rather than for the person reading it.
 *
 * ── Why there is no ad above the sources ──────────────────────────────────
 * Same rule as the tool pages: `MAX_ADS_PER_PAGE` is two and nothing sits
 * above the content a person came for. A guide has one slot, after the FAQ,
 * where the reading is genuinely finished.
 *
 * ── Sources are rendered, not just emitted ────────────────────────────────
 * The structured data carries `citation`, which is the machine-readable half.
 * The visible list is the half that matters to a reader deciding whether to
 * believe a claim about a 1994 attack, and showing the same sources to both
 * audiences is the only version of this that is not a trick.
 * ============================================================================
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { ToolCard } from '@/components/ToolCard';
import { AdSlot } from '@/components/ads/AdSlot';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { getGuide, guideSlugs, guideTools, relatedGuides } from '@/lib/registry';
import { guideGraph, guideMetadata } from '@/lib/seo';
import { routes } from '@/lib/site';

export function generateStaticParams(): { slug: string }[] {
  return guideSlugs.map((slug) => ({ slug }));
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return guideMetadata(guide);
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const trail = [
    { name: 'Home', href: routes.home },
    { name: 'Guides', href: routes.guides },
    { name: guide.name, href: routes.guide(guide.slug) },
  ];
  const tools = guideTools(guide.tools);
  const related = relatedGuides(guide);

  return (
    <>
      <JsonLd graph={guideGraph(guide, trail)} />

      <Container className="py-6 sm:py-8">
        <Breadcrumbs trail={trail} className="mb-5" />

        <article className="mx-auto max-w-3xl space-y-10">
          <PageHeader eyebrow="Guide" title={guide.title} />

          {/* The answer, set apart so it reads as the answer and not as an
              introduction. A reader who stops here has what they came for. */}
          <div className="rounded-lg border border-border-strong bg-surface-sunken p-5 sm:p-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
              The short answer
            </h2>
            <p className="text-lg leading-relaxed text-fg">{guide.answer}</p>
          </div>

          {tools.length > 0 ? (
            <section aria-labelledby="fix-it" className="space-y-4">
              <h2 id="fix-it" className="text-xl font-semibold tracking-tight text-fg">
                Fix it now
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tools.map((tool) => (
                  <li key={tool.slug}>
                    <ToolCard
                      slug={tool.slug}
                      name={tool.name}
                      tagline={tool.tagline}
                      icon={tool.icon}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {guide.body.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="text-xl font-semibold tracking-tight text-fg">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 48)} className="leading-relaxed text-fg-muted">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          {guide.faq.length > 0 ? (
            <section aria-labelledby="faq" className="space-y-4">
              <h2 id="faq" className="text-xl font-semibold tracking-tight text-fg">
                Common questions
              </h2>
              <dl className="space-y-5">
                {guide.faq.map((item) => (
                  <div key={item.q} className="space-y-1.5">
                    <dt className="font-medium text-fg">{item.q}</dt>
                    <dd className="leading-relaxed text-fg-muted">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <AdSlot placement="afterContent" />

          {guide.sources.length > 0 ? (
            <section aria-labelledby="sources" className="space-y-3">
              <h2 id="sources" className="text-xl font-semibold tracking-tight text-fg">
                Sources
              </h2>
              <p className="text-sm text-fg-muted">
                Every technical claim above comes from one of these. They are listed so you can
                check them rather than take our word for it.
              </p>
              <ul className="space-y-2 text-sm">
                {guide.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      className="text-accent-fg hover:underline"
                      // `noreferrer` as well as `noopener`: the latter is what
                      // actually matters, but older browsers only honour the
                      // former, and a source list points at sites we do not
                      // control.
                      rel="nofollow noopener noreferrer"
                      target="_blank"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {related.length > 0 ? (
            <section aria-labelledby="related" className="space-y-3">
              <h2 id="related" className="text-xl font-semibold tracking-tight text-fg">
                Related guides
              </h2>
              <ul className="space-y-2">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link
                      href={routes.guide(item.slug)}
                      className="font-medium text-accent-fg hover:underline"
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </Container>
    </>
  );
}
