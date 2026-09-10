/**
 * Lorem Ipsum generation.
 *
 * The vocabulary is the classical Cicero passage plus the words the
 * nineteenth-century printers' version added, so the output looks like the
 * placeholder text people expect rather than like Latin-flavoured noise.
 *
 * Punctuation is generated under two hard rules — a comma never sits within one
 * word of the full stop, and two commas never touch — which is what keeps the
 * output free of the `,.` and `,,` that give cheap generators away.
 */

import { pick, randomInt, rngFromSeed } from './random.ts';
import type { Rng } from './random.ts';

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';

export interface LoremOptions {
  unit: LoremUnit;
  /** 1..500. Anything else comes back as an error, not an exception. */
  count: number;
  /** Opens with the canonical `Lorem ipsum dolor sit amet, …`. */
  startWithLorem?: boolean;
  /** Makes the output reproducible. Without one, `crypto` is used. */
  seed?: number;
  /** Wraps each paragraph in `<p>` tags. */
  html?: boolean;
}

export type LoremResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_COUNT = 500;
const MIN_WORDS_PER_SENTENCE = 6;
const MAX_WORDS_PER_SENTENCE = 16;
const MIN_SENTENCES_PER_PARAGRAPH = 3;
const MAX_SENTENCES_PER_PARAGRAPH = 7;

/** The opening everyone recognises, word for word. */
const OPENING: readonly string[] = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
];

/** The word the canonical comma follows, by index into {@link OPENING}. */
const OPENING_COMMA_AFTER = 4;

/**
 * The vocabulary. Exported so a test can assert it stays distinct: the
 * no-stutter rule in {@link buildWords} finds a word's neighbour by index, and
 * a duplicate entry would make that lookup pick the wrong one.
 */
export const LOREM_WORDS: readonly string[] = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
  'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore',
  'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis',
  'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex',
  'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
  'voluptate', 'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur',
  'excepteur', 'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt',
  'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id', 'est',
  'laborum', 'perspiciatis', 'unde', 'omnis', 'iste', 'natus', 'error',
  'voluptatem', 'accusantium', 'doloremque', 'laudantium', 'totam', 'rem',
  'aperiam', 'eaque', 'quae', 'ab', 'illo', 'inventore', 'veritatis', 'quasi',
  'architecto', 'beatae', 'vitae', 'dicta', 'explicabo', 'nemo', 'ipsam',
  'quia', 'voluptas', 'aspernatur', 'odit', 'aut', 'fugit', 'sequi',
  'nesciunt', 'neque', 'porro', 'quisquam', 'dolorem', 'adipisci', 'numquam',
  'eius', 'modi', 'tempora', 'incidunt', 'magnam', 'quaerat', 'etiam', 'vel',
  'illum', 'iure', 'dolores', 'nihil', 'molestiae', 'harum', 'quidem',
  'rerum', 'facilis', 'expedita', 'distinctio', 'nam', 'libero', 'tempore',
  'cumque', 'soluta', 'nobis', 'eligendi', 'optio', 'minus', 'quod', 'maxime',
  'placeat', 'facere', 'possimus', 'assumenda', 'repellendus', 'temporibus',
  'autem', 'quibusdam', 'officiis', 'debitis', 'saepe', 'eveniet',
  'voluptates', 'repudiandae', 'recusandae', 'itaque',
];

interface Draft {
  words: string[];
  /** Indices whose word is followed by a comma. */
  commas: Set<number>;
}

function renderDraft(draft: Draft): string {
  return draft.words
    .map((word, i) => {
      const text = i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
      return draft.commas.has(i) ? `${text},` : text;
    })
    .join(' ');
}

/**
 * `count` words with no two identical words in a row: real prose does not
 * stutter, and a repeat is the first thing the eye catches in placeholder text.
 * A collision steps to the next word in the list rather than re-rolling, so the
 * number of draws from `rng` stays fixed and the output stays reproducible.
 */
function buildWords(rng: Rng, count: number, previous?: string): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let word = pick(rng, LOREM_WORDS);
    if (word === (i === 0 ? previous : words[i - 1])) {
      word = LOREM_WORDS[(LOREM_WORDS.indexOf(word) + 1) % LOREM_WORDS.length];
    }
    words.push(word);
  }
  return words;
}

/**
 * Comma positions for a sentence of `wordCount` words.
 *
 * The last candidate is `wordCount - 3`, which leaves two words after any comma
 * and so makes `,.` impossible. Placing one skips the next candidate, which
 * makes `,,` impossible. Both properties hold for every seed.
 */
function placeCommas(rng: Rng, wordCount: number, quota: number): Set<number> {
  const commas = new Set<number>();
  const last = wordCount - 3;
  let remaining = quota;
  for (let i = 1; i <= last && remaining > 0; i += 1) {
    if (rng() >= 0.22) continue;
    commas.add(i);
    remaining -= 1;
    i += 1;
  }
  return commas;
}

/**
 * One sentence, capitalised and full-stopped. The opening variant is the
 * canonical eight words plus up to six more, which keeps it inside the same
 * 6..16 word band as every other sentence.
 */
function makeSentence(rng: Rng, opening: boolean): string {
  if (opening) {
    const tail = buildWords(rng, randomInt(rng, 0, 7), OPENING[OPENING.length - 1]);
    const words = [...OPENING, ...tail];
    return `${renderDraft({ words, commas: new Set([OPENING_COMMA_AFTER]) })}.`;
  }
  const count = randomInt(rng, MIN_WORDS_PER_SENTENCE, MAX_WORDS_PER_SENTENCE + 1);
  const words = buildWords(rng, count);
  return `${renderDraft({ words, commas: placeCommas(rng, count, Math.floor(count / 6)) })}.`;
}

function makeParagraph(rng: Rng, opening: boolean): string {
  const count = randomInt(
    rng,
    MIN_SENTENCES_PER_PARAGRAPH,
    MAX_SENTENCES_PER_PARAGRAPH + 1,
  );
  const sentences: string[] = [];
  for (let i = 0; i < count; i += 1) sentences.push(makeSentence(rng, opening && i === 0));
  return sentences.join(' ');
}

/**
 * A bare run of words: no full stop, since the caller is going to drop it into
 * a heading or a label. The canonical comma is kept only while a word still
 * follows it, so a three-word request cannot end on punctuation.
 */
function makeWordRun(rng: Rng, count: number, opening: boolean): string {
  if (!opening) {
    return renderDraft({ words: buildWords(rng, count), commas: new Set() });
  }
  const head = OPENING.slice(0, count);
  const tail = buildWords(rng, count - head.length, head[head.length - 1]);
  const words = [...head, ...tail];
  const commas = new Set<number>();
  if (words.length > OPENING_COMMA_AFTER + 1) commas.add(OPENING_COMMA_AFTER);
  return renderDraft({ words, commas });
}

export function generateLorem(opts: LoremOptions): LoremResult {
  const { unit, count } = opts;
  if (unit !== 'words' && unit !== 'sentences' && unit !== 'paragraphs') {
    return { ok: false, error: 'Choose words, sentences or paragraphs.' };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return { ok: false, error: `Ask for between 1 and ${MAX_COUNT} ${unit}.` };
  }

  const rng = rngFromSeed(opts.seed);
  const opening = opts.startWithLorem === true;
  const html = opts.html === true;

  if (unit === 'paragraphs') {
    const paragraphs: string[] = [];
    for (let i = 0; i < count; i += 1) paragraphs.push(makeParagraph(rng, opening && i === 0));
    return {
      ok: true,
      text: html
        ? paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')
        : paragraphs.join('\n\n'),
    };
  }

  let body: string;
  if (unit === 'sentences') {
    const sentences: string[] = [];
    for (let i = 0; i < count; i += 1) sentences.push(makeSentence(rng, opening && i === 0));
    body = sentences.join(' ');
  } else {
    body = makeWordRun(rng, count, opening);
  }
  // A single unit is still a paragraph as far as the markup is concerned.
  return { ok: true, text: html ? `<p>${body}</p>` : body };
}

