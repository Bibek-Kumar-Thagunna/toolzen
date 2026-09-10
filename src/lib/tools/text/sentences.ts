/**
 * Sentence segmentation shared by the word counter (`counter.ts`) and the
 * sentence-case converter (`case.ts`). It lives in its own module so the
 * abbreviation list exists in exactly one place and can never drift between
 * the two tools.
 *
 * This is a heuristic, not UAX #29: with no dictionary and no dependencies we
 * rely on a curated abbreviation list plus a few structural rules (decimal
 * numbers, capitalised initials, closing quotes, blank-line breaks). Together
 * they cover the overwhelming majority of English prose.
 *
 * The scanner is O(n): it never re-slices the input except for a bounded
 * look-behind window when testing for an abbreviation.
 */

/** A single sentence, trimmed, with offsets back into the original input. */
export interface SentenceSpan {
  /** Index of the first non-whitespace character of the sentence. */
  start: number;
  /** Index one past the last non-whitespace character of the sentence. */
  end: number;
  /** Equal to `input.slice(start, end)`. */
  text: string;
}

/** Characters treated as sentence terminators. `…` is U+2026. */
const TERMINATORS = new Set(['.', '!', '?', '…']);

/**
 * Closing punctuation allowed to sit between the terminator and the following
 * whitespace, so `He said "Stop." Then he left.` is two sentences.
 */
const CLOSING_WRAPPERS = new Set([
  '"',
  "'",
  '”',
  '’',
  ')',
  ']',
  '}',
  '»',
  '›',
]);

/**
 * Abbreviations that end in a period but almost never end a sentence. Stored
 * lowercase *including* the trailing dot so multi-dot forms such as `e.g.` and
 * `u.s.` resolve in a single set lookup.
 */
export const SENTENCE_ABBREVIATIONS: readonly string[] = [
  // Personal and professional titles
  'mr.', 'mrs.', 'ms.', 'mx.', 'dr.', 'prof.', 'rev.', 'fr.', 'sr.', 'jr.',
  'st.', 'hon.', 'pres.', 'gov.', 'sen.', 'rep.', 'capt.', 'col.', 'cmdr.',
  'gen.', 'lt.', 'sgt.', 'maj.', 'det.', 'supt.',
  // Latin and editorial
  'e.g.', 'i.e.', 'etc.', 'vs.', 'viz.', 'cf.', 'al.', 'ca.', 'ibid.',
  'op.', 'cit.', 'n.b.',
  // Places and addresses
  'u.s.', 'u.s.a.', 'u.k.', 'e.u.', 'd.c.', 'mt.', 'ft.', 'ave.', 'blvd.',
  'rd.', 'ln.', 'apt.', 'no.', 'nos.',
  // Organisations
  'inc.', 'ltd.', 'co.', 'corp.', 'llc.', 'plc.', 'dept.', 'div.', 'est.',
  'assn.', 'bros.', 'univ.',
  // Clock and calendar
  'a.m.', 'p.m.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.',
  'sep.', 'sept.', 'oct.', 'nov.', 'dec.', 'mon.', 'tue.', 'tues.', 'wed.',
  'thu.', 'thur.', 'thurs.', 'fri.', 'sat.', 'sun.',
  // Reference and measurement
  'fig.', 'figs.', 'vol.', 'vols.', 'ed.', 'eds.', 'pp.', 'p.', 'ch.',
  'chap.', 'sec.', 'para.', 'approx.', 'min.', 'max.', 'ref.', 'resp.',
  'trans.', 'orig.', 'esp.', 'incl.', 'excl.',
];

const ABBREVIATIONS = new Set(SENTENCE_ABBREVIATIONS);

/** Bounds the look-behind window used by {@link endsWithAbbreviation}. */
const MAX_ABBREVIATION_LENGTH = SENTENCE_ABBREVIATIONS.reduce(
  (longest, entry) => Math.max(longest, entry.length),
  0,
);

/** Any Unicode whitespace. Non-global so there is no `lastIndex` to reset. */
const UNICODE_WHITESPACE = /\s/u;

/** ASCII fast path first; only exotic code points reach the regex. */
export function isWhitespaceChar(ch: string): boolean {
  if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') return true;
  const code = ch.charCodeAt(0);
  if (code < 0x80) return code === 0x0b || code === 0x0c;
  return UNICODE_WHITESPACE.test(ch);
}

function isDigitChar(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWordStartChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/**
 * True when the period at `dotIndex` closes a known abbreviation or a
 * capitalised initial (`J. R. R. Tolkien`), and therefore does not end a
 * sentence.
 */
function endsWithAbbreviation(input: string, dotIndex: number): boolean {
  if (dotIndex === 0) return false;
  const floor = Math.max(0, dotIndex - MAX_ABBREVIATION_LENGTH - 1);
  let start = dotIndex;
  while (start > floor && !isWhitespaceChar(input[start - 1])) start -= 1;

  let token = input.slice(start, dotIndex + 1).toLowerCase();
  // Drop leading punctuation so `(e.g.` still matches `e.g.`.
  let lead = 0;
  while (lead < token.length && !isWordStartChar(token[lead])) lead += 1;
  token = token.slice(lead);
  if (ABBREVIATIONS.has(token)) return true;

  // A single capital letter plus a dot is an initial, not a full stop.
  const previous = input[dotIndex - 1];
  return (
    token.length === 2 &&
    /\p{Lu}/u.test(previous) &&
    (start === 0 || isWhitespaceChar(input[start - 1]) || input[start - 1] === '.')
  );
}

function pushSpan(
  input: string,
  spans: SentenceSpan[],
  rawStart: number,
  rawEnd: number,
): void {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && isWhitespaceChar(input[start])) start += 1;
  while (end > start && isWhitespaceChar(input[end - 1])) end -= 1;
  if (end <= start) return;
  spans.push({ start, end, text: input.slice(start, end) });
}

/**
 * Split `input` into sentences.
 *
 * Rules, in the order they are applied to a candidate terminator:
 * 1. `.` between two digits is a decimal point (`3.14`), not a full stop.
 * 2. `.` closing a known abbreviation or a capitalised initial is skipped.
 * 3. Runs of terminators collapse (`Wait...`, `Really?!`) into one boundary.
 * 4. Closing quotes/brackets may follow the terminator.
 * 5. The terminator must be followed by whitespace or the end of the input;
 *    `example.com` therefore stays in one piece.
 *
 * A blank line is also a hard boundary, and any trailing text with no
 * terminator at all counts as a final sentence.
 */
export function splitSentences(input: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const length = input.length;
  let cursor = 0;
  let i = 0;

  while (i < length) {
    const ch = input[i];

    if (TERMINATORS.has(ch)) {
      if (ch === '.') {
        const decimal =
          i > 0 && i + 1 < length && isDigitChar(input[i - 1]) && isDigitChar(input[i + 1]);
        if (decimal || endsWithAbbreviation(input, i)) {
          i += 1;
          continue;
        }
      }
      let end = i + 1;
      while (end < length && TERMINATORS.has(input[end])) end += 1;
      while (end < length && CLOSING_WRAPPERS.has(input[end])) end += 1;
      if (end >= length || isWhitespaceChar(input[end])) {
        pushSpan(input, spans, cursor, end);
        cursor = end;
      }
      i = end;
      continue;
    }

    if (ch === '\n') {
      let next = i + 1;
      while (next < length && (input[next] === ' ' || input[next] === '\t' || input[next] === '\r')) {
        next += 1;
      }
      if (next < length && input[next] === '\n') {
        pushSpan(input, spans, cursor, i);
        cursor = i;
        i = next + 1;
        continue;
      }
    }

    i += 1;
  }

  pushSpan(input, spans, cursor, length);
  return spans;
}

/** Number of sentences in `input`. `0` for empty or whitespace-only input. */
export function countSentences(input: string): number {
  return splitSentences(input).length;
}
