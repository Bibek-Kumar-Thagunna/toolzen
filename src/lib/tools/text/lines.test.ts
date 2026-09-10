import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addPrefixSuffix,
  countLines,
  dedupeLines,
  detectLineEnding,
  numberLines,
  removeWhitespace,
  repeatText,
  sortLines,
} from './lines.ts';
import type { WhitespaceMode } from './lines.ts';

/** Fails loudly rather than returning `undefined`, so a guard bug cannot hide. */
function repeated(input: string, times: number, separator?: string): string {
  const result = repeatText(input, { times, separator });
  assert.equal(result.ok, true, `expected a result, got ${JSON.stringify(result)}`);
  return result.ok ? result.result : '';
}

test('detectLineEnding: reports the dominant ending, defaulting to LF', () => {
  assert.equal(detectLineEnding('a\r\nb\r\nc'), '\r\n');
  assert.equal(detectLineEnding('a\nb\nc'), '\n');
  assert.equal(detectLineEnding('no breaks at all'), '\n');
  assert.equal(detectLineEnding(''), '\n');
  // Mixed: CRLF has to be strictly ahead, so a tie stays on LF.
  assert.equal(detectLineEnding('a\r\nb\nc'), '\n');
  assert.equal(detectLineEnding('a\r\nb\r\nc\nd'), '\r\n');
});

test('dedupeLines: keep-first and keep-last differ in order and in casing', () => {
  const input = 'a\nb\na\nc';
  assert.deepEqual(dedupeLines(input, { keep: 'first' }), {
    result: 'a\nb\nc',
    removedCount: 1,
    uniqueCount: 3,
  });
  // The surviving `a` is the third line, so it lands after `b`.
  assert.deepEqual(dedupeLines(input, { keep: 'last' }), {
    result: 'b\na\nc',
    removedCount: 1,
    uniqueCount: 3,
  });
});

test('dedupeLines: case-insensitive keeps whichever copy `keep` names', () => {
  const input = 'Apple\napple\nAPPLE\nBanana';
  assert.equal(dedupeLines(input, { caseSensitive: false }).result, 'Apple\nBanana');
  assert.equal(
    dedupeLines(input, { caseSensitive: false, keep: 'last' }).result,
    'APPLE\nBanana',
  );
  assert.equal(dedupeLines(input, { caseSensitive: false }).removedCount, 2);
  // The default is case-sensitive, so all four lines are distinct.
  assert.equal(dedupeLines(input, {}).uniqueCount, 4);
});

test('dedupeLines: trimBeforeCompare compares trimmed but keeps the spacing', () => {
  const result = dedupeLines('  hello\nhello  \nworld', { trimBeforeCompare: true });
  assert.equal(result.result, '  hello\nworld');
  assert.equal(result.removedCount, 1);
});

test('dedupeLines: removeEmpty counts blanks as removals', () => {
  const result = dedupeLines('a\n\n  \nb\na', { removeEmpty: true });
  assert.deepEqual(result, { result: 'a\nb', removedCount: 3, uniqueCount: 2 });
});

test('dedupeLines: empty input is empty output, not one blank line', () => {
  assert.deepEqual(dedupeLines('', {}), { result: '', removedCount: 0, uniqueCount: 0 });
});

test('sortLines: natural order is numeric-aware', () => {
  assert.equal(
    sortLines('item2\nitem10\nitem1', { order: 'natural' }),
    'item1\nitem2\nitem10',
  );
  // Plain `asc` is the lexicographic answer, which is the point of having both.
  assert.equal(sortLines('item2\nitem10\nitem1', { order: 'asc' }), 'item1\nitem10\nitem2');
  assert.equal(
    sortLines('file20.txt\nfile3.txt\nfile100.txt', { order: 'natural' }),
    'file3.txt\nfile20.txt\nfile100.txt',
  );
});

test('sortLines: the remaining orders', () => {
  assert.equal(sortLines('b\na\nc', { order: 'desc' }), 'c\nb\na');
  assert.equal(sortLines('ccc\na\nbb', { order: 'length-asc' }), 'a\nbb\nccc');
  assert.equal(sortLines('ccc\na\nbb', { order: 'length-desc' }), 'ccc\nbb\na');
  assert.equal(sortLines('a\nb\nc', { order: 'reverse' }), 'c\nb\na');
  // Length is counted in code points: one emoji is one character, not two.
  assert.equal(sortLines('ab\n\u{1F389}', { order: 'length-asc' }), '\u{1F389}\nab');
});

test('sortLines: case-insensitive treats casing as a tie, so input order breaks it', () => {
  const input = 'banana\nApple\napple\nCherry';
  assert.equal(
    sortLines(input, { order: 'asc', caseSensitive: false }),
    'Apple\napple\nbanana\nCherry',
  );
});

test('sortLines: removeEmpty stops blank lines collecting at the top', () => {
  assert.equal(sortLines('b\n\na', { order: 'asc' }), '\na\nb');
  assert.equal(sortLines('b\n\na', { order: 'asc', removeEmpty: true }), 'a\nb');
});

/** Thirty lines: two seeds landing on the same permutation is not a real risk. */
const SHUFFLE_INPUT = Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n');

test('sortLines: a seeded shuffle repeats exactly', () => {
  const first = sortLines(SHUFFLE_INPUT, { order: 'shuffle', seed: 42 });
  const second = sortLines(SHUFFLE_INPUT, { order: 'shuffle', seed: 42 });
  assert.equal(first, second);
  // A shuffle must keep every line, not just look different.
  assert.deepEqual(first.split('\n').sort(), SHUFFLE_INPUT.split('\n').sort());
  assert.notEqual(first, SHUFFLE_INPUT);
});

test('sortLines: different seeds shuffle differently', () => {
  const a = sortLines(SHUFFLE_INPUT, { order: 'shuffle', seed: 1 });
  const b = sortLines(SHUFFLE_INPUT, { order: 'shuffle', seed: 2 });
  assert.notEqual(a, b);
});

test('sortLines: an unseeded shuffle still keeps every line', () => {
  const out = sortLines(SHUFFLE_INPUT, { order: 'shuffle' });
  assert.deepEqual(out.split('\n').sort(), SHUFFLE_INPUT.split('\n').sort());
});

test('removeWhitespace: trim, collapse and blank-line modes', () => {
  assert.equal(removeWhitespace('  a  \n\tb\t\nc', { mode: 'trim-lines' }), 'a\nb\nc');
  assert.equal(
    removeWhitespace('a    b\tc  \nd', { mode: 'collapse-spaces' }),
    'a b c \nd',
  );
  assert.equal(removeWhitespace('a\n\nb\n   \nc', { mode: 'remove-blank-lines' }), 'a\nb\nc');
});

test('removeWhitespace: remove-all deliberately loses the line structure', () => {
  const out = removeWhitespace('a b\r\n c\td', { mode: 'remove-all' });
  assert.equal(out, 'abcd');
  assert.equal(/\s/u.test(out), false);
});

test('removeWhitespace: tabs and spaces round-trip at tabWidth 4', () => {
  const tabbed = '\tfoo\n\t\tbar\n\t\t\tbaz\nplain';
  const spaced = removeWhitespace(tabbed, { mode: 'tabs-to-spaces', tabWidth: 4 });
  assert.equal(spaced, '    foo\n        bar\n            baz\nplain');
  assert.equal(removeWhitespace(spaced, { mode: 'spaces-to-tabs', tabWidth: 4 }), tabbed);
});

test('removeWhitespace: tab expansion honours the tab stop, not the character', () => {
  // `ab` occupies columns 0-1, so the tab fills the two columns up to stop 4.
  assert.equal(removeWhitespace('ab\tc', { mode: 'tabs-to-spaces', tabWidth: 4 }), 'ab  c');
  assert.equal(removeWhitespace('abcd\te', { mode: 'tabs-to-spaces', tabWidth: 4 }), 'abcd    e');
  // A partial indent keeps its leftover spaces instead of over-tabbing.
  assert.equal(removeWhitespace('      x', { mode: 'spaces-to-tabs', tabWidth: 4 }), '\t  x');
  // Degenerate widths are clamped rather than dividing by zero.
  assert.equal(removeWhitespace('\tx', { mode: 'tabs-to-spaces', tabWidth: 0 }), ' x');
});

test('removeWhitespace: normalise trims, squeezes runs and thins blank runs', () => {
  const input = 'Hello   world  \n\n\n\nSecond   part\n\nkept';
  // Four blank lines collapse to one; the deliberate single blank survives.
  assert.equal(removeWhitespace(input, { mode: 'normalise' }), 'Hello world\n\nSecond part\n\nkept');
  assert.equal(removeWhitespace('  a\t\tb  ', { mode: 'normalise' }), 'a b');
  assert.equal(removeWhitespace('a\n\nb', { mode: 'normalise' }), 'a\n\nb');
});

test('numberLines: padding is as wide as the largest number and no wider', () => {
  const input = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join('\n');
  const padded = numberLines(input, { padded: true }).split('\n');
  assert.equal(padded[0], ' 1. line 1');
  assert.equal(padded[8], ' 9. line 9');
  assert.equal(padded[9], '10. line 10');
  assert.equal(padded[10], '11. line 11');
  for (const line of padded) assert.equal(line.slice(0, 4).length, 4);
  // Unpadded numbers are exactly as long as they need to be.
  assert.equal(numberLines(input, {}).split('\n')[0], '1. line 1');
});

test('numberLines: start, separator and skipEmpty', () => {
  assert.equal(numberLines('a\nb', { start: 100, separator: ' | ' }), '100 | a\n101 | b');
  assert.equal(numberLines('a\n\nb', { skipEmpty: true }), '1. a\n\n2. b');
  assert.equal(numberLines('a\n\nb', {}), '1. a\n2. \n3. b');
  // A start of 8 with three lines needs two columns, so 8 and 9 get padded.
  assert.equal(numberLines('a\nb\nc', { start: 8, padded: true }), ' 8. a\n 9. b\n10. c');
  assert.equal(numberLines('', {}), '');
});

test('addPrefixSuffix: wraps every line, or every non-blank one', () => {
  assert.equal(addPrefixSuffix('a\nb', { prefix: '- ', suffix: ';' }), '- a;\n- b;');
  assert.equal(addPrefixSuffix('a\n\nb', { prefix: '> ', skipEmpty: true }), '> a\n\n> b');
  assert.equal(addPrefixSuffix('a\n\nb', { prefix: '> ' }), '> a\n> \n> b');
  assert.equal(addPrefixSuffix('a\nb', {}), 'a\nb');
  assert.equal(addPrefixSuffix('', { prefix: '> ' }), '');
});

test('repeatText: the memory guard fires before anything is built', () => {
  const tooBig = repeatText('hello world!', { times: 1_000_000 });
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.ok ? '' : tooBig.error, /12,000,000 characters/);
  assert.match(tooBig.ok ? '' : tooBig.error, /fewer copies/);

  // 5,000,000 exactly is allowed; one character more is not.
  assert.equal(repeatText('a'.repeat(1000), { times: 5000 }).ok, true);
  assert.equal(repeatText('a'.repeat(1000), { times: 5001 }).ok, false);
});

test('repeatText: rejects counts below one and non-integers', () => {
  for (const times of [0, -1, -100]) {
    const result = repeatText('a', { times });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /at least 1 copy/);
  }
  for (const times of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = repeatText('a', { times });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /whole number/);
  }
});

test('repeatText: separators, numbering and the default of one copy per line', () => {
  assert.equal(repeated('ab', 3), 'ab\nab\nab');
  assert.equal(repeated('ab', 3, ''), 'ababab');
  assert.equal(repeated('ab', 2, ', '), 'ab, ab');
  assert.equal(repeated('ab', 1), 'ab');
  const numbered = repeatText('ab', { times: 3, numbered: true });
  assert.equal(numbered.ok && numbered.result, '1. ab\n2. ab\n3. ab');
});

test('countLines: totals, non-blank lines and distinct lines', () => {
  assert.deepEqual(countLines('a\nb\na'), { total: 3, nonEmpty: 3, unique: 2 });
  assert.deepEqual(countLines('a\n\n  \nb'), { total: 4, nonEmpty: 2, unique: 4 });
  assert.deepEqual(countLines(''), { total: 0, nonEmpty: 0, unique: 0 });
  assert.deepEqual(countLines('one line'), { total: 1, nonEmpty: 1, unique: 1 });
  // A trailing newline really is a second, empty line.
  assert.deepEqual(countLines('a\n'), { total: 2, nonEmpty: 1, unique: 2 });
  assert.deepEqual(countLines('a\r\nb'), { total: 2, nonEmpty: 2, unique: 2 });
});

/** Every LF must be half of a CRLF, and at least one CRLF must have survived. */
function assertCrlfOnly(label: string, output: string): void {
  for (let i = 0; i < output.length; i += 1) {
    if (output[i] !== '\n') continue;
    assert.equal(output[i - 1], '\r', `${label}: bare LF at index ${i} of ${JSON.stringify(output)}`);
  }
  assert.ok(output.includes('\r\n'), `${label}: lost every CRLF (${JSON.stringify(output)})`);
}

const CRLF_INPUT = '  beta\t\t2  \r\n\r\n\r\n\r\nalpha 10\r\n\tbeta\t\t2  \r\nalpha 1\r\n';

test('CRLF survives every function that returns text', () => {
  assert.equal(detectLineEnding(CRLF_INPUT), '\r\n');

  for (const keep of ['first', 'last'] as const) {
    assertCrlfOnly(`dedupe ${keep}`, dedupeLines(CRLF_INPUT, { keep }).result);
  }
  assertCrlfOnly('dedupe trimmed', dedupeLines(CRLF_INPUT, { trimBeforeCompare: true }).result);

  const orders = [
    'asc',
    'desc',
    'length-asc',
    'length-desc',
    'natural',
    'reverse',
    'shuffle',
  ] as const;
  for (const order of orders) {
    assertCrlfOnly(`sort ${order}`, sortLines(CRLF_INPUT, { order, seed: 7 }));
  }

  const modes: WhitespaceMode[] = [
    'trim-lines',
    'collapse-spaces',
    'remove-blank-lines',
    'tabs-to-spaces',
    'spaces-to-tabs',
    'normalise',
  ];
  for (const mode of modes) {
    assertCrlfOnly(`whitespace ${mode}`, removeWhitespace(CRLF_INPUT, { mode, tabWidth: 4 }));
  }
  // The one exception, and it is by design: no line endings are left to keep.
  assert.equal(/[\r\n]/u.test(removeWhitespace(CRLF_INPUT, { mode: 'remove-all' })), false);

  assertCrlfOnly('numberLines', numberLines(CRLF_INPUT, { padded: true }));
  assertCrlfOnly('addPrefixSuffix', addPrefixSuffix(CRLF_INPUT, { prefix: '> ', suffix: ' <' }));
  assertCrlfOnly('repeatText', repeated(CRLF_INPUT, 2));
  // A separator written with LF is rewritten to match the input.
  assertCrlfOnly('repeatText separator', repeated('a\r\nb', 2, '\n---\n'));
  assert.equal(repeated('a\r\nb', 2, '\n---\n'), 'a\r\nb\r\n---\r\na\r\nb');
});

