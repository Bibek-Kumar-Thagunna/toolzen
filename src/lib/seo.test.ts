import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMetadata,
  collectionGraph,
  homeGraph,
  ogImagePath,
  pageTitle,
  serialiseJsonLd,
  toolGraph,
  type JsonLdNode,
  type JsonLdValue,
} from './seo.ts';
import type { Tool } from './registry/types.ts';
import { brand } from './brand.ts';
import { categories } from './registry/categories.ts';
import { tools } from './registry/index.ts';

/**
 * A fixture rather than a real registry entry, so these tests fail when the SEO
 * layer changes and not when someone rewrites a FAQ answer. The nasty strings
 * are deliberate: a `</script>` in copy is the one input that turns a JSON-LD
 * block into an injection, and an ampersand is the one that silently breaks a
 * validator.
 */
const tool: Tool = {
  slug: 'image-compressor',
  name: 'Image Compressor',
  h1: 'Compress an image',
  tagline: 'Make photos smaller without an obvious drop in quality.',
  category: 'image',
  icon: 'compress',
  surface: 'files',
  processing: 'browser',
  metaTitle: 'Image Compressor — JPG, PNG & WebP',
  metaDescription:
    'Compress JPG, PNG and WebP images in your browser. Pick a quality level, see the saving before you download, and keep the original untouched.',
  primaryKeyword: 'compress image',
  secondaryKeywords: ['reduce image size'],
  synonyms: ['shrink image'],
  accepts: { mime: ['image/jpeg'], label: 'JPG, PNG, WebP', maxBytes: 20_000_000, maxFiles: 20 },
  howTo: {
    title: 'How to compress an image',
    steps: ['Drop an image in.', 'Choose a quality level.', 'Download the result.'],
  },
  features: [
    { title: 'Runs on your device', body: 'Nothing is uploaded.' },
    { title: 'Shows the saving', body: 'Before and after, side by side.' },
  ],
  faq: [
    { q: 'Does it work offline?', a: 'Yes — after the first visit.' },
    { q: 'Is <script>alert(1)</script> safe in copy?', a: 'It must be: A & B < C.' },
  ],
  content: [{ heading: 'How compression works', body: ['Lossy codecs discard detail.'] }],
  related: ['image-resizer'],
  popular: true,
  updated: '2026-09-03',
};

const trail = [
  { name: 'Home', href: '/' },
  { name: 'Tools', href: '/tools' },
  { name: 'Image tools', href: '/categories/image' },
  { name: 'Image Compressor', href: '/tools/image-compressor' },
];

test('pageTitle appends the brand once', () => {
  // Derived from `brand.name`, not written out. A test that hardcodes the brand
  // fails on a rename — which is a false alarm that trains people to edit the
  // test until it passes, and the next real regression goes with it.
  assert.equal(pageTitle('Word Counter'), `Word Counter · ${brand.name}`);
  assert.equal(
    pageTitle(`Fast, private tools · ${brand.name}`),
    `Fast, private tools · ${brand.name}`,
  );
});

test('every real title in the registry fits the SERP budget', () => {
  /*
   * The invariant that actually matters, checked against the real content
   * rather than a synthetic string of the right length.
   *
   * Google truncates around 60 characters, and a truncated title loses its
   * least important words last — which on these pages is the brand, the one
   * word doing the job of making someone recognise us in a result list a second
   * time. The suffix is part of the budget, so a longer brand name eats into
   * what each page may say, and this test is what makes that trade visible at
   * the moment somebody renames the site rather than a month later in Search
   * Console.
   */
  const oversized: string[] = [];

  for (const entry of tools) {
    const composed = pageTitle(entry.metaTitle);
    if (composed.length > 60) oversized.push(`${composed} (${composed.length})`);
  }
  for (const entry of categories) {
    const composed = pageTitle(entry.metaTitle);
    if (composed.length > 60) oversized.push(`${composed} (${composed.length})`);
  }

  assert.deepEqual(
    oversized,
    [],
    `these titles would be truncated in search results:\n  ${oversized.join('\n  ')}`,
  );
});

test('the brand is never printed twice, wherever it already appears', () => {
  /*
   * Regression. The homepage title is `${brand.name} — ${brand.tagline}`, which
   * *starts* with the brand rather than ending with it. An `endsWith` guard let
   * that through and shipped "Toolzen — Fast, private tools that just work. ·
   * Toolzen" to production — the name twice, in a sixty-character budget.
   */
  const homepage = pageTitle(`${brand.name} — a tagline`);
  assert.equal(homepage, `${brand.name} — a tagline`);
  assert.equal(homepage.split(brand.name).length - 1, 1, 'brand should appear exactly once');

  // Still appended when genuinely absent, and still not doubled at the end.
  assert.equal(pageTitle('Word Counter'), `Word Counter · ${brand.name}`);
  assert.equal(pageTitle(`Word Counter · ${brand.name}`), `Word Counter · ${brand.name}`);

  // And the real homepage metadata, not a stand-in for it.
  const real = pageTitle(`${brand.name} — ${brand.tagline}`);
  assert.equal(real.split(brand.name).length - 1, 1, `homepage title repeats the brand: ${real}`);
  assert.ok(real.length <= 60, `homepage title is ${real.length} chars: ${real}`);
});

test('the brand suffix leaves a usable budget for a page title', () => {
  // Guards the rename case from the other direction: a brand long enough to
  // squeeze page titles below ~40 characters is a branding decision with an SEO
  // cost, and it should not be possible to make it without seeing this fail.
  const budget = 60 - ` · ${brand.name}`.length;
  assert.ok(budget >= 40, `"${brand.name}" leaves only ${budget} characters for a page title`);
});

test('canonical and OG URLs are absolute', () => {
  const meta = buildMetadata({ title: 'T', description: 'D', path: '/tools/x' });
  assert.equal(meta.alternates?.canonical, 'http://localhost:3000/tools/x');
  assert.equal(meta.openGraph?.url, 'http://localhost:3000/tools/x');
  const images = meta.openGraph?.images as { url: string }[];
  assert.ok(images[0].url.startsWith('http://localhost:3000/'), images[0].url);
});

test('no Twitter handle is claimed when none is configured', () => {
  const meta = buildMetadata({ title: 'T', description: 'D', path: '/' });
  assert.equal('site' in (meta.twitter ?? {}), false);
});

test('noIndex still allows following links', () => {
  const meta = buildMetadata({ title: 'T', description: 'D', path: '/x', noIndex: true });
  assert.deepEqual(meta.robots, { index: false, follow: true });
});

test('OG image paths are derived, never hand-written', () => {
  assert.equal(ogImagePath('default'), '/og/default.png');
  assert.equal(ogImagePath('tool', 'jpg-to-png'), '/og/tool/jpg-to-png.png');
  assert.equal(ogImagePath('category', 'pdf'), '/og/category/pdf.png');
  // A missing slug must fall back rather than produce `/og/tool/undefined.png`.
  assert.equal(ogImagePath('tool'), '/og/default.png');
});

/** Walk a graph, collecting every `@id` that is defined and every one referenced. */
function collectIds(graph: JsonLdNode): { defined: Set<string>; referenced: Set<string> } {
  const defined = new Set<string>();
  const referenced = new Set<string>();

  const visit = (value: JsonLdValue): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const keys = Object.keys(value);
    const id = value['@id'];
    if (typeof id === 'string') {
      // An object that is nothing but an `@id` is a pointer; anything else
      // carrying an `@id` is the node that defines it.
      if (keys.length === 1) referenced.add(id);
      else defined.add(id);
    }
    for (const key of keys) visit(value[key]);
  };

  visit(graph['@graph'] ?? null);
  return { defined, referenced };
}

test('every @id reference in a tool graph resolves to a node in the same graph', () => {
  const { defined, referenced } = collectIds(toolGraph(tool, trail));
  const dangling = [...referenced].filter((id) => !defined.has(id));
  assert.deepEqual(dangling, [], `dangling references: ${dangling.join(', ')}`);
  assert.ok(defined.size >= 5, `expected the full node set, got ${defined.size}`);
});

test('a tool graph declares the page, breadcrumb, app and howto nodes', () => {
  const nodes = toolGraph(tool, trail)['@graph'] as JsonLdNode[];
  const types = nodes.map((node) => JSON.stringify(node['@type']));
  assert.deepEqual(types, [
    '"Organization"',
    '"WebSite"',
    '["WebPage","FAQPage"]',
    '"BreadcrumbList"',
    '"WebApplication"',
    '"HowTo"',
  ]);
});

test('breadcrumb positions are 1-based and absolute', () => {
  const nodes = toolGraph(tool, trail)['@graph'] as JsonLdNode[];
  const crumbs = nodes.find((node) => node['@type'] === 'BreadcrumbList');
  const items = crumbs?.itemListElement as { position: number; item: string }[];
  assert.deepEqual(
    items.map((item) => item.position),
    [1, 2, 3, 4],
  );
  assert.equal(items[0].item, 'http://localhost:3000/');
  assert.equal(items[3].item, 'http://localhost:3000/tools/image-compressor');
});

test('FAQ questions are carried verbatim as the page mainEntity', () => {
  const nodes = toolGraph(tool, trail)['@graph'] as JsonLdNode[];
  const page = nodes[2];
  const questions = page.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
  assert.equal(questions.length, 2);
  assert.equal(questions[0].name, 'Does it work offline?');
  assert.equal(questions[1].acceptedAnswer.text, 'It must be: A & B < C.');
});

test('no rating, review or download count is ever fabricated', () => {
  const json = JSON.stringify(toolGraph(tool, trail));
  for (const forbidden of ['aggregateRating', 'ratingValue', 'reviewCount', 'downloadUrl']) {
    assert.equal(json.includes(forbidden), false, `graph must not claim ${forbidden}`);
  }
  // And the free claim must be real, not a trial.
  assert.ok(json.includes('"price":"0"'));
  assert.ok(json.includes('"isAccessibleForFree":true'));
});

test('serialisation cannot close the script element', () => {
  const html = serialiseJsonLd(toolGraph(tool, trail));
  assert.equal(html.includes('</'), false, 'a closing tag survived serialisation');
  assert.equal(html.includes('<'), false);
  assert.equal(html.includes('>'), false);
  assert.equal(html.includes('&'), false);
  // Still valid JSON, and the escapes decode back to the original text.
  const parsed = JSON.parse(html) as { '@graph': JsonLdNode[] };
  const page = parsed['@graph'][2];
  const questions = page.mainEntity as { name: string }[];
  assert.equal(questions[1].name, 'Is <script>alert(1)</script> safe in copy?');
});

test('a collection graph counts its own items', () => {
  const graph = collectionGraph({
    path: '/categories/image',
    title: 'Image Tools',
    description: 'Six image tools.',
    trail: trail.slice(0, 3),
    items: [
      { name: 'Image Compressor', slug: 'image-compressor' },
      { name: 'Image Resizer', slug: 'image-resizer' },
    ],
  });
  const nodes = graph['@graph'] as JsonLdNode[];
  const list = nodes.find((node) => node['@type'] === 'ItemList');
  assert.equal(list?.numberOfItems, 2);
  const items = list?.itemListElement as { url: string }[];
  assert.equal(items[1].url, 'http://localhost:3000/tools/image-resizer');
  const { defined, referenced } = collectIds(graph);
  assert.deepEqual([...referenced].filter((id) => !defined.has(id)), []);
});

test('the home graph references only nodes it defines', () => {
  const { defined, referenced } = collectIds(homeGraph('Fast, private tools.'));
  assert.deepEqual([...referenced].filter((id) => !defined.has(id)), []);
});

test('the search action points at a URL the site actually handles', () => {
  const nodes = homeGraph('d')['@graph'] as JsonLdNode[];
  const website = nodes.find((node) => node['@type'] === 'WebSite');
  const action = website?.potentialAction as { target: { urlTemplate: string } };
  assert.equal(action.target.urlTemplate, 'http://localhost:3000/tools?q={search_term_string}');
});



