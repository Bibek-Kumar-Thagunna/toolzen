import test from 'node:test';
import assert from 'node:assert/strict';

import { slugify, slugifyPreview } from './slug.ts';

test('slugify: the cases that define the transliteration pipeline', () => {
  // Latin diacritics come off via NFKD; `&` and `.` are word boundaries.
  assert.equal(slugify('Crème Brûlée & Co.'), 'creme-brulee-co');
  // NFKD leaves `ß` alone, so the lookup table has to spell it out.
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('Привет мир'), 'privet-mir');
  // The tonos on `ά` is a combining mark once decomposed, then Greek maps over.
  assert.equal(slugify('Ελλάδα'), 'ellada');
  assert.equal(slugify('  --Hello___World--  '), 'hello-world');
});

test('slugify: those five cases produce no warnings at all', () => {
  const inputs = ['Crème Brûlée & Co.', 'Straße', 'Привет мир', 'Ελλάδα', '  --Hello___World--  '];
  for (const input of inputs) {
    assert.deepEqual(slugifyPreview(input).warnings, [], `unexpected warning for ${input}`);
  }
});

test('slugify: runs of separators never double up or hang off an end', () => {
  for (const input of [
    'hello---world',
    'hello   world',
    '...hello...world...',
    '-hello-world-',
    'hello_-_world',
    '///hello///world///',
    'hello, world',
  ]) {
    const slug = slugify(input);
    assert.equal(slug, 'hello-world', `for input ${JSON.stringify(input)}`);
    assert.equal(slug.includes('--'), false);
    assert.equal(slug.startsWith('-'), false);
    assert.equal(slug.endsWith('-'), false);
  }
});

test('slugify: more of the extended Latin, Cyrillic and Greek tables', () => {
  assert.equal(slugify('Æther Œuvre Ødegård'), 'aether-oeuvre-odegard');
  assert.equal(slugify('Þórr Ðegi Łódź Đakovo'), 'thorr-degi-lodz-dakovo');
  assert.equal(slugify('Ёлка Йога Щука Жук Чай'), 'yolka-yoga-shchuka-zhuk-chay');
  assert.equal(slugify('Θεός Ψυχή Χάος Ωμέγα'), 'theos-psychi-chaos-omega');
  assert.equal(slugify('Ласкаво Просимо'), 'laskavo-prosimo');
});

test('slugify: maxLength cuts at a word boundary, never mid-word', () => {
  const input = 'the quick brown fox jumps over the lazy dog';
  // `the-quick-brown` is exactly 15; adding `-fox` would be 19, so it stops.
  assert.equal(slugify(input, { maxLength: 15 }), 'the-quick-brown');
  assert.equal(slugify(input, { maxLength: 18 }), 'the-quick-brown');
  assert.equal(slugify(input, { maxLength: 19 }), 'the-quick-brown-fox');
  assert.equal(slugify(input, { maxLength: 3 }), 'the');
  // Never a trailing separator, whatever the limit.
  for (let limit = 1; limit <= 45; limit += 1) {
    const slug = slugify(input, { maxLength: limit });
    assert.ok(slug.length <= limit, `limit ${limit} produced ${slug}`);
    assert.equal(slug.endsWith('-'), false, `limit ${limit} produced ${slug}`);
  }
});

test('slugify: a first word over the limit is the one mid-word cut', () => {
  const preview = slugifyPreview('extraordinarily long title', { maxLength: 5 });
  assert.equal(preview.slug, 'extra');
  assert.deepEqual(preview.warnings, [
    'The first word is longer than 5 characters, so it was cut short.',
  ]);
  // A word-boundary cut says so instead.
  assert.deepEqual(slugifyPreview('alpha beta gamma', { maxLength: 11 }).warnings, [
    'Shortened to 11 characters at a word boundary.',
  ]);
  assert.equal(slugifyPreview('alpha beta gamma', { maxLength: 11 }).slug, 'alpha-beta');
});

test('slugify: an all-emoji input is empty and warned about, not thrown', () => {
  const preview = slugifyPreview('🎉🎊🥳🎈');
  assert.equal(preview.slug, '');
  assert.equal(preview.warnings.length, 2);
  assert.match(preview.warnings[0], /Dropped 4 characters with no Latin spelling/);
  assert.match(preview.warnings[1], /Nothing usable was left/);
  // The same holds for scripts with no table, and for punctuation-only input.
  assert.equal(slugify('日本語'), '');
  assert.match(slugifyPreview('日本語').warnings[0], /Dropped 3 characters/);
  assert.equal(slugify('!!! ??? ...'), '');
  // Punctuation is an expected boundary, so only the emptiness is worth saying.
  assert.deepEqual(slugifyPreview('!!! ??? ...').warnings, [
    'Nothing usable was left — add some letters or numbers.',
  ]);
  assert.deepEqual(slugifyPreview('').warnings.length, 1);
});

test('slugify: separator, lowercase and digits', () => {
  assert.equal(slugify('Hello World', { separator: '_' }), 'hello_world');
  assert.equal(slugify('Hello   World', { separator: '_' }), 'hello_world');
  assert.equal(slugify('Hello World', { separator: '' }), 'helloworld');
  assert.equal(slugify('Hello World', { lowercase: false }), 'Hello-World');
  assert.equal(slugify('Straße', { lowercase: false }), 'Strasse');
  assert.equal(slugify('Top 10 Tools for 2026'), 'top-10-tools-for-2026');
  // NFKD folds the compatibility forms, so these are not lost.
  assert.equal(slugify('½ ﬁle Ⅷ'), '1-2-file-viii');
});

test('slugify: apostrophes join the word rather than splitting it', () => {
  assert.equal(slugify("Don't Stop Me Now"), 'dont-stop-me-now');
  assert.equal(slugify('Don’t Stop'), 'dont-stop');
  assert.equal(slugify('Русь'), 'rus');
});

test('slugify: stripStopWords, and the refusal to strip everything', () => {
  assert.equal(slugify('The Best of the Rest', { stripStopWords: true }), 'best-rest');
  assert.equal(slugify('The Best of the Rest'), 'the-best-of-the-rest');
  const allStop = slugifyPreview('The Of And', { stripStopWords: true });
  assert.equal(allStop.slug, 'the-of-and');
  assert.deepEqual(allStop.warnings, ['Every word is a stop word, so none were removed.']);
});

test('slugify: transliterate:false keeps NFKD folding but drops the tables', () => {
  const opts = { transliterate: false } as const;
  // Accents still come off, because that is normalisation rather than a table.
  assert.equal(slugify('Crème Brûlée', opts), 'creme-brulee');
  // `ß` and Cyrillic have nowhere to go once the tables are off.
  const preview = slugifyPreview('Straße Привет', opts);
  assert.equal(preview.slug, 'stra-e');
  assert.match(preview.warnings[0], /Dropped 7 characters with no Latin spelling/);
  assert.match(preview.warnings[0], /and 4 more\./);
});

test('slugify: degenerate maxLength values are ignored rather than fatal', () => {
  const input = 'alpha beta gamma';
  assert.equal(slugify(input, { maxLength: Number.NaN }), 'alpha-beta-gamma');
  assert.equal(slugify(input, { maxLength: Number.POSITIVE_INFINITY }), 'alpha-beta-gamma');
  // Zero and negatives mean "no limit", the same as leaving it unset.
  assert.equal(slugify(input, { maxLength: 0 }), 'alpha-beta-gamma');
  assert.equal(slugify(input, { maxLength: -5 }), 'alpha-beta-gamma');
  assert.equal(slugify(input, { maxLength: 2.9 }), 'al');
});

test('slugify: no options at all is the same as the defaults', () => {
  assert.equal(slugify('Hello World'), slugify('Hello World', {}));
  assert.deepEqual(slugifyPreview('Hello World'), { slug: 'hello-world', warnings: [] });
});

