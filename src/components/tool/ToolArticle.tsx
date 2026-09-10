/**
 * ============================================================================
 * TOOL ARTICLE
 * ============================================================================
 * Everything on a tool page that is *not* the tool: the steps, the feature
 * list, the explanatory prose and the FAQ. Split out of the page so the route
 * file stays a description of the page's shape rather than four hundred lines
 * of markup, and so this ordering — which is a product decision — lives in one
 * reviewable place.
 *
 * ── The order, and why it is this order ────────────────────────────────────
 * Steps, then features, then prose, then questions.
 *
 * Somebody who landed here from "how to compress an image" wants the four
 * steps and nothing else, and they want them the moment they have scrolled past
 * the tool. Features answer the next question ("is this the one I want?").
 * The prose is for the reader who has already got their file and is now
 * curious, or who arrived from a longer-tail search. The FAQ is last because
 * every entry in it is an objection, and objections are cheap to answer once
 * somebody has already seen the thing work.
 *
 * ── Why the FAQ is `<details>` and not a JavaScript accordion ──────────────
 * `<details>` is open-able with no JavaScript, is announced correctly by every
 * screen reader without a single ARIA attribute, is findable by the browser's
 * own Ctrl-F in current engines, and costs nothing to hydrate. A hand-built
 * accordion is a `useState`, a `button`, `aria-expanded`, `aria-controls`, an
 * id, and a keyboard handler — five chances to get it wrong in exchange for an
 * animation.
 *
 * The answer text is present in the HTML whether the item is open or not, which
 * is what matters for the FAQPage structured data emitted alongside it: markup
 * that claims an answer the page does not contain is a spam-policy problem.
 *
 * ── Headings ───────────────────────────────────────────────────────────────
 * Every section heading here is an `<h2>` and every FAQ question an `<h3>`. The
 * page's single `<h1>` belongs to `PageHeader` above. That gives one flat,
 * predictable outline per tool page rather than one that varies with how much
 * copy a tool happens to have.
 *
 * Server component. Ships no JavaScript at all.
 * ============================================================================
 */
import { Icon } from '@/components/icons';
import type { ContentSection, FaqItem, FeatureItem, HowTo } from '@/lib/registry';

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
      {children}
    </h2>
  );
}

/** The numbered steps. An `<ol>`, because the order is the content. */
function HowToSection({ howTo }: { howTo: HowTo }) {
  return (
    <section aria-labelledby="how-to" className="space-y-4">
      <SectionHeading id="how-to">{howTo.title}</SectionHeading>
      <ol className="space-y-3">
        {howTo.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            {/* The number is decorative: an `<ol>` is already numbered for
                assistive technology, so announcing "1" before "1." would be the
                same information twice. */}
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-accent-border bg-accent-subtle text-sm font-semibold text-accent-fg"
            >
              {index + 1}
            </span>
            <span className="pt-0.5 text-fg-muted">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FeatureSection({ features }: { features: FeatureItem[] }) {
  if (features.length === 0) return null;

  return (
    <section aria-labelledby="features" className="space-y-4">
      <SectionHeading id="features">What this tool does</SectionHeading>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <li key={feature.title} className="rounded-lg border border-border bg-surface p-4">
            <h3 className="flex items-start gap-2 font-medium text-fg">
              <Icon name="check" size={16} className="mt-1 shrink-0 text-success" />
              <span>{feature.title}</span>
            </h3>
            <p className="mt-1.5 text-sm text-fg-muted">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The long-form prose. Measured at `max-w-prose` rather than the full column:
 * line length is a function of the font, not the viewport, and a 90rem-wide
 * paragraph is unreadable however good the writing is.
 */
function ContentSections({ content }: { content: ContentSection[] }) {
  if (content.length === 0) return null;

  return (
    <>
      {content.map((section, index) => {
        const id = `section-${index}`;
        return (
          <section key={section.heading} aria-labelledby={id} className="space-y-3">
            <SectionHeading id={id}>{section.heading}</SectionHeading>
            <div className="max-w-prose space-y-3">
              {section.body.map((paragraph) => (
                <p key={paragraph} className="text-pretty text-fg-muted">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function FaqSection({ faq }: { faq: FaqItem[] }) {
  if (faq.length === 0) return null;

  return (
    <section aria-labelledby="faq" className="space-y-4">
      <SectionHeading id="faq">Questions</SectionHeading>
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {faq.map((item) => (
          <details key={item.q} className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
            {/* `list-none` plus the webkit rule above removes the default
                triangle in both engine families, so the chevron below is the
                only affordance and it points the right way in both states. */}
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
              <h3 className="text-sm font-medium text-fg sm:text-base">{item.q}</h3>
              <Icon
                name="chevron-down"
                size={18}
                className="shrink-0 text-fg-muted transition-transform duration-fast group-open:rotate-180"
              />
            </summary>
            <p className="mt-2 max-w-prose text-sm text-fg-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export interface ToolArticleProps {
  howTo: HowTo;
  features: FeatureItem[];
  content: ContentSection[];
  faq: FaqItem[];
}

export function ToolArticle({ howTo, features, content, faq }: ToolArticleProps) {
  return (
    <div className="space-y-10">
      <HowToSection howTo={howTo} />
      <FeatureSection features={features} />
      <ContentSections content={content} />
      <FaqSection faq={faq} />
    </div>
  );
}
