import assert from 'node:assert/strict';
import test from 'node:test';

import { describePages, parsePageRanges } from './ranges.ts';

/** Shorthand: assert a successful parse and return the pages. */
function pages(input: string, count: number): number[] {
  const result = parsePageRanges(input, count);
  assert.equal(result.ok, true, `expected "${input}" to parse: ${result.ok ? '' : result.error}`);
  return result.ok ? result.pages : [];
}

/** Shorthand: assert a rejection and return the sentence shown to the user. */
function rejected(input: string, count: number): string {
  const result = parsePageRanges(input, count);
  assert.equal(result.ok, false, `expected "${input}" to be rejected`);
  return result.ok ? '' : result.error;
}

test('a single page is that page', () => {
  assert.deepEqual(pages('3', 10), [3]);
});

test('a range is inclusive at both ends — the off-by-one that matters most', () => {
  assert.deepEqual(pages('2-5', 10), [2, 3, 4, 5]);
});

test('page numbers are 1-based, so page 1 is the first page and page 0 does not exist', () => {
  assert.deepEqual(pages('1', 10), [1]);
  assert.match(rejected('0', 10), /not a page range/);
});

test('commas, spaces and semicolons all separate items', () => {
  assert.deepEqual(pages('1,3', 10), [1, 3]);
  assert.deepEqual(pages('1 3', 10), [1, 3]);
  assert.deepEqual(pages('1; 3', 10), [1, 3]);
  assert.deepEqual(pages('1 ,  3 ', 10), [1, 3]);
});

test('an en dash or em dash reads as a range, because pasted text has been autocorrected', () => {
  assert.deepEqual(pages('2–4', 10), [2, 3, 4]);
  assert.deepEqual(pages('2—4', 10), [2, 3, 4]);
  assert.deepEqual(pages('2‑4', 10), [2, 3, 4]);
});

test('an open end runs to the last page', () => {
  assert.deepEqual(pages('8-', 10), [8, 9, 10]);
});

test('an open start runs from the first page', () => {
  assert.deepEqual(pages('-3', 10), [1, 2, 3]);
});

test('a descending range is read as the range it obviously means', () => {
  assert.deepEqual(pages('7-4', 10), [4, 5, 6, 7]);
});

test('overlapping and duplicated items collapse, and the result is sorted', () => {
  assert.deepEqual(pages('3, 1-5, 3', 10), [1, 2, 3, 4, 5]);
  assert.deepEqual(pages('9, 2', 10), [2, 9]);
});

test('a page past the end is refused rather than clamped, and the message says why', () => {
  const message = rejected('1-50', 12);
  assert.match(message, /12 pages/);
  assert.match(message, /does not exist/);
});

test('the last page of the document is accepted', () => {
  assert.deepEqual(pages('12', 12), [12]);
});

test('an empty expression is an error, not "everything"', () => {
  assert.match(rejected('', 10), /Enter which pages/);
  assert.match(rejected('   ', 10), /Enter which pages/);
});

test('nonsense is refused with the offending text quoted back', () => {
  assert.match(rejected('abc', 10), /abc/);
  assert.match(rejected('1.5', 10), /1\.5/);
  assert.match(rejected('1--5', 10), /1--5/);
  assert.match(rejected('1-2-3', 10), /1-2-3/);
});

test('a document with no pages cannot be split', () => {
  assert.match(rejected('1', 0), /no pages/);
});

test('a single-page document says "page", not "pages"', () => {
  assert.match(rejected('2', 1), /1 page\./);
});

test('describePages is the inverse of a parse, collapsing runs', () => {
  assert.equal(describePages([1, 2, 3, 7, 9, 10]), '1-3, 7, 9-10');
  assert.equal(describePages([4]), '4');
  assert.equal(describePages([2, 4, 6]), '2, 4, 6');
  assert.equal(describePages([]), 'no pages');
});

test('describePages sorts before grouping, so an unordered list still reads correctly', () => {
  assert.equal(describePages([3, 1, 2]), '1-3');
});

test('a round trip through both functions is stable', () => {
  const first = pages('1-3, 7, 9-10', 10);
  const text = describePages(first);
  assert.deepEqual(pages(text, 10), first);
});
