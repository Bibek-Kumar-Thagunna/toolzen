import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSearchIndex,
  groupByCategory,
  normalise,
  searchTools,
  type SearchSource,
} from './search.ts';

/**
 * A miniature registry. Deliberately hand-written rather than imported from the
 * real one: these tests assert ranking behaviour, and they should fail when the
 * ranking changes, not when someone edits a tool's keyword list.
 */
const sources: SearchSource[] = [
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    tagline: 'Make photos smaller without an obvious drop in quality.',
    category: 'image',
    icon: 'compress',
    primaryKeyword: 'compress image',
    secondaryKeywords: ['reduce image size', 'compress jpg'],
    synonyms: ['shrink image', 'make photo smaller', 'optimise image'],
    popular: true,
  },
  {
    slug: 'jpg-to-png',
    name: 'JPG to PNG',
    tagline: 'Turn a JPG into a PNG in your browser.',
    category: 'image',
    icon: 'file-image',
    primaryKeyword: 'jpg to png',
    secondaryKeywords: ['convert jpg to png', 'jpeg to png'],
    synonyms: ['change jpg to png', 'jpg png converter'],
  },
  {
    slug: 'png-to-webp',
    name: 'PNG to WebP',
    tagline: 'Convert PNG images to WebP and keep the alpha channel.',
    category: 'image',
    icon: 'image',
    primaryKeyword: 'png to webp',
    secondaryKeywords: ['convert png to webp', 'alpha channel'],
    synonyms: ['png webp converter'],
  },
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    tagline: 'Format, validate and inspect JSON with precise error positions.',
    category: 'developer',
    icon: 'braces',
    primaryKeyword: 'json formatter',
    secondaryKeywords: ['json validator', 'beautify json', 'minify json'],
    synonyms: ['json pretty print', 'json lint', 'format json online'],
    popular: true,
  },
  {
    slug: 'word-counter',
    name: 'Word Counter',
    tagline: 'Count words, characters, sentences and reading time as you type.',
    category: 'text',
    icon: 'list',
    primaryKeyword: 'word counter',
    secondaryKeywords: ['character count', 'reading time'],
    synonyms: ['count words', 'text statistics'],
    popular: true,
  },
  {
    slug: 'cafe-namer',
    name: 'Café Namer',
    tagline: 'A tool with an accent in its name, for folding tests.',
    category: 'generators',
    icon: 'spark',
    primaryKeyword: 'cafe namer',
    secondaryKeywords: [],
    synonyms: [],
  },
];

const docs = buildSearchIndex(sources);
const slugs = (query: string, limit = 8) =>
  searchTools(docs, query, { limit }).map((hit) => hit.doc.slug);

test('normalise folds case, accents and punctuation', () => {
  assert.equal(normalise('Café'), 'cafe');
  assert.equal(normalise('JPG→PNG'), 'jpg png');
  assert.equal(normalise('  JSON_formatter!  '), 'json formatter');
  assert.equal(normalise('---'), '');
});

test('normalise canonicalises British spellings', () => {
  assert.equal(normalise('Colour Palette'), 'color palette');
  assert.equal(normalise('optimise'), 'optimize');
  assert.equal(normalise('greyscale'), 'grayscale');
  // Already canonical, and left alone.
  assert.equal(normalise('color'), 'color');
  // A rule-based fold would have wrecked these.
  assert.equal(normalise('four hours'), 'four hours');
  assert.equal(normalise('centred are'), 'centered are');
});

test('the index keeps display strings and adds folded ones', () => {
  const doc = docs[0];
  assert.equal(doc.name, 'Image Compressor');
  assert.equal(doc.n, 'image compressor');
  assert.equal(doc.s, 'image compressor');
  assert.equal(doc.k[0], 'compress image');
  assert.equal(doc.popular, true);
  assert.equal(docs[1].popular, false, 'absent popular flag becomes false');
});

test('an empty query returns the popular tools', () => {
  assert.deepEqual(slugs(''), ['image-compressor', 'json-formatter', 'word-counter']);
  assert.deepEqual(slugs('   '), ['image-compressor', 'json-formatter', 'word-counter']);
});

test('an empty query honours an explicit fallback', () => {
  const fallback = [docs[5]];
  const hits = searchTools(docs, '', { fallback });
  assert.deepEqual(
    hits.map((h) => h.doc.slug),
    ['cafe-namer'],
  );
});

test('a name prefix outranks a keyword match', () => {
  // "json" prefixes the name of one tool and appears in nothing else.
  assert.equal(slugs('json')[0], 'json-formatter');
  // "word" prefixes Word Counter's name; nothing else should come first.
  assert.equal(slugs('word')[0], 'word-counter');
});

test('an exact slug match wins outright', () => {
  assert.equal(slugs('jpg to png')[0], 'jpg-to-png');
  assert.equal(slugs('png-to-webp')[0], 'png-to-webp');
});

test('multi-token queries require every token before falling back', () => {
  // Both tokens hit png-to-webp; jpg-to-png matches only "png".
  assert.equal(slugs('png webp')[0], 'png-to-webp');
  assert.equal(slugs('png webp').length, 1, 'strict pass should not admit partials');
});

test('a filler word does not empty the results', () => {
  // "my" is dropped as a single-character-plus token that matches nothing, so
  // the OR fallback must still surface the compressor.
  const hits = slugs('compress my image');
  assert.ok(hits.includes('image-compressor'), `got ${hits.join(', ')}`);
  assert.equal(hits[0], 'image-compressor');
});

test('synonyms are searchable but never shown', () => {
  assert.equal(slugs('shrink')[0], 'image-compressor');
  assert.equal(slugs('pretty print')[0], 'json-formatter');
  const hit = searchTools(docs, 'shrink', { limit: 1 })[0];
  assert.equal(hit.doc.name, 'Image Compressor');
  assert.equal(
    Object.prototype.hasOwnProperty.call(hit.doc, 'synonyms'),
    false,
    'the shipped doc must not carry a synonyms field under that name',
  );
});

test('accents in the query and in the name both fold', () => {
  assert.equal(slugs('cafe')[0], 'cafe-namer');
  assert.equal(slugs('café')[0], 'cafe-namer');
});

test('highlight ranges land on the display name', () => {
  const [hit] = searchTools(docs, 'compress', { limit: 1 });
  assert.equal(hit.doc.name, 'Image Compressor');
  assert.deepEqual(hit.ranges, [[6, 14]]);
  assert.equal(hit.doc.name.slice(6, 14), 'Compress');
});

test('highlight ranges survive an accented name', () => {
  const [hit] = searchTools(docs, 'cafe', { limit: 1 });
  assert.deepEqual(hit.ranges, [[0, 4]]);
  assert.equal(hit.doc.name.slice(0, 4), 'Café');
});

test('separate tokens produce separate highlight ranges', () => {
  const [hit] = searchTools(docs, 'json format', { limit: 1 });
  // "JSON Formatter" — the space between them is not part of either match.
  assert.deepEqual(hit.ranges, [
    [0, 4],
    [5, 11],
  ]);
});

test('overlapping highlight ranges merge', () => {
  const [hit] = searchTools(docs, 'format formatter', { limit: 1 });
  assert.equal(hit.doc.name, 'JSON Formatter');
  assert.deepEqual(hit.ranges, [[5, 14]]);
});

test('a query matching nothing returns nothing', () => {
  assert.deepEqual(slugs('zzzzqqqq'), []);
});

test('fuzzy matching catches an abbreviation but not noise', () => {
  assert.equal(slugs('jsnfmt')[0], 'json-formatter');
  // Every letter of "iae" appears in order across several names, but never
  // tightly, so nothing should match on a subsequence alone.
  assert.deepEqual(slugs('zqx'), []);
});

test('a single character still prefix-searches', () => {
  const hits = slugs('j');
  assert.ok(hits.includes('json-formatter'), `got ${hits.join(', ')}`);
  assert.ok(hits.includes('jpg-to-png'), `got ${hits.join(', ')}`);
});

test('limit is respected', () => {
  assert.equal(slugs('to', 2).length, 2);
});

test('popularity breaks ties, then registry order', () => {
  // "image" prefixes the compressor's name and appears in the others' copy, so
  // the compressor must lead on tier alone.
  assert.equal(slugs('image')[0], 'image-compressor');
});

test('the query length is bounded', () => {
  const long = `json${'x'.repeat(500)}`;
  assert.doesNotThrow(() => searchTools(docs, long));
});

test('groupByCategory preserves rank order within a bucket', () => {
  const hits = searchTools(docs, 'png', { limit: 8 });
  const grouped = groupByCategory(hits);
  const image = grouped.get('image');
  assert.ok(image);
  assert.deepEqual(
    image.map((h) => h.doc.slug),
    hits.filter((h) => h.doc.category === 'image').map((h) => h.doc.slug),
  );
});
