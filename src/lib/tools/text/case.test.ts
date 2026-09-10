import test from 'node:test';
import assert from 'node:assert/strict';

import { CASE_LABELS, CASE_MODES, convertCase, splitWords } from './case.ts';
import type { CaseMode } from './case.ts';

/** The six modes that flatten their input to a single identifier. */
const IDENTIFIER_MODES: readonly CaseMode[] = [
  'camel', 'pascal', 'snake', 'constant', 'kebab', 'dot',
];

test('splitWords: the required boundaries', () => {
  assert.deepEqual(splitWords('parseHTMLDocument'), ['parse', 'HTML', 'Document']);
  assert.deepEqual(splitWords('getURLPath'), ['get', 'URL', 'Path']);
  assert.deepEqual(splitWords('user2Name'), ['user', '2', 'Name']);
  assert.deepEqual(splitWords('--foo__bar.baz--'), ['foo', 'bar', 'baz']);
});

test('splitWords: every separator, and none of them left behind', () => {
  const expected = ['foo', 'bar'];
  for (const joined of ['foo bar', 'foo_bar', 'foo-bar', 'foo.bar', 'foo/bar', 'foo:bar']) {
    assert.deepEqual(splitWords(joined), expected, joined);
  }
  assert.deepEqual(splitWords('foo \t\n bar'), expected, 'runs of whitespace collapse');
  assert.deepEqual(splitWords('  foo  bar  '), expected, 'edges are trimmed');
  assert.deepEqual(splitWords(''), []);
  assert.deepEqual(splitWords('---'), [], 'punctuation alone is no word at all');
  assert.deepEqual(splitWords('HTML'), ['HTML'], 'an acronym run stays whole');
  assert.deepEqual(splitWords('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepEqual(splitWords('iOS'), ['i', 'OS']);
  assert.deepEqual(splitWords('v1.2.3'), ['v', '1', '2', '3']);
  assert.deepEqual(splitWords('2fast2furious'), ['2', 'fast', '2', 'furious']);
});

test('title: minor words stay down unless they are first or last', () => {
  assert.equal(
    convertCase('the quick brown fox jumps over the lazy dog', 'title'),
    'The Quick Brown Fox Jumps Over the Lazy Dog',
  );
  assert.equal(convertCase('a tale of two cities', 'title'), 'A Tale of Two Cities');
  assert.equal(
    convertCase('what are you waiting for', 'title'),
    'What Are You Waiting For',
    'a minor word in last position is still capitalised',
  );
  assert.equal(convertCase('to the moon', 'title'), 'To the Moon');
});

test('title: existing acronyms survive, and shouting is not mistaken for one', () => {
  assert.equal(convertCase('NASA and the API', 'title'), 'NASA and the API');
  assert.equal(convertCase('using the API for fun', 'title'), 'Using the API for Fun');
  assert.equal(convertCase('(NASA) rocks', 'title'), '(NASA) Rocks');
  assert.equal(
    convertCase('MY GREAT ARTICLE TITLE', 'title'),
    'My Great Article Title',
    'no lowercase anywhere means shouting, so nothing is treated as an acronym',
  );
});

test('title: hyphenated compounds are one word, and dashes are not words', () => {
  assert.equal(convertCase('a well-known fact', 'title'), 'A Well-known Fact');
  assert.equal(
    convertCase('— hello world —', 'title'),
    '— Hello World —',
    'the dashes are skipped, so hello and world are first and last',
  );
});

test('text modes keep the line structure and the line ending style', () => {
  const crlf = 'one\r\ntwo\r\nthree';

  const upper = convertCase(crlf, 'upper');
  assert.equal(upper, 'ONE\r\nTWO\r\nTHREE');
  assert.equal(upper.split('\r\n').length, 3, 'three lines in, three lines out');
  assert.ok(upper.includes('\r\n'), 'CR LF survived');
  assert.equal(upper.split('\n').length, 3, 'and no extra bare LF appeared');

  assert.equal(convertCase(crlf, 'title'), 'One\r\nTwo\r\nThree');
  assert.equal(convertCase('MIXED\nendings\r\nhere\rtoo', 'lower'), 'mixed\nendings\r\nhere\rtoo');
  assert.equal(
    convertCase('first line.\r\n\r\nthird line.', 'sentence'),
    'First line.\r\n\r\nThird line.',
    'blank lines are preserved too',
  );
});

test('identifier modes flatten the input, by design', () => {
  assert.equal(convertCase('foo\nbar', 'snake'), 'foo_bar');
  assert.equal(convertCase('one two three', 'camel'), 'oneTwoThree');
  assert.equal(convertCase('one two three', 'pascal'), 'OneTwoThree');
  assert.equal(convertCase('one two three', 'constant'), 'ONE_TWO_THREE');
  assert.equal(convertCase('one two three', 'kebab'), 'one-two-three');
  assert.equal(convertCase('one two three', 'dot'), 'one.two.three');
  assert.equal(convertCase('parseHTMLDocument', 'camel'), 'parseHTMLDocument');
  assert.equal(convertCase('parseHTMLDocument', 'snake'), 'parse_html_document');
  assert.equal(convertCase('getURLPath', 'constant'), 'GET_URL_PATH');
  assert.equal(convertCase('--foo__bar.baz--', 'kebab'), 'foo-bar-baz');
  for (const mode of IDENTIFIER_MODES) {
    assert.equal(convertCase('', mode), '', mode);
    assert.equal(convertCase('   ...   ', mode), '', mode);
  }
});

/** Deliberately awkward: acronym runs, digits, empties, mixed separators. */
const VARIED_INPUTS: readonly string[] = [
  'hello world', 'Hello World', 'HELLO WORLD', 'parseHTMLDocument', 'getURLPath',
  'user2Name', '--foo__bar.baz--', 'foo_bar_baz', 'FOO_BAR_BAZ', 'foo-bar-baz',
  'foo.bar.baz', 'fooBarBaz', 'FooBarBaz', 'XMLHttpRequest', 'iOS app',
  'v1.2.3', 'a', 'A', '1', '', '   ', '...', "don't stop", 'well-known fact',
  'The Quick Brown Fox', 'snake_case and kebab-case', 'user/name:field', 'HTML',
  '2fast2furious', 'trailing   spaces   ', 'multi\nline\ninput', 'CRLF\r\nlines',
  'mixed_UP-camelCase.here', 'ABCdef', 'a1b2c3',
];

test('identifier modes are idempotent across varied inputs', () => {
  assert.ok(VARIED_INPUTS.length >= 30, 'the requirement is at least 30 inputs');
  for (const mode of IDENTIFIER_MODES) {
    for (const input of VARIED_INPUTS) {
      const once = convertCase(input, mode);
      const twice = convertCase(once, mode);
      assert.equal(twice, once, `${mode} is not idempotent for ${JSON.stringify(input)}`);
    }
  }
});

test('alternating: the phase advances on letters only', () => {
  assert.equal(
    convertCase('ab cd', 'alternating'),
    'aB cD',
    'the space must not flip the phase, or this would be aB Cd',
  );
  assert.equal(convertCase('hello world', 'alternating'), 'hElLo WoRlD');
  assert.equal(convertCase('a-b-c', 'alternating'), 'a-B-c');
  assert.equal(convertCase('a1b2c', 'alternating'), 'a1B2c', 'digits do not flip it either');
  assert.equal(convertCase('AB CD', 'alternating'), 'aB cD', 'the phase starts lowercase');
  assert.equal(convertCase('...', 'alternating'), '...');
});

test('inverse swaps letters and leaves everything else alone', () => {
  assert.equal(convertCase('Hello World', 'inverse'), 'hELLO wORLD');
  assert.equal(convertCase('aB1! cD?', 'inverse'), 'Ab1! Cd?');
  assert.equal(convertCase('', 'inverse'), '');
});

test('sentence: lowercase, then one capital per sentence from sentences.ts', () => {
  assert.equal(
    convertCase('dr. smith went home. HE slept.', 'sentence'),
    'Dr. smith went home. He slept.',
    'Dr. is an abbreviation, so smith does not start a sentence',
  );
  assert.equal(
    convertCase('IT COST 3.14 DOLLARS. REALLY!', 'sentence'),
    'It cost 3.14 dollars. Really!',
    'a decimal point is not a full stop',
  );
  assert.equal(
    convertCase('"hello there. bye"', 'sentence'),
    '"Hello there. Bye"',
    'the capital goes on the first letter, not the quote',
  );
  assert.equal(convertCase('', 'sentence'), '');
  assert.equal(convertCase('   ', 'sentence'), '   ');
  assert.equal(convertCase('...', 'sentence'), '...', 'nothing to capitalise, nothing lost');
});

test('lower and upper are exactly that', () => {
  assert.equal(convertCase('Hello World', 'lower'), 'hello world');
  assert.equal(convertCase('Hello World', 'upper'), 'HELLO WORLD');
});

test('an unrecognised mode returns the input untouched', () => {
  // Modes arrive from URLs, so this is a real path, not a hypothetical one.
  assert.equal(convertCase('Hello World', 'bogus' as CaseMode), 'Hello World');
});

test('CASE_MODES and CASE_LABELS agree, and every example is non-empty', () => {
  assert.equal(CASE_MODES.length, 12);
  assert.equal(new Set(CASE_MODES).size, 12, 'no duplicate modes');
  assert.deepEqual(Object.keys(CASE_LABELS).sort(), [...CASE_MODES].sort());

  for (const mode of CASE_MODES) {
    const entry = CASE_LABELS[mode];
    assert.ok(entry.label.length > 0, `${mode} has no label`);
    assert.ok(entry.example.length > 0, `${mode} has no example`);
  }
});

test('CASE_LABELS examples are what the converter actually produces', () => {
  assert.equal(CASE_LABELS.lower.example, 'hello world');
  assert.equal(CASE_LABELS.upper.example, 'HELLO WORLD');
  assert.equal(CASE_LABELS.title.example, 'Hello World');
  assert.equal(CASE_LABELS.sentence.example, 'Hello world');
  assert.equal(CASE_LABELS.camel.example, 'helloWorld');
  assert.equal(CASE_LABELS.pascal.example, 'HelloWorld');
  assert.equal(CASE_LABELS.snake.example, 'hello_world');
  assert.equal(CASE_LABELS.constant.example, 'HELLO_WORLD');
  assert.equal(CASE_LABELS.kebab.example, 'hello-world');
  assert.equal(CASE_LABELS.dot.example, 'hello.world');
  assert.equal(CASE_LABELS.alternating.example, 'hElLo WoRlD');
  assert.equal(CASE_LABELS.inverse.example, 'hELLO wORLD');
});
