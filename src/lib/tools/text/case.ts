/**
 * Case conversion for the "convert case" tool.
 *
 * The twelve modes split into two families, and that split is the whole design
 * of the file:
 *
 *  - Text modes (`lower`, `upper`, `title`, `sentence`, `alternating`,
 *    `inverse`) rewrite prose. They keep every character the user typed —
 *    punctuation, runs of spaces, and the original line endings — because
 *    somebody who pastes three CRLF lines expects three CRLF lines back.
 *  - Identifier modes (`camel`, `pascal`, `snake`, `constant`, `kebab`, `dot`)
 *    rewrite a name. They discard everything that is not a letter or a digit,
 *    reduce the input to words, and re-join them, so they flatten whitespace and
 *    line breaks by design. All six are idempotent: feeding one its own output
 *    returns that output unchanged.
 *
 * Sentence detection is imported from `sentences.ts`, shared with the word
 * counter, so the abbreviation list exists in exactly one place.
 */

import { isWhitespaceChar, splitSentences } from './sentences.ts';

export type CaseMode =
  | 'lower'
  | 'upper'
  | 'title'
  | 'sentence'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'dot'
  | 'alternating'
  | 'inverse';

/** Display order for the mode picker; also the order of the examples table. */
export const CASE_MODES: readonly CaseMode[] = [
  'lower', 'upper', 'title', 'sentence', 'camel', 'pascal',
  'snake', 'constant', 'kebab', 'dot', 'alternating', 'inverse',
];

/**
 * Words that stay lowercase in a title unless they land in the first or last
 * position. This is the short, conventional list; longer style guides disagree
 * with each other, and a tool that silently follows one of them is worse than a
 * tool that follows an obvious one.
 */
const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from',
  'by', 'of', 'in', 'with', 'as', 'per', 'via',
]);

/** Any letter, cased or not. */
const LETTER = /\p{L}/u;
/** Upper- and title-case letters; a title-case letter behaves as upper here. */
const UPPERCASE = /\p{Lu}|\p{Lt}/u;
const LOWERCASE = /\p{Ll}/u;
const NUMBER = /\p{N}/u;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
/** Leading and trailing punctuation, so `(NASA)` still reads as an acronym. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Capturing, so `String.split` hands back the exact break it matched. */
const LINE_BREAK = /(\r\n|\n|\r)/;

/**
 * The whole code point starting at `index` — two UTF-16 units when it is an
 * astral character. Every scan in this file steps with this rather than by
 * index, so an emoji or an astral letter is never split down the middle.
 */
function charAt(input: string, index: number): string {
  const code = input.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
    const low = input.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return input.slice(index, index + 2);
  }
  return input[index];
}

/**
 * How a character behaves at a word boundary. Everything that is not a letter or
 * a digit is a separator, which covers spaces, `_`, `-`, `.`, `/`, `:` and every
 * other punctuation mark under one rule instead of a list to keep in sync.
 */
type CharClass = 'separator' | 'lower' | 'upper' | 'digit';

function classify(ch: string): CharClass {
  // ASCII first: identifiers are overwhelmingly ASCII and this is the hot path.
  if (ch >= 'a' && ch <= 'z') return 'lower';
  if (ch >= 'A' && ch <= 'Z') return 'upper';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch.charCodeAt(0) < 0x80) return 'separator';
  if (UPPERCASE.test(ch)) return 'upper';
  // Caseless scripts (CJK, Arabic, Thai) count as lowercase: they never open a
  // word on their own, but a capital following them does.
  if (LETTER.test(ch)) return 'lower';
  if (NUMBER.test(ch)) return 'digit';
  return 'separator';
}

/**
 * Does a new word start at the character just classified as `current`?
 *
 * Three rules, which together give `parseHTMLDocument` its three words:
 *  1. lower or digit, then upper — `fooBar`.
 *  2. upper, then upper, then lower — the closing capital of an acronym run
 *     belongs to the word after it, so `HTMLDocument` is `HTML` + `Document`.
 *  3. any letter/digit transition — `user2Name` is `user` + `2` + `Name`.
 */
function boundaryBefore(
  previous: CharClass,
  current: CharClass,
  input: string,
  nextIndex: number,
): boolean {
  if (previous === current) {
    if (current !== 'upper') return false;
    return nextIndex < input.length && classify(charAt(input, nextIndex)) === 'lower';
  }
  if (previous === 'digit' || current === 'digit') return true;
  return current === 'upper';
}

/**
 * Break `input` into the words the identifier modes re-join.
 *
 * The required cases, all falling out of {@link boundaryBefore}:
 *
 *   parseHTMLDocument -> parse, HTML, Document
 *   getURLPath        -> get, URL, Path
 *   user2Name         -> user, 2, Name
 *   --foo__bar.baz--  -> foo, bar, baz
 *
 * Words come back with their original case; each mode decides what to do with
 * it. An input with no letters or digits yields an empty array.
 */
export function splitWords(input: string): string[] {
  const words: string[] = [];
  const length = input.length;
  let start = -1;
  let previous: CharClass = 'separator';
  let i = 0;

  while (i < length) {
    const ch = charAt(input, i);
    const size = ch.length;
    const current = classify(ch);

    if (current === 'separator') {
      if (start >= 0) {
        words.push(input.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    } else if (boundaryBefore(previous, current, input, i + size)) {
      words.push(input.slice(start, i));
      start = i;
    }

    previous = current;
    i += size;
  }

  if (start >= 0) words.push(input.slice(start, length));
  return words;
}

/**
 * A run of two or more characters with a capital in it and no lowercase at all:
 * `NASA`, `API`, `HTML`. Treated as deliberate, so the converters keep its shape
 * instead of flattening it to `Nasa`.
 */
function isAcronym(word: string): boolean {
  return word.length > 1 && !LOWERCASE.test(word) && UPPERCASE.test(word);
}

/** First letter up, rest down — unless the word is an acronym, which survives. */
function capitalize(word: string): string {
  if (word.length === 0 || isAcronym(word)) return word;
  const head = charAt(word, 0);
  return head.toUpperCase() + word.slice(head.length).toLowerCase();
}

/**
 * Capitalise the first *letter* and leave whatever precedes it alone, so an
 * opening quote or bracket does not swallow the capital: `"hello` -> `"Hello`.
 */
function capitalizeFirstLetter(text: string): string {
  for (let i = 0; i < text.length; ) {
    const ch = charAt(text, i);
    if (LETTER.test(ch)) {
      return text.slice(0, i) + ch.toUpperCase() + text.slice(i + ch.length);
    }
    i += ch.length;
  }
  return text;
}

/** `camel` and `pascal` differ only in what becomes of the first word. */
function joinCamel(words: readonly string[], upperFirst: boolean): string {
  return words
    .map((word, index) => (index === 0 && !upperFirst ? word.toLowerCase() : capitalize(word)))
    .join('');
}

/** `snake`, `kebab` and `dot`: lowercase throughout, one joining character. */
function joinLower(words: readonly string[], separator: string): string {
  return words.map((word) => word.toLowerCase()).join(separator);
}

/**
 * Apply `transform` to the content of every line, leaving the breaks alone.
 * `String.split` with a capturing group interleaves content and separators
 * (content at the even indices), so a CRLF file comes back as a CRLF file and a
 * mixed one keeps its mix.
 */
function mapLines(input: string, transform: (line: string) => string): string {
  const parts = input.split(LINE_BREAK);
  for (let i = 0; i < parts.length; i += 2) parts[i] = transform(parts[i]);
  return parts.join('');
}

/**
 * Title-case one line. The first and last *words* are always capitalised and the
 * minor words between them are not. Tokens with no letter or digit in them — a
 * lone em dash, say — are left untouched and are not eligible to be the first or
 * last word.
 *
 * A hyphenated compound counts as one word, so `well-known` becomes
 * `Well-known`. That matches the word counter, which also counts it once.
 */
function titleCaseLine(line: string, preserveAcronyms: boolean): string {
  const pieces: string[] = [];
  const wordPieces: number[] = [];
  let i = 0;

  while (i < line.length) {
    const spaceStart = i;
    while (i < line.length && isWhitespaceChar(line[i])) i += 1;
    if (i > spaceStart) pieces.push(line.slice(spaceStart, i));

    const tokenStart = i;
    while (i < line.length && !isWhitespaceChar(line[i])) i += 1;
    if (i > tokenStart) {
      const token = line.slice(tokenStart, i);
      if (ALPHANUMERIC.test(token)) wordPieces.push(pieces.length);
      pieces.push(token);
    }
  }

  for (let n = 0; n < wordPieces.length; n += 1) {
    const at = wordPieces[n];
    const isEdge = n === 0 || n === wordPieces.length - 1;
    pieces[at] = titleToken(pieces[at], isEdge, preserveAcronyms);
  }

  return pieces.join('');
}

function titleToken(token: string, isEdge: boolean, preserveAcronyms: boolean): string {
  const core = token.replace(EDGE_PUNCTUATION, '');
  if (preserveAcronyms && isAcronym(core)) return token;
  const lowered = token.toLowerCase();
  if (!isEdge && MINOR_WORDS.has(core.toLowerCase())) return lowered;
  return capitalizeFirstLetter(lowered);
}

/**
 * Lowercase everything, then put back one capital at the start of each sentence.
 *
 * Segmentation runs over the *lowered* copy so the offsets it returns still line
 * up after case folding, which is not guaranteed otherwise: a few characters
 * change length when cased. Everything between two sentences is copied through
 * untouched, which is what preserves blank lines and line endings.
 */
function sentenceCase(input: string): string {
  const lowered = input.toLowerCase();
  const pieces: string[] = [];
  let cursor = 0;

  for (const span of splitSentences(lowered)) {
    let at = span.start;
    let head = '';
    while (at < span.end) {
      const ch = charAt(lowered, at);
      if (LETTER.test(ch)) {
        head = ch;
        break;
      }
      at += ch.length;
    }
    if (head === '') continue;
    pieces.push(lowered.slice(cursor, at), head.toUpperCase());
    cursor = at + head.length;
  }

  pieces.push(lowered.slice(cursor));
  return pieces.join('');
}

/**
 * `mOcKiNg` case. The alternation starts lowercase and only advances on letters,
 * so spaces and punctuation do not flip the phase: `ab cd` becomes `aB cD`, not
 * `aB Cd`. Getting that wrong is the single most common bug in these converters.
 */
function alternatingCase(input: string): string {
  const pieces: string[] = [];
  let wantUpper = false;

  for (let i = 0; i < input.length; ) {
    const ch = charAt(input, i);
    i += ch.length;
    if (!LETTER.test(ch)) {
      pieces.push(ch);
      continue;
    }
    pieces.push(wantUpper ? ch.toUpperCase() : ch.toLowerCase());
    wantUpper = !wantUpper;
  }

  return pieces.join('');
}

/** Swap the case of every letter and pass everything else through. */
function inverseCase(input: string): string {
  const pieces: string[] = [];

  for (let i = 0; i < input.length; ) {
    const ch = charAt(input, i);
    i += ch.length;
    if (UPPERCASE.test(ch)) pieces.push(ch.toLowerCase());
    else if (LOWERCASE.test(ch)) pieces.push(ch.toUpperCase());
    else pieces.push(ch);
  }

  return pieces.join('');
}

/**
 * Convert `input` to `mode`.
 *
 * `mode` arrives from a URL query parameter as often as from a click, so an
 * unrecognised value returns the input unchanged rather than throwing.
 */
export function convertCase(input: string, mode: CaseMode): string {
  switch (mode) {
    case 'lower':
      return input.toLowerCase();
    case 'upper':
      return input.toUpperCase();
    case 'title': {
      // Input with no lowercase letter anywhere is shouting, not a run of
      // acronyms: `MY GREAT TITLE` gets title-cased, while `NASA and the API`
      // keeps both of its acronyms because it has lowercase letters elsewhere.
      const preserveAcronyms = LOWERCASE.test(input);
      return mapLines(input, (line) => titleCaseLine(line, preserveAcronyms));
    }
    case 'sentence':
      return sentenceCase(input);
    case 'alternating':
      return alternatingCase(input);
    case 'inverse':
      return inverseCase(input);
    case 'camel':
      return joinCamel(splitWords(input), false);
    case 'pascal':
      return joinCamel(splitWords(input), true);
    case 'snake':
      return joinLower(splitWords(input), '_');
    case 'constant':
      return splitWords(input)
        .map((word) => word.toUpperCase())
        .join('_');
    case 'kebab':
      return joinLower(splitWords(input), '-');
    case 'dot':
      return joinLower(splitWords(input), '.');
    default:
      return input;
  }
}

/**
 * The sample every example below is generated from. Generating them by running
 * the real converter means the examples shown in the picker cannot drift away
 * from what the tool actually does.
 */
const EXAMPLE_INPUT = 'Hello World';

/** Display name plus a live example for each mode, keyed by mode. */
export const CASE_LABELS: Record<CaseMode, { label: string; example: string }> = {
  lower: { label: 'lowercase', example: convertCase(EXAMPLE_INPUT, 'lower') },
  upper: { label: 'UPPERCASE', example: convertCase(EXAMPLE_INPUT, 'upper') },
  title: { label: 'Title Case', example: convertCase(EXAMPLE_INPUT, 'title') },
  sentence: { label: 'Sentence case', example: convertCase(EXAMPLE_INPUT, 'sentence') },
  camel: { label: 'camelCase', example: convertCase(EXAMPLE_INPUT, 'camel') },
  pascal: { label: 'PascalCase', example: convertCase(EXAMPLE_INPUT, 'pascal') },
  snake: { label: 'snake_case', example: convertCase(EXAMPLE_INPUT, 'snake') },
  constant: { label: 'CONSTANT_CASE', example: convertCase(EXAMPLE_INPUT, 'constant') },
  kebab: { label: 'kebab-case', example: convertCase(EXAMPLE_INPUT, 'kebab') },
  dot: { label: 'dot.case', example: convertCase(EXAMPLE_INPUT, 'dot') },
  alternating: {
    label: 'aLtErNaTiNg cAsE',
    example: convertCase(EXAMPLE_INPUT, 'alternating'),
  },
  inverse: { label: 'iNVERSE cASE', example: convertCase(EXAMPLE_INPUT, 'inverse') },
};
