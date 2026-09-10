/**
 * The numbers behind the word-counter tool: what a writer checks before
 * pasting into a CMS, a tweet box, or a 500-word assignment.
 *
 * Two rules hold across the file:
 *
 *  - Every statistic comes out of a linear scan. The counter re-runs on each
 *    keystroke over an input that may be a whole manuscript, so nothing here
 *    builds an intermediate token array, and nothing concatenates strings in a
 *    loop. `analyzeText` over a 200k-word document takes tens of milliseconds.
 *  - Sentence segmentation is *not* reimplemented here. It lives in
 *    `sentences.ts` and is shared with the case converter, so the abbreviation
 *    list can never drift between the two tools.
 */

// The calculators' rounding, reused rather than re-derived: `Math.round(v * 100)
// / 100` gets the classic 1.005 family of cases wrong, and these numbers are
// displayed verbatim.
import { roundTo } from '../calc/round.ts';
import { countSentences, isWhitespaceChar } from './sentences.ts';

/**
 * Silent reading speed for prose (Brysbaert 2019, a meta-analysis of 190
 * studies) and a comfortable read-aloud speed. Both are population averages, so
 * the UI presents the results as estimates.
 */
const READING_WPM = 238;
const SPEAKING_WPM = 140;

/** `keywordDensity` reports this many entries and ignores shorter words. */
const KEYWORD_LIMIT = 10;
const KEYWORD_MIN_LENGTH = 3;

/**
 * Function words excluded from keyword density, because "the" topping the
 * frequency table of an English document is not a finding.
 *
 * Every entry is three letters or longer: {@link KEYWORD_MIN_LENGTH} already
 * removes "a", "of", "is", "it" and the rest of the two-letter traffic. The list
 * is deliberately limited to grammar — articles, conjunctions, prepositions,
 * pronouns, auxiliaries, degree adverbs — and holds no content words, so a
 * document about "time" or "work" still reports them.
 */
export const KEYWORD_STOP_WORDS: readonly string[] = [
  // Determiners and quantifiers
  'the', 'this', 'that', 'these', 'those', 'any', 'all', 'both', 'each', 'few',
  'more', 'most', 'other', 'others', 'some', 'such', 'every', 'many', 'much',
  'own', 'same', 'another',
  // Conjunctions and subordinators
  'and', 'but', 'nor', 'yet', 'for', 'than', 'then', 'because', 'while',
  'whether', 'though', 'although', 'unless', 'since', 'whereas', 'either',
  'neither', 'also',
  // Prepositions and particles
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
  'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond',
  'during', 'from', 'into', 'near', 'onto', 'out', 'over', 'past', 'through',
  'throughout', 'under', 'until', 'upon', 'with', 'within', 'without', 'off',
  'per', 'via', 'toward', 'towards',
  // Pronouns and possessives
  'you', 'your', 'yours', 'they', 'them', 'their', 'theirs', 'she', 'her',
  'hers', 'him', 'his', 'its', 'our', 'ours', 'who', 'whom', 'whose', 'what',
  'which', 'myself', 'yourself', 'yourselves', 'himself', 'herself', 'itself',
  'ourselves', 'themselves', 'one', 'ones',
  // Auxiliaries, copulas and modals
  'are', 'was', 'were', 'been', 'being', 'has', 'have', 'had', 'having',
  'does', 'did', 'doing', 'can', 'could', 'will', 'would', 'shall', 'should',
  'may', 'might', 'must', 'ought',
  // Adverbs of degree, time and place that carry no topic
  'not', 'only', 'too', 'very', 'just', 'here', 'there', 'when', 'where',
  'why', 'how', 'ever', 'never', 'again', 'once', 'still', 'even', 'quite',
  'rather', 'almost', 'already', 'always', 'often', 'sometimes', 'perhaps',
];

const STOP_WORDS = new Set(KEYWORD_STOP_WORDS);

/**
 * `characters`, `codePoints` and `graphemes` are three different answers to
 * "how long is this?", and a counter that reports only one of them is wrong for
 * somebody. Take a single thumbs-up with a skin tone, `"\u{1F44D}\u{1F3FD}"`:
 *
 *   - 1 grapheme     — one thing the reader sees, one caret step.
 *   - 2 code points  — THUMBS UP SIGN plus EMOJI MODIFIER FITZPATRICK TYPE-4.
 *   - 4 UTF-16 units — both code points are astral, so both are surrogate pairs.
 *
 * So: `characters` is `input.length`, the count a textarea's `maxLength`, a
 * `varchar(n)` column and most "280 characters" limits actually enforce.
 * `codePoints` is `[...input].length`, the number of Unicode scalars.
 * `graphemes` is what a person means by "character".
 */

/** `[...input].length` without allocating an array per code point. */
function countCodePoints(input: string): number {
  const length = input.length;
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    count += 1;
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) i += 1;
    }
  }
  return count;
}

/**
 * Every ASCII code point except CR is a grapheme cluster on its own, so input
 * with nothing outside that range needs no segmentation: the answer is already
 * the code point count. CR is the exception because CR LF is one cluster.
 *
 * The shortcut is worth the line. `Intl.Segmenter` over a 1.7M-character
 * document costs a few hundred milliseconds; this test costs about one.
 */
const NEEDS_SEGMENTATION = /[^\u0000-\u007f]|\r/;

/** Built on first use and reused: constructing a segmenter is not free. */
let graphemeSegmenter: Intl.Segmenter | null = null;

function countGraphemes(input: string, codePoints: number): number {
  if (input.length === 0) return 0;
  if (!NEEDS_SEGMENTATION.test(input)) return codePoints;
  // Pre-2022 runtimes have no segmenter; code points are the closest honest
  // answer, and are exactly right for everything except combining sequences.
  if (typeof Intl.Segmenter !== 'function') return codePoints;
  graphemeSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  const clusters = graphemeSegmenter.segment(input)[Symbol.iterator]();
  let count = 0;
  while (!clusters.next().done) count += 1;
  return count;
}

/** What one pass over the line structure yields. */
interface Structure {
  charactersNoSpaces: number;
  lines: number;
  paragraphs: number;
}

/**
 * `lines` is line breaks plus one, with CR LF counted once — the number a
 * textarea's caret agrees with, so `"a\n"` is two lines and the second is empty.
 * Empty input has no lines at all.
 *
 * A paragraph is a run of lines that have content, bounded by blank lines. Text
 * with no blank line is therefore exactly one paragraph, and whitespace alone is
 * never a paragraph.
 *
 * `charactersNoSpaces` drops every whitespace character, newlines and tabs
 * included, and is counted in UTF-16 units to stay comparable with `characters`.
 */
function scanStructure(input: string): Structure {
  const length = input.length;
  if (length === 0) return { charactersNoSpaces: 0, lines: 0, paragraphs: 0 };

  let charactersNoSpaces = 0;
  let lines = 1;
  let paragraphs = 0;
  let inParagraph = false;
  let lineHasContent = false;

  for (let i = 0; i < length; i += 1) {
    const ch = input[i];
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      lines += 1;
      if (lineHasContent && !inParagraph) paragraphs += 1;
      inParagraph = lineHasContent;
      lineHasContent = false;
      continue;
    }
    if (!isWhitespaceChar(ch)) {
      charactersNoSpaces += 1;
      lineHasContent = true;
    }
  }
  // The final line has no break to close it.
  if (lineHasContent && !inParagraph) paragraphs += 1;

  return { charactersNoSpaces, lines, paragraphs };
}

/**
 * Punctuation at the edges of a token, stripped so `(hello)` and `hello` count
 * as the same word. Interior punctuation survives, which is what keeps
 * `well-known` and `don't` at one word each — and what leaves a lone hyphen or
 * em dash with nothing left, so it is no word at all.
 */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** What one pass over the whitespace-delimited tokens yields. */
interface WordScan {
  words: number;
  /** Case-insensitive: `The` and `the` are the same word here. */
  uniqueWords: number;
  longestWord: string;
  /** Summed word lengths in code points, for the average. */
  totalLength: number;
  /** Lowercased word to occurrence count; feeds keyword density. */
  frequency: Map<string, number>;
}

function scanWords(input: string): WordScan {
  const length = input.length;
  const frequency = new Map<string, number>();
  let words = 0;
  let totalLength = 0;
  let longestWord = '';
  let longestLength = 0;
  let i = 0;

  while (i < length) {
    while (i < length && isWhitespaceChar(input[i])) i += 1;
    if (i >= length) break;
    const start = i;
    while (i < length && !isWhitespaceChar(input[i])) i += 1;

    const word = input.slice(start, i).replace(EDGE_PUNCTUATION, '');
    if (word.length === 0) continue;

    words += 1;
    // Code points rather than UTF-16 units, so an emoji or an astral letter
    // does not make a word look twice as long as it reads.
    const wordLength = countCodePoints(word);
    totalLength += wordLength;
    if (wordLength > longestLength) {
      longestLength = wordLength;
      longestWord = word;
    }
    const key = word.toLowerCase();
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }

  return { words, uniqueWords: frequency.size, longestWord, totalLength, frequency };
}

/** One row of the keyword table. */
export interface KeywordCount {
  /** Lowercased, so `SEO` and `seo` are one keyword. */
  word: string;
  count: number;
  /** Share of all words as a percentage, to two decimals. */
  percent: number;
}

/**
 * The top {@link KEYWORD_LIMIT} keywords by count, ties broken alphabetically.
 *
 * Selection is a bounded insertion into a ten-slot array rather than a sort of
 * the whole vocabulary, which keeps the whole analysis linear. The comparator is
 * a total order — count descending, then word ascending — so the result depends
 * only on which words are present, never on the order they were written in.
 * That is what makes the output reproducible for identical inputs.
 */
function topKeywords(frequency: Map<string, number>, totalWords: number): KeywordCount[] {
  if (totalWords === 0) return [];
  const top: Array<{ word: string; count: number }> = [];

  for (const [word, count] of frequency) {
    if (word.length < KEYWORD_MIN_LENGTH || STOP_WORDS.has(word)) continue;
    let at = top.length;
    while (at > 0 && outranks(word, count, top[at - 1])) at -= 1;
    if (at >= KEYWORD_LIMIT) continue;
    top.splice(at, 0, { word, count });
    if (top.length > KEYWORD_LIMIT) top.pop();
  }

  return top.map((entry) => ({
    word: entry.word,
    count: entry.count,
    percent: roundTo((entry.count / totalWords) * 100, 2),
  }));
}

/** Count descending, then code-unit order, which for lowercase words is A-Z. */
function outranks(word: string, count: number, other: { word: string; count: number }): boolean {
  if (count !== other.count) return count > other.count;
  return word < other.word;
}

/** Everything the counter page displays, from one call. */
export interface TextStats {
  /** UTF-16 units: `input.length`, the number character limits enforce. */
  characters: number;
  /** Unicode scalars. */
  codePoints: number;
  /** User-perceived characters; equals `codePoints` where clustering is absent. */
  graphemes: number;
  /** `characters` less every whitespace character, newlines and tabs included. */
  charactersNoSpaces: number;
  words: number;
  /** Distinct words, compared case-insensitively. */
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  /** Line breaks plus one; `0` for empty input. */
  lines: number;
  /** At 238 wpm, in whole seconds. */
  readingTimeSeconds: number;
  /** At 140 wpm, in whole seconds. */
  speakingTimeSeconds: number;
  /** The first of the longest, measured in code points; `''` when wordless. */
  longestWord: string;
  /** Code points per word, to two decimals. */
  avgWordLength: number;
  /** Words per sentence, to two decimals. */
  avgSentenceLength: number;
  /** Up to ten rows, most frequent first. */
  keywordDensity: KeywordCount[];
}

/**
 * Analyse `input` in a handful of linear passes.
 *
 * Empty and whitespace-only input return zeros, `''` and `[]` rather than
 * throwing or dividing by zero: the page calls this on first render, against an
 * empty textarea, and again on every keystroke after that.
 */
export function analyzeText(input: string): TextStats {
  const codePoints = countCodePoints(input);
  const structure = scanStructure(input);
  const scan = scanWords(input);
  const words = scan.words;
  // No words means nothing to segment. The guard also stops a punctuation-only
  // input from reporting one sentence next to zero words, which reads as a bug.
  const sentences = words === 0 ? 0 : countSentences(input);

  return {
    characters: input.length,
    codePoints,
    graphemes: countGraphemes(input, codePoints),
    charactersNoSpaces: structure.charactersNoSpaces,
    words,
    uniqueWords: scan.uniqueWords,
    sentences,
    paragraphs: structure.paragraphs,
    lines: structure.lines,
    readingTimeSeconds: Math.round((words / READING_WPM) * 60),
    speakingTimeSeconds: Math.round((words / SPEAKING_WPM) * 60),
    longestWord: scan.longestWord,
    avgWordLength: words === 0 ? 0 : roundTo(scan.totalLength / words, 2),
    avgSentenceLength: sentences === 0 ? 0 : roundTo(words / sentences, 2),
    keywordDensity: topKeywords(scan.frequency, words),
  };
}
