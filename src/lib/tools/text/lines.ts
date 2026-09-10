/**
 * Line-oriented text tools: dedupe, sort, whitespace cleanup, numbering,
 * prefixes and suffixes, repetition and counting.
 *
 * Three rules hold across the file:
 *
 * - **Line endings survive.** Input splits on CRLF, LF *and* bare CR, and the
 *   result is rejoined with whichever of CRLF/LF dominated the input, since it
 *   is normally pasted straight back where it came from. Bare CR becomes LF.
 * - **Empty in, empty out.** `''` is never treated as one blank line.
 * - **Nothing throws.** Bad options are clamped (`tabWidth`) or reported as a
 *   value (`repeatText`), because every argument here comes from a user.
 */

import { rngFromSeed, shuffled } from './random.ts';

/** All three conventions, so input with mixed endings still splits cleanly. */
const LINE_BREAK = /\r\n|\r|\n/;

/** Global twin, for rewriting every break in a string at once. */
const LINE_BREAK_ALL = /\r\n|\r|\n/g;

/** Runs of spaces and tabs only: a newline is structure, not whitespace. */
const SPACE_RUN = /[ \t]+/g;

/** Blank means empty *or* whitespace-only; every `skipEmpty` option agrees. */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/**
 * The ending the input mostly uses. LF wins ties because it is the safer
 * thing to emit when the input genuinely does not say.
 */
export function detectLineEnding(input: string): '\r\n' | '\n' {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== '\n') continue;
    if (i > 0 && input[i - 1] === '\r') crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? '\r\n' : '\n';
}

function splitLines(input: string): string[] {
  return input.split(LINE_BREAK);
}

/** Rejoins with `ending`, so no caller hand-rolls the join. */
function joinLines(lines: readonly string[], ending: string): string {
  return lines.join(ending);
}

/* ------------------------------------------------------------------ *
 * Dedupe
 * ------------------------------------------------------------------ */

export interface DedupeOptions {
  /** Default `true`. When `false`, `Apple` and `apple` are the same line. */
  caseSensitive?: boolean;
  /** Default `false`. Compares trimmed, but keeps the original spacing. */
  trimBeforeCompare?: boolean;
  /**
   * Which copy of a duplicate survives, and therefore where it sits and which
   * casing it keeps. Default `'first'`.
   */
  keep?: 'first' | 'last';
  /** Default `false`. Drops blank lines outright, before deduping. */
  removeEmpty?: boolean;
}

export interface DedupeResult {
  result: string;
  /** Lines the operation removed: duplicates and dropped blanks together. */
  removedCount: number;
  /** Lines left, i.e. how many distinct lines were kept. */
  uniqueCount: number;
}

function comparisonKey(line: string, caseSensitive: boolean, trim: boolean): string {
  const base = trim ? line.trim() : line;
  return caseSensitive ? base : base.toLowerCase();
}

export function dedupeLines(input: string, opts: DedupeOptions): DedupeResult {
  if (input === '') return { result: '', removedCount: 0, uniqueCount: 0 };
  const ending = detectLineEnding(input);
  const caseSensitive = opts.caseSensitive !== false;
  const trim = opts.trimBeforeCompare === true;
  const all = splitLines(input);
  const source = opts.removeEmpty === true ? all.filter((line) => !isBlank(line)) : all;

  // `keep: 'last'` is the same walk in reverse, so one loop covers both cases
  // and the surviving copy is always the one the user asked for.
  const order = opts.keep === 'last' ? source.slice().reverse() : source;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of order) {
    const key = comparisonKey(line, caseSensitive, trim);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  if (opts.keep === 'last') kept.reverse();

  return {
    result: joinLines(kept, ending),
    removedCount: all.length - kept.length,
    uniqueCount: kept.length,
  };
}

/* ------------------------------------------------------------------ *
 * Sort
 * ------------------------------------------------------------------ */

export type SortOrder =
  | 'asc'
  | 'desc'
  | 'length-asc'
  | 'length-desc'
  | 'natural'
  | 'reverse'
  | 'shuffle';

export interface SortOptions {
  order: SortOrder;
  /** Default `true`. `false` treats `apple` and `Apple` as equal. */
  caseSensitive?: boolean;
  /** Default `false`. Blank lines otherwise sort to the top. */
  removeEmpty?: boolean;
  /** Read only by `shuffle`. With a seed the shuffle repeats exactly. */
  seed?: number;
}

interface DecoratedLine {
  text: string;
  index: number;
  /** Code points, not UTF-16 units, so an emoji counts as one character. */
  size: number;
}

/**
 * `sensitivity: 'accent'` is the case-insensitive setting that still tells
 * `resume` and `résumé` apart, which is what a user means by "ignore case".
 */
function collatorFor(caseSensitive: boolean, numeric: boolean): Intl.Collator {
  return new Intl.Collator(undefined, {
    numeric,
    sensitivity: caseSensitive ? 'variant' : 'accent',
  });
}

function compareLines(
  a: DecoratedLine,
  b: DecoratedLine,
  order: SortOrder,
  collator: Intl.Collator,
): number {
  switch (order) {
    case 'length-asc':
      return a.size - b.size;
    case 'length-desc':
      return b.size - a.size;
    case 'desc':
      return collator.compare(b.text, a.text);
    default:
      // `asc` and `natural` differ only in the collator they were handed.
      return collator.compare(a.text, b.text);
  }
}

export function sortLines(input: string, opts: SortOptions): string {
  if (input === '') return '';
  const ending = detectLineEnding(input);
  const all = splitLines(input);
  const lines = opts.removeEmpty === true ? all.filter((line) => !isBlank(line)) : all;

  if (opts.order === 'reverse') return joinLines(lines.slice().reverse(), ending);
  if (opts.order === 'shuffle') {
    return joinLines(shuffled(lines, rngFromSeed(opts.seed)), ending);
  }

  const collator = collatorFor(opts.caseSensitive !== false, opts.order === 'natural');
  // Decorated so the code-point count is paid once per line rather than once
  // per comparison, and so ties fall back to the original order.
  const decorated: DecoratedLine[] = lines.map((text, index) => ({
    text,
    index,
    size: [...text].length,
  }));
  decorated.sort((a, b) => compareLines(a, b, opts.order, collator) || a.index - b.index);
  return joinLines(decorated.map((entry) => entry.text), ending);
}

/* ------------------------------------------------------------------ *
 * Whitespace
 * ------------------------------------------------------------------ */

export type WhitespaceMode =
  | 'trim-lines'
  | 'collapse-spaces'
  | 'remove-all'
  | 'remove-blank-lines'
  | 'tabs-to-spaces'
  | 'spaces-to-tabs'
  | 'normalise';

export interface WhitespaceOptions {
  mode: WhitespaceMode;
  /** Tab stop width for the two tab modes. Default 4, clamped to 1..16. */
  tabWidth?: number;
}

function clampTabWidth(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width)) return 4;
  return Math.min(16, Math.max(1, Math.floor(width)));
}

/** Tab-stop aware: `a\tb` puts `b` on the next multiple of `width`. */
function expandTabs(line: string, width: number): string {
  let out = '';
  let column = 0;
  for (const ch of line) {
    if (ch === '\t') {
      const gap = width - (column % width);
      out += ' '.repeat(gap);
      column += gap;
      continue;
    }
    out += ch;
    column += 1;
  }
  return out;
}

/**
 * The inverse, applied to leading indentation only. Turning interior runs into
 * tabs would wreck prose and column alignment, and indentation is the only
 * place a tab earns its keep — so this round-trips with {@link expandTabs} for
 * indented text and is deliberately lossy for a tab in the middle of a line.
 */
function contractLeadingSpaces(line: string, width: number): string {
  let end = 0;
  while (end < line.length && (line[end] === ' ' || line[end] === '\t')) end += 1;
  if (end === 0) return line;
  const indent = expandTabs(line.slice(0, end), width);
  return (
    '\t'.repeat(Math.floor(indent.length / width)) +
    ' '.repeat(indent.length % width) +
    line.slice(end)
  );
}

/** Three or more blank lines reads as an accident; one is a deliberate break. */
function collapseBlankRun(count: number): string[] {
  return new Array<string>(count >= 3 ? 1 : count).fill('');
}

function normaliseLines(lines: readonly string[]): string[] {
  const tidied = lines.map((line) => line.trim().replace(SPACE_RUN, ' '));
  const out: string[] = [];
  let blankRun = 0;
  for (const line of tidied) {
    if (line === '') {
      blankRun += 1;
      continue;
    }
    out.push(...collapseBlankRun(blankRun), line);
    blankRun = 0;
  }
  out.push(...collapseBlankRun(blankRun));
  return out;
}

export function removeWhitespace(input: string, opts: WhitespaceOptions): string {
  if (input === '') return '';
  const ending = detectLineEnding(input);
  const width = clampTabWidth(opts.tabWidth);
  const lines = splitLines(input);

  switch (opts.mode) {
    case 'remove-all':
      // The one mode that deliberately loses the line structure: the result is
      // a single unbroken run, so there is no ending left to preserve.
      return input.replace(/\s+/gu, '');
    case 'trim-lines':
      return joinLines(lines.map((line) => line.trim()), ending);
    case 'collapse-spaces':
      return joinLines(lines.map((line) => line.replace(SPACE_RUN, ' ')), ending);
    case 'remove-blank-lines':
      return joinLines(lines.filter((line) => !isBlank(line)), ending);
    case 'tabs-to-spaces':
      return joinLines(lines.map((line) => expandTabs(line, width)), ending);
    case 'spaces-to-tabs':
      return joinLines(lines.map((line) => contractLeadingSpaces(line, width)), ending);
    default:
      // `normalise`: trim, squeeze runs of spaces/tabs, thin out blank runs.
      return joinLines(normaliseLines(lines), ending);
  }
}

/* ------------------------------------------------------------------ *
 * Numbering, prefixes and suffixes
 * ------------------------------------------------------------------ */

export interface NumberLinesOptions {
  /** First number. Default 1. Zero and negative starts are allowed. */
  start?: number;
  /** Sits between the number and the line. Default `'. '`. */
  separator?: string;
  /** Right-aligns the numbers by padding with spaces, `cat -n` style. */
  padded?: boolean;
  /** Blank lines pass through unnumbered and do not consume a number. */
  skipEmpty?: boolean;
}

export function numberLines(input: string, opts: NumberLinesOptions): string {
  if (input === '') return '';
  const ending = detectLineEnding(input);
  const lines = splitLines(input);
  const separator = opts.separator ?? '. ';
  const skipEmpty = opts.skipEmpty === true;
  const start =
    opts.start === undefined || !Number.isFinite(opts.start) ? 1 : Math.trunc(opts.start);

  // Two passes: the first hands out numbers, so the second knows the widest.
  // `null` marks a line that was skipped rather than numbered.
  const numbers: Array<number | null> = [];
  let next = start;
  for (const line of lines) {
    if (skipEmpty && isBlank(line)) {
      numbers.push(null);
      continue;
    }
    numbers.push(next);
    next += 1;
  }

  let width = 0;
  if (opts.padded === true) {
    for (const value of numbers) {
      if (value !== null) width = Math.max(width, String(value).length);
    }
  }

  const out = lines.map((line, i) => {
    const value = numbers[i];
    return value === null ? line : String(value).padStart(width) + separator + line;
  });
  return joinLines(out, ending);
}

export interface AffixOptions {
  prefix?: string;
  suffix?: string;
  /** Blank lines are left exactly as they are. */
  skipEmpty?: boolean;
}

export function addPrefixSuffix(input: string, opts: AffixOptions): string {
  if (input === '') return '';
  const ending = detectLineEnding(input);
  const prefix = opts.prefix ?? '';
  const suffix = opts.suffix ?? '';
  const skipEmpty = opts.skipEmpty === true;
  const out = splitLines(input).map((line) =>
    skipEmpty && isBlank(line) ? line : prefix + line + suffix,
  );
  return joinLines(out, ending);
}

/* ------------------------------------------------------------------ *
 * Repeat and count
 * ------------------------------------------------------------------ */

/**
 * Past this the browser tab, not the algorithm, is the bottleneck: the string
 * has to be built, laid out in a textarea and copied to the clipboard.
 */
const MAX_REPEAT_CHARS = 5_000_000;

export interface RepeatOptions {
  times: number;
  /**
   * Between copies. Defaults to the input's own line ending, so copies land one
   * per line; any breaks inside a supplied separator are rewritten to match.
   */
  separator?: string;
  /** Prefixes each copy with `1. `, `2. ` and so on. */
  numbered?: boolean;
}

export type RepeatResult = { ok: true; result: string } | { ok: false; error: string };

function withThousands(value: number): string {
  return value.toLocaleString('en-US');
}

export function repeatText(input: string, opts: RepeatOptions): RepeatResult {
  const { times } = opts;
  if (!Number.isInteger(times)) {
    return { ok: false, error: 'Enter a whole number of copies.' };
  }
  if (times < 1) {
    return { ok: false, error: 'Enter at least 1 copy.' };
  }
  const size = times * input.length;
  if (size > MAX_REPEAT_CHARS) {
    return {
      ok: false,
      error:
        `That would build ${withThousands(size)} characters, over the ` +
        `${withThousands(MAX_REPEAT_CHARS)} a browser tab can handle. ` +
        'Try fewer copies or shorter text.',
    };
  }

  const ending = detectLineEnding(input);
  const separator = (opts.separator ?? ending).replace(LINE_BREAK_ALL, ending);
  const numbered = opts.numbered === true;
  const copies: string[] = [];
  for (let i = 0; i < times; i += 1) {
    copies.push(numbered ? `${i + 1}. ${input}` : input);
  }
  return { ok: true, result: copies.join(separator) };
}

export interface LineCounts {
  total: number;
  /** Lines with something other than whitespace on them. */
  nonEmpty: number;
  /**
   * Distinct lines, compared exactly — the same notion `dedupeLines` uses with
   * its defaults, so the two numbers can never disagree.
   */
  unique: number;
}

export function countLines(input: string): LineCounts {
  if (input === '') return { total: 0, nonEmpty: 0, unique: 0 };
  const lines = splitLines(input);
  const seen = new Set<string>();
  let nonEmpty = 0;
  for (const line of lines) {
    if (!isBlank(line)) nonEmpty += 1;
    seen.add(line);
  }
  return { total: lines.length, nonEmpty, unique: seen.size };
}

