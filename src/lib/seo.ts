import type { Metadata } from 'next';

import { brand } from './brand.ts';
import { absoluteUrl, site, siteUrl } from './site.ts';
import type { Category, Tool } from './registry/types.ts';

/**
 * ============================================================================
 * SEO
 * ============================================================================
 * Two exports matter: {@link buildMetadata}, which every page calls to produce
 * its `Metadata`, and {@link pageGraph}, which produces the single JSON-LD
 * block a page embeds.
 *
 * Why this is one module rather than metadata living in each page: title
 * suffixing, canonical construction, OG image paths and robots directives are
 * the kind of thing that drifts silently. A page that forgets its canonical
 * does not look broken — it just quietly competes with itself. Centralising
 * means `scripts/check-integrity.mjs` can assert the budgets for all 30-odd
 * routes by calling these functions, which is the only way the length limits
 * stay true as copy is edited.
 *
 * This module deliberately imports no runtime value from the registry — only
 * types, which are erased. Tools and categories arrive as arguments. That keeps
 * it loadable under `node --experimental-strip-types`, so `seo.test.ts` can
 * exercise the real budget arithmetic instead of approximating it.
 * ============================================================================
 */

/** Longest title Google will render before truncating, in practice. */
const MAX_TITLE = 60;
/** Descriptions longer than this get cut mid-sentence in the SERP. */
const MAX_DESCRIPTION = 160;

/** Separator between the page title and the brand. Thin, not a pipe. */
const TITLE_SEPARATOR = ' · ';

/**
 * Warn in development when a budget is blown, and never in production.
 *
 * Throwing would be worse: a metadata string one character too long is a
 * cosmetic SERP problem, and taking the build down for it would tempt someone
 * to delete the check. `scripts/check-integrity.mjs` is where this becomes a
 * hard failure, because that runs deliberately rather than on every render.
 */
function warnIfOverBudget(kind: string, value: string, max: number): void {
  if (process.env.NODE_ENV === 'production') return;
  if (value.length > max) {
    console.warn(`[seo] ${kind} is ${value.length} chars, budget is ${max}: ${value}`);
  }
}

/**
 * Compose the document title.
 *
 * The brand suffix is dropped when the page title already ends with the brand
 * name (the homepage does), so nothing ever reads "Flint · Flint".
 */
export function pageTitle(title: string): string {
  const composed = title.endsWith(brand.name) ? title : `${title}${TITLE_SEPARATOR}${brand.name}`;
  warnIfOverBudget('title', composed, MAX_TITLE);
  return composed;
}

/**
 * Where a page's Open Graph image lives.
 *
 * A single source of truth shared with `scripts/generate-brand-assets.mjs`, so
 * the file the script writes and the file the `<meta>` tag claims cannot
 * diverge. The integrity checker asserts every path returned here exists on
 * disk — a 404 OG image is invisible in testing and embarrassing in public.
 */
export function ogImagePath(kind: 'default' | 'tool' | 'category', slug?: string): string {
  if (kind === 'default' || !slug) return site.defaultOgImage;
  return `/og/${kind}/${slug}.png`;
}

export interface MetadataInput {
  /** Without the brand suffix; {@link pageTitle} adds it. */
  title: string;
  description: string;
  /** Root-relative, e.g. `/tools/image-compressor`. Becomes the canonical. */
  path: string;
  /** Root-relative image path. Defaults to the site-wide OG image. */
  image?: string;
  /** Alt text for the OG image. Required when `image` is given. */
  imageAlt?: string;
  /** Set on thin or duplicative routes. Links are still followed. */
  noIndex?: boolean;
  /** ISO date, for `article:modified_time`. */
  updated?: string;
}

/**
 * Build a complete `Metadata` object.
 *
 * Canonicals are absolute rather than relying on `metadataBase` resolution.
 * Both work, but an absolute string is greppable and unambiguous when someone
 * is staring at page source trying to work out why two URLs are competing.
 *
 * Note what is *not* here: a `keywords` array. It has been ignored by every
 * major engine for over a decade, and shipping one is a standing invitation to
 * stuff it. The registry's `primaryKeyword` earns its place by appearing in the
 * visible copy instead.
 */
export function buildMetadata(input: MetadataInput): Metadata {
  const { title, description, path, image, imageAlt, noIndex, updated } = input;
  warnIfOverBudget('description', description, MAX_DESCRIPTION);

  const url = absoluteUrl(path);
  const ogImage = image ?? site.defaultOgImage;
  const alt = imageAlt ?? `${brand.name} — ${brand.tagline}`;

  return {
    title: pageTitle(title),
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: site.name,
      locale: site.locale,
      title: pageTitle(title),
      description,
      images: [{ url: absoluteUrl(ogImage), width: 1200, height: 630, alt }],
      ...(updated ? { modifiedTime: `${updated}T00:00:00Z` } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle(title),
      description,
      images: [absoluteUrl(ogImage)],
      // Only claim an account that exists. An empty `site` renders as
      // `<meta name="twitter:site" content="">`, which is worse than absent.
      ...(brand.social.twitter ? { site: `@${brand.social.twitter}` } : {}),
    },
    robots: noIndex
      ? { index: false, follow: true }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            'max-image-preview': 'large',
            'max-snippet': -1,
            'max-video-preview': -1,
          },
        },
  };
}

/** Metadata for a tool page. The registry already holds the written copy. */
export function toolMetadata(tool: Tool): Metadata {
  return buildMetadata({
    title: tool.metaTitle,
    description: tool.metaDescription,
    path: `/tools/${tool.slug}`,
    image: ogImagePath('tool', tool.slug),
    imageAlt: `${tool.name} — ${tool.tagline}`,
    updated: tool.updated,
  });
}

/** Metadata for a category page. */
export function categoryMetadata(category: Category): Metadata {
  return buildMetadata({
    title: category.metaTitle,
    description: category.metaDescription,
    path: `/categories/${category.slug}`,
    image: ogImagePath('category', category.slug),
    imageAlt: `${category.name} — ${category.tagline}`,
  });
}

/**
 * ============================================================================
 * STRUCTURED DATA
 * ============================================================================
 * One `<script type="application/ld+json">` per page holding an `@graph`, not
 * four separate scripts.
 *
 * Why: the nodes genuinely reference each other — the page is part of the site,
 * the site is published by the organisation, the page has a breadcrumb — and a
 * graph with stable `@id`s expresses that once instead of repeating the
 * organisation's details in every block. It is also smaller, and it makes the
 * whole page's claims reviewable in one paste into a validator.
 *
 * Honesty notes, because structured data is where sites lie:
 *   - No `aggregateRating` anywhere. We have no reviews. A fabricated rating is
 *     both a spam-policy violation and exactly the kind of small lie this
 *     product is positioned against.
 *   - `offers.price` is genuinely `0`. There is no paywall and no trial.
 *   - Google retired HowTo rich results in 2023 and restricted FAQ rich results
 *     to health and government sites. The nodes are still emitted because they
 *     accurately describe the page for every other consumer — not because a
 *     carousel is expected. Nobody should "optimise" against a snippet here.
 * ============================================================================
 */

export type JsonLdValue = string | number | boolean | null | JsonLdValue[] | { [key: string]: JsonLdValue };
export type JsonLdNode = { [key: string]: JsonLdValue };

const ORGANIZATION_ID = `${siteUrl}/#organization`;
const WEBSITE_ID = `${siteUrl}/#website`;

/**
 * The two nodes present on every page. Kept small on purpose: an Organization
 * node stuffed with an address and a phone number we do not have would be
 * fiction, and `sameAs` links are omitted rather than pointed at empty handles.
 */
function siteNodes(): JsonLdNode[] {
  const sameAs = [
    brand.social.twitter ? `https://x.com/${brand.social.twitter}` : '',
    brand.social.github ? `https://github.com/${brand.social.github}` : '',
  ].filter((value) => value !== '');

  return [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: brand.legalName,
      alternateName: brand.name,
      url: `${siteUrl}/`,
      email: brand.contact.email,
      foundingDate: String(brand.foundedYear),
      description: brand.description,
      ...(sameAs.length > 0 ? { sameAs } : {}),
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${siteUrl}/`,
      name: site.name,
      description: brand.tagline,
      inLanguage: site.lang,
      publisher: { '@id': ORGANIZATION_ID },
      // Declared because it is real: /tools reads `?q=` and filters against the
      // client index. Claiming a SearchAction a site cannot service is a common
      // and pointless bit of cargo cult.
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${siteUrl}/tools?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

export interface TrailItem {
  name: string;
  href: string;
}

/** BreadcrumbList from the same array that renders the visible `<nav>`. */
function breadcrumbNode(url: string, trail: readonly TrailItem[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.href),
    })),
  };
}

/**
 * The tool itself, as a WebApplication rather than a SoftwareApplication.
 *
 * SoftwareApplication implies something you install. Every tool here runs in the
 * tab, so WebApplication is the accurate subtype, and `browserRequirements` is
 * the honest statement of what it needs — which is a modern browser and, for the
 * browser-processed tools, nothing else at all.
 */
function applicationNode(url: string, tool: Tool): JsonLdNode {
  return {
    '@type': 'WebApplication',
    '@id': `${url}#app`,
    name: tool.name,
    url,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires a modern browser with JavaScript enabled.',
    description: tool.tagline,
    isAccessibleForFree: true,
    inLanguage: site.lang,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    featureList: tool.features.map((feature) => feature.title),
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** HowTo, built from the registry's `howTo` so the steps cannot drift. */
function howToNode(url: string, tool: Tool): JsonLdNode {
  return {
    '@type': 'HowTo',
    '@id': `${url}#howto`,
    name: tool.howTo.title,
    // `totalTime` is omitted deliberately. Every one of these takes seconds,
    // and a made-up ISO duration would be a guess dressed as a measurement.
    step: tool.howTo.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      text: step,
      url: `${url}#how-to`,
    })),
  };
}

/** Question/Answer pairs, verbatim from the registry. */
function faqEntities(faq: readonly { q: string; a: string }[]): JsonLdValue[] {
  return faq.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  }));
}

/**
 * Graph for a tool page.
 *
 * The page node carries two types. A page whose body is a FAQ section *is* a
 * FAQPage as well as a WebPage, and saying so once is more accurate than
 * emitting a second, disconnected FAQPage node that claims to be a different
 * page at the same URL — a mistake that is easy to make and hard to spot.
 */
export function toolGraph(tool: Tool, trail: readonly TrailItem[]): JsonLdNode {
  const url = absoluteUrl(`/tools/${tool.slug}`);
  const hasFaq = tool.faq.length > 0;

  const page: JsonLdNode = {
    '@type': hasFaq ? ['WebPage', 'FAQPage'] : 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: pageTitle(tool.metaTitle),
    description: tool.metaDescription,
    inLanguage: site.lang,
    isPartOf: { '@id': WEBSITE_ID },
    breadcrumb: { '@id': `${url}#breadcrumb` },
    about: { '@id': `${url}#app` },
    hasPart: { '@id': `${url}#howto` },
    dateModified: tool.updated,
    primaryImageOfPage: absoluteUrl(ogImagePath('tool', tool.slug)),
    ...(hasFaq ? { mainEntity: faqEntities(tool.faq) } : {}),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...siteNodes(),
      page,
      breadcrumbNode(url, trail),
      applicationNode(url, tool),
      howToNode(url, tool),
    ],
  };
}

export interface CollectionInput {
  path: string;
  title: string;
  description: string;
  trail: readonly TrailItem[];
  /** In display order. Becomes an ItemList, which is what a listing page is. */
  items: readonly { name: string; slug: string }[];
  image?: string;
}

/** Graph for `/tools`, `/categories` and each category page. */
export function collectionGraph(input: CollectionInput): JsonLdNode {
  const url = absoluteUrl(input.path);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...siteNodes(),
      {
        '@type': 'CollectionPage',
        '@id': `${url}#webpage`,
        url,
        name: pageTitle(input.title),
        description: input.description,
        inLanguage: site.lang,
        isPartOf: { '@id': WEBSITE_ID },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        mainEntity: { '@id': `${url}#list` },
        primaryImageOfPage: absoluteUrl(input.image ?? site.defaultOgImage),
      },
      breadcrumbNode(url, input.trail),
      {
        '@type': 'ItemList',
        '@id': `${url}#list`,
        numberOfItems: input.items.length,
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        itemListElement: input.items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          url: absoluteUrl(`/tools/${item.slug}`),
        })),
      },
    ],
  };
}

/** Graph for the homepage. Just the site nodes plus the page itself. */
export function homeGraph(description: string): JsonLdNode {
  const url = `${siteUrl}/`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...siteNodes(),
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: `${brand.name} — ${brand.tagline}`,
        description,
        inLanguage: site.lang,
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': ORGANIZATION_ID },
        primaryImageOfPage: absoluteUrl(site.defaultOgImage),
      },
    ],
  };
}

/** Graph for a static page (about, privacy, terms). */
export function pageGraph(input: {
  path: string;
  title: string;
  description: string;
  trail: readonly TrailItem[];
}): JsonLdNode {
  const url = absoluteUrl(input.path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...siteNodes(),
      {
        '@type': 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: pageTitle(input.title),
        description: input.description,
        inLanguage: site.lang,
        isPartOf: { '@id': WEBSITE_ID },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      breadcrumbNode(url, input.trail),
    ],
  };
}

/**
 * Serialise a graph for `dangerouslySetInnerHTML`.
 *
 * The `<` escape is the whole point and is not optional. JSON is not HTML, so a
 * string anywhere in the graph containing `</script>` would end the script
 * element early and inject the rest as markup — a stored-XSS shaped hole opened
 * by nothing more exotic than a FAQ answer that mentions a tag. `<` is
 * valid JSON, parses back to `<`, and cannot close an element. `&` and `>` are
 * escaped too so the output is inert in every parsing mode.
 */
export function serialiseJsonLd(graph: JsonLdNode): string {
  return JSON.stringify(graph)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}







