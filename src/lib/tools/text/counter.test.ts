import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeText } from './counter.ts';

/** A deterministic corpus for the size test: fixed vocabulary, fixed shape. */
function generateWords(count: number): string {
  const vocabulary = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo',
    'foxtrot', 'golf', 'hotel', 'india', 'juliet',
  ];
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const word = vocabulary[i % vocabulary.length];
    // A full stop every twelfth word, so sentence segmentation does real work.
    parts.push(i % 12 === 11 ? word + '.' : word);
  }
  return parts.join(' ');
}

test('empty input is zeros, an empty string and an empty array', () => {
  const stats = analyzeText('');
  assert.deepEqual(stats, {
    characters: 0,
    codePoints: 0,
    graphemes: 0,
    charactersNoSpaces: 0,
    words: 0,
    uniqueWords: 0,
    sentences: 0,
    paragraphs: 0,
    lines: 0,
    readingTimeSeconds: 0,
    speakingTimeSeconds: 0,
    longestWord: '',
    avgWordLength: 0,
    avgSentenceLength: 0,
    keywordDensity: [],
  });
});

test('whitespace only counts characters, and nothing that needs a word', () => {
  const stats = analyzeText('   \t  ');
  assert.equal(stats.characters, 6);
  assert.equal(stats.codePoints, 6);
  assert.equal(stats.graphemes, 6);
  assert.equal(stats.charactersNoSpaces, 0);
  assert.equal(stats.words, 0);
  assert.equal(stats.uniqueWords, 0);
  assert.equal(stats.sentences, 0);
  assert.equal(stats.paragraphs, 0);
  assert.equal(stats.longestWord, '');
  assert.equal(stats.avgWordLength, 0);
  assert.equal(stats.avgSentenceLength, 0);
  assert.deepEqual(stats.keywordDensity, []);
  // One blank line is still a line, the way a textarea shows it.
  assert.equal(stats.lines, 1);

  const blankLines = analyzeText('  \n\n  ');
  assert.equal(blankLines.words, 0);
  assert.equal(blankLines.paragraphs, 0);
  assert.equal(blankLines.lines, 3);
});

test('abbreviations and decimals do not end a sentence', () => {
  const stats = analyzeText('Dr. Smith went to Washington. He arrived at 3.14 p.m.');
  assert.equal(stats.sentences, 2);
  assert.equal(stats.words, 10);
  assert.equal(stats.characters, 53);
  assert.equal(stats.paragraphs, 1);
  assert.equal(stats.lines, 1);
  assert.equal(stats.longestWord, 'Washington');
  assert.equal(stats.avgSentenceLength, 5);
});

test('a word is a token stripped of edge punctuation, and a dash is not one', () => {
  // 'A well-known fact - don't stop - ever', with an em dash in the middle.
  const stats = analyzeText('A well-known fact — don\'t stop - ever');
  assert.equal(stats.words, 6, 'the em dash and the lone hyphen are not words');
  assert.equal(stats.uniqueWords, 6);
  assert.equal(stats.longestWord, 'well-known', 'a hyphenated compound is one word');
  assert.equal(stats.avgWordLength, 4.67);
  assert.equal(stats.sentences, 1, 'no terminator still means one sentence');

  // A typographic apostrophe is interior punctuation too.
  assert.equal(analyzeText('don’t').words, 1);
  assert.equal(analyzeText('(parenthesised) "quoted" …').words, 2);
  assert.equal(analyzeText('3.14 is 1 word').words, 4);
});

test('unique words ignore case, and the longest word ties to the first', () => {
  const stats = analyzeText('The the THE cat');
  assert.equal(stats.words, 4);
  assert.equal(stats.uniqueWords, 2);
  assert.equal(analyzeText('aaa bbb').longestWord, 'aaa');
});

test('paragraphs are runs of content between blank lines', () => {
  assert.equal(analyzeText('one\ntwo').paragraphs, 1, 'no blank line is one paragraph');
  assert.equal(analyzeText('one\n\ntwo').paragraphs, 2);
  assert.equal(analyzeText('one\n\n\n\ntwo').paragraphs, 2, 'blank runs collapse');
  assert.equal(analyzeText('one\n \t \ntwo').paragraphs, 2, 'a space-only line is blank');
  assert.equal(analyzeText('only').paragraphs, 1);
  assert.equal(analyzeText('trailing\n\n').paragraphs, 1);
  assert.equal(analyzeText('\n\nleading').paragraphs, 1);
  assert.equal(analyzeText('').paragraphs, 0);
});

test('CRLF counts as one line break, and so does a lone CR', () => {
  const crlf = analyzeText('one\r\ntwo\r\nthree');
  assert.equal(crlf.lines, 3, 'CR LF is one break, not two');
  assert.equal(crlf.words, 3);
  assert.equal(crlf.paragraphs, 1);
  assert.equal(crlf.characters, 15, 'both halves of each CR LF count as characters');
  assert.equal(crlf.charactersNoSpaces, 11);

  assert.equal(analyzeText('a\r\n\r\nb').lines, 3);
  assert.equal(analyzeText('a\r\n\r\nb').paragraphs, 2);
  assert.equal(analyzeText('a\rb').lines, 2, 'a classic Mac line ending');
  assert.equal(analyzeText('a\nb\nc').lines, 3);
  assert.equal(analyzeText('a\n').lines, 2, 'a trailing break opens a new line');
  assert.equal(analyzeText('a').lines, 1);
});

test('characters, code points and graphemes are three different numbers', () => {
  // A thumbs-up with a skin tone, a space, then a precomposed e-acute.
  const stats = analyzeText('👍🏽 café');
  assert.equal(stats.characters, 9, 'UTF-16 units: two surrogate pairs plus five');
  assert.equal(stats.codePoints, 7, 'thumbs-up + modifier + space + c a f e-acute');
  assert.equal(stats.graphemes, 6, 'the modifier joins the thumbs-up');
  assert.equal(stats.charactersNoSpaces, 8);
  assert.equal(stats.words, 1, 'an emoji on its own is not a word');

  const emoji = analyzeText('👍🏽');
  assert.equal(emoji.characters, 4);
  assert.equal(emoji.codePoints, 2);
  assert.equal(emoji.graphemes, 1);

  // Decomposed: the four ASCII letters of 'cafe' plus U+0301 COMBINING ACUTE
  // ACCENT. Five code points, four things a reader sees.
  const decomposed = analyzeText('café');
  assert.equal(decomposed.characters, 5);
  assert.equal(decomposed.codePoints, 5);
  assert.equal(decomposed.graphemes, 4);

  const ascii = analyzeText('abc def');
  assert.equal(ascii.characters, 7);
  assert.equal(ascii.codePoints, 7);
  assert.equal(ascii.graphemes, 7);
});

test('keyword density skips stop words and short words, and is a share of all words', () => {
  const stats = analyzeText('The engine engine engine of a rocket and the rocket fuel');
  assert.equal(stats.words, 11);
  assert.deepEqual(stats.keywordDensity, [
    { word: 'engine', count: 3, percent: 27.27 },
    { word: 'rocket', count: 2, percent: 18.18 },
    { word: 'fuel', count: 1, percent: 9.09 },
  ]);
});

test('keyword density is deterministic: ties are alphabetical, order is irrelevant', () => {
  const expected = [
    { word: 'alpha', count: 2, percent: 33.33 },
    { word: 'bravo', count: 2, percent: 33.33 },
    { word: 'charlie', count: 2, percent: 33.33 },
  ];
  assert.deepEqual(analyzeText('charlie bravo alpha charlie bravo alpha').keywordDensity, expected);
  assert.deepEqual(analyzeText('alpha bravo charlie alpha bravo charlie').keywordDensity, expected);
  assert.deepEqual(analyzeText('bravo charlie alpha alpha charlie bravo').keywordDensity, expected);
});

test('keyword density reports at most ten entries, most frequent first', () => {
  const vocabulary = [
    'aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff',
    'ggg', 'hhh', 'iii', 'jjj', 'kkk', 'lll',
  ];
  const parts: string[] = [];
  vocabulary.forEach((word, index) => {
    for (let n = vocabulary.length - index; n > 0; n -= 1) parts.push(word);
  });
  const density = analyzeText(parts.join(' ')).keywordDensity;

  assert.equal(density.length, 10);
  assert.deepEqual(
    density.map((entry) => entry.word),
    ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh', 'iii', 'jjj'],
  );
  assert.equal(density[0].count, 12);
  assert.equal(density[9].count, 3);
});

test('reading and speaking times use 238 and 140 words per minute', () => {
  const parts: string[] = [];
  for (let i = 0; i < 238; i += 1) parts.push('word' + i);
  const stats = analyzeText(parts.join(' '));

  assert.equal(stats.words, 238);
  assert.equal(stats.readingTimeSeconds, 60, '238 words is a minute of reading');
  assert.equal(stats.speakingTimeSeconds, 102, 'and 1.7 minutes of speaking');
  assert.equal(analyzeText('one two three').readingTimeSeconds, 1);
});

test('a 200k-word document is analysed in well under two seconds', () => {
  const input = generateWords(200000);
  assert.ok(input.length > 1_000_000, 'sanity check: the corpus really is large');

  const started = performance.now();
  const stats = analyzeText(input);
  const elapsed = performance.now() - started;

  // Assert the work actually happened, so a future short-circuit cannot pass
  // this test by doing nothing quickly.
  assert.equal(stats.words, 200000);
  assert.equal(stats.uniqueWords, 10);
  assert.equal(stats.sentences, 16667);
  assert.equal(stats.paragraphs, 1);
  assert.equal(stats.keywordDensity.length, 10);
  assert.equal(stats.keywordDensity[0].count, 20000);

  assert.ok(elapsed < 2000, `analyzeText took ${elapsed.toFixed(0)}ms`);
});
