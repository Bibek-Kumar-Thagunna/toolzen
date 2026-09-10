import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLorem, LOREM_WORDS } from './lorem.ts';
import type { LoremOptions } from './lorem.ts';

/** Unwraps a result that is expected to succeed, failing the test if it did not. */
function text(opts: LoremOptions): string {
  const result = generateLorem(opts);
  assert.equal(result.ok, true, `expected text, got ${JSON.stringify(result)}`);
  return result.ok ? result.text : '';
}

/** Sentences are the only thing a `.` can end, so this is an exact count. */
function sentenceCount(paragraph: string): number {
  return paragraph.split('.').length - 1;
}

function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/u).length;
}

test('LOREM_WORDS: enough distinct words to not read as a loop', () => {
  assert.ok(LOREM_WORDS.length >= 90, `only ${LOREM_WORDS.length} words`);
  assert.equal(new Set(LOREM_WORDS).size, LOREM_WORDS.length, 'duplicate word in the list');
  for (const word of LOREM_WORDS) assert.match(word, /^[a-z]+$/u);
});

test('generateLorem: a seed makes the output reproducible', () => {
  for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
    const first = text({ unit, count: 6, seed: 2026 });
    const second = text({ unit, count: 6, seed: 2026 });
    assert.equal(first, second, `${unit} was not reproducible`);
    // A different seed has to actually change something.
    assert.notEqual(first, text({ unit, count: 6, seed: 2027 }), `${unit} ignored its seed`);
  }
});

test('generateLorem: no seed still produces valid text', () => {
  const output = text({ unit: 'paragraphs', count: 2 });
  assert.equal(output.split('\n\n').length, 2);
  assert.ok(output.length > 0);
});

test('generateLorem: count is held to 1..500', () => {
  for (const count of [0, -1, 501, 1000, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = generateLorem({ unit: 'words', count });
    assert.equal(result.ok, false, `count ${count} should have been refused`);
    assert.match(result.ok ? '' : result.error, /between 1 and 500 words/);
  }
  // Both ends of the range are allowed.
  assert.equal(wordCount(text({ unit: 'words', count: 1, seed: 1 })), 1);
  assert.equal(wordCount(text({ unit: 'words', count: 500, seed: 1 })), 500);
  assert.equal(sentenceCount(text({ unit: 'sentences', count: 500, seed: 1 })), 500);
});

test('generateLorem: an unknown unit is refused rather than guessed at', () => {
  // Units arrive from a URL query string, so the runtime check has to be real.
  const fromTheWire = { unit: 'pages', count: 3 } as unknown as LoremOptions;
  const result = generateLorem(fromTheWire);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /words, sentences or paragraphs/);
});

const OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

test('generateLorem: startWithLorem opens with the canonical wording', () => {
  for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
    // The opening is eight words long, so a four-word request cannot hold it.
    const count = unit === 'words' ? 10 : 4;
    for (let seed = 0; seed < 25; seed += 1) {
      const output = text({ unit, count, seed, startWithLorem: true });
      assert.ok(
        output.startsWith(OPENING),
        `${unit} seed ${seed} began ${JSON.stringify(output.slice(0, 70))}`,
      );
    }
  }
  // The first sentence ends normally, so the opening is a prefix and not the whole line.
  assert.equal(text({ unit: 'words', count: 8, seed: 5, startWithLorem: true }), OPENING);
  // Without the flag, the canonical opening is not forced on the output.
  const free = Array.from({ length: 30 }, (_, seed) =>
    text({ unit: 'sentences', count: 1, seed }));
  assert.ok(free.some((line) => !line.startsWith('Lorem ipsum')));
});

test('generateLorem: a short word count trims the opening without stranding a comma', () => {
  assert.equal(text({ unit: 'words', count: 1, seed: 4, startWithLorem: true }), 'Lorem');
  assert.equal(text({ unit: 'words', count: 3, seed: 4, startWithLorem: true }), 'Lorem ipsum dolor');
  assert.equal(
    text({ unit: 'words', count: 5, seed: 4, startWithLorem: true }),
    'Lorem ipsum dolor sit amet',
  );
  assert.equal(
    text({ unit: 'words', count: 6, seed: 4, startWithLorem: true }),
    'Lorem ipsum dolor sit amet, consectetur',
  );
});

test('generateLorem: every paragraph holds 3 to 7 sentences', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const paragraphs = text({ unit: 'paragraphs', count: 5, seed }).split('\n\n');
    assert.equal(paragraphs.length, 5);
    for (const paragraph of paragraphs) {
      const count = sentenceCount(paragraph);
      assert.ok(count >= 3 && count <= 7, `seed ${seed}: ${count} sentences in ${paragraph}`);
    }
  }
});

test('generateLorem: every sentence holds 6 to 16 words and is capitalised', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    const body = text({ unit: 'sentences', count: 12, seed, startWithLorem: seed % 2 === 0 });
    const sentences = body.split('. ');
    assert.equal(sentences.length, 12);
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      assert.ok(words >= 6 && words <= 16, `seed ${seed}: ${words} words in "${sentence}"`);
      assert.match(sentence, /^[A-Z]/u);
    }
    assert.ok(body.endsWith('.'));
  }
});

test('generateLorem: 200 paragraphs contain no stranded or doubled commas', () => {
  let paragraphs = 0;
  for (let seed = 0; seed < 40; seed += 1) {
    const output = text({ unit: 'paragraphs', count: 5, seed, startWithLorem: seed % 2 === 0 });
    assert.equal(output.includes(',.'), false, `seed ${seed} produced ",."`);
    assert.equal(output.includes(',,'), false, `seed ${seed} produced ",,"`);
    assert.equal(output.includes(' ,'), false, `seed ${seed} produced " ,"`);
    assert.equal(output.includes(',,'), false);
    // A comma is always followed by a space and then a word.
    assert.equal(/,(?![ ])/u.test(output), false, `seed ${seed} produced a comma with no space`);
    assert.equal(/\.\S/u.test(output), false, `seed ${seed} produced a full stop with no space`);
    paragraphs += output.split('\n\n').length;
  }
  assert.equal(paragraphs, 200);
});

test('generateLorem: html wraps paragraphs, plain text separates them by a blank line', () => {
  const plain = text({ unit: 'paragraphs', count: 3, seed: 11 });
  const markup = text({ unit: 'paragraphs', count: 3, seed: 11, html: true });
  assert.equal(plain.split('\n\n').length, 3);
  assert.equal(markup.split('\n').length, 3);
  assert.equal(markup.startsWith('<p>'), true);
  assert.equal(markup.endsWith('</p>'), true);
  assert.equal(markup.match(/<p>/gu)?.length, 3);
  // The same text, only wrapped.
  assert.equal(markup, plain.split('\n\n').map((p) => `<p>${p}</p>`).join('\n'));
  // Words and sentences are one paragraph as far as the markup is concerned.
  assert.match(text({ unit: 'words', count: 5, seed: 1, html: true }), /^<p>[^<]+<\/p>$/u);
  assert.match(text({ unit: 'sentences', count: 2, seed: 1, html: true }), /^<p>[^<]+<\/p>$/u);
});

