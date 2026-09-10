/**
 * JSON formatter / validator / minifier.
 *
 * Two things make this more than a wrapper around `JSON.parse`:
 *
 * 1. When parsing fails, the engine's `SyntaxError` is never surfaced. V8, JSC
 *    and SpiderMonkey word those differently (and disagree about the reported
 *    position), so instead a tolerant scanner re-walks the input and reports
 *    the first *named* problem — trailing comma, single quotes, unquoted key,
 *    comment, bad escape — with a line, a column, a caret snippet and a fix.
 * 2. Successful parses still carry warnings the language hides: a stripped BOM,
 *    duplicate object keys (`JSON.parse` silently keeps the last value, a real
 *    source of bugs) and numeric literals a double cannot hold.
 *
 * Isomorphic: no DOM, no Node-only globals. Nothing here recurses over user
 * data — a 10k-deep array must not blow the stack, and since V8's own
 * `JSON.stringify` gives up at roughly 5k, serialisation is iterative as well.
 */

export interface JsonError {
  /** A human sentence. Never a raw engine `SyntaxError` message. */
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based, counted in UTF-16 code units. */
  column: number;
  /** 0-based index into the input (after any BOM was stripped). */
  offset: number;
  /** The offending line, then a second line with a `^` under `column`. */
  snippet: string;
  /** How to fix it, when there is a specific fix worth naming. */
  hint?: string;
}

export interface JsonStats {
  bytesIn: number;
  bytesOut: number;
  /** Object keys, counted across every object (duplicates included). */
  keys: number;
  /** Container nesting depth: `1` for `[]`, `2` for `[[]]`, `0` for `42`. */
  maxDepth: number;
  arrays: number;
  objects: number;
  /** Scalars: strings, numbers, booleans and nulls. */
  values: number;
}

export type JsonFormatResult =
  | { ok: true; output: string; stats: JsonStats; warnings: string[] }
  | { ok: false; error: JsonError };

export interface JsonFormatOptions {
  /** Spaces per level (clamped to 0-10, as `JSON.stringify` does), or a tab. */
  indent?: number | 'tab';
  /** Sort object keys recursively. Arrays always keep their order. */
  sortKeys?: boolean;
  mode?: 'pretty' | 'minify';
}

const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_CR = 0x0d;
const CH_SPACE = 0x20;
const CH_QUOTE = 0x22;
const CH_PLUS = 0x2b;
const CH_COMMA = 0x2c;
const CH_MINUS = 0x2d;
const CH_DOT = 0x2e;
const CH_SLASH = 0x2f;
const CH_ZERO = 0x30;
const CH_COLON = 0x3a;
const CH_APOSTROPHE = 0x27;
const CH_STAR = 0x2a;
const CH_BACKSLASH = 0x5c;
const CH_OPEN_BRACE = 0x7b;
const CH_CLOSE_BRACE = 0x7d;
const CH_OPEN_BRACKET = 0x5b;
const CH_CLOSE_BRACKET = 0x5d;
const CH_LOWER_E = 0x65;
const CH_UPPER_E = 0x45;
const CH_LOWER_U = 0x75;
const CH_LOWER_X = 0x78;
const CH_UPPER_X = 0x58;
const BOM = 0xfeff;

/** The single-character escapes JSON allows after a backslash, plus `u`. */
const SIMPLE_ESCAPES = new Set<number>([0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74]);

const HINT_COMMENT =
  'JSON has no comments. Delete it, or strip comments first / use a JSONC-aware parser.';
const HINT_ESCAPE =
  'Inside a JSON string only \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX are valid. ' +
  'To keep a literal backslash, double it.';
const HINT_TRAILING =
  'A JSON document holds exactly one value. If this is JSON Lines / NDJSON, split on ' +
  'newlines and parse each line on its own.';

function isDigit(code: number): boolean {
  return code >= CH_ZERO && code <= 0x39;
}

function isHexDigit(code: number): boolean {
  return isDigit(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
}

/** Start of a bare word: what an unquoted key or a stray `NaN` looks like. */
function isWordStart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x24
  );
}

function isWordChar(code: number): boolean {
  return isWordStart(code) || isDigit(code);
}

function isWhitespace(code: number): boolean {
  return code === CH_SPACE || code === CH_TAB || code === CH_LF || code === CH_CR;
}

/** Could this character legally begin a JSON value? Used to tell a missing
 *  comma ("a value follows, you just forgot the separator") from junk. */
function canStartValue(code: number): boolean {
  return (
    code === CH_OPEN_BRACE ||
    code === CH_OPEN_BRACKET ||
    code === CH_QUOTE ||
    code === CH_APOSTROPHE ||
    code === CH_MINUS ||
    code === CH_PLUS ||
    code === CH_DOT ||
    isDigit(code) ||
    isWordStart(code)
  );
}

/** Render a character for a message without ever pasting a control code in. */
function describeChar(code: number): string {
  if (Number.isNaN(code)) return 'the end of the input';
  if (code >= CH_SPACE && code <= 0x7e) return `"${String.fromCharCode(code)}"`;
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * UTF-8 byte length without allocating a copy of the string. Lone surrogates
 * count as 3 bytes, which is what `TextEncoder` emits for them (U+FFFD).
 */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

interface Position {
  line: number;
  column: number;
  lineStart: number;
  lineEnd: number;
}

/** Offset -> line/column plus the bounds of that line. Only ever run once per
 *  error, so a linear count is fine and keeps the scanner state small. */
function locate(text: string, offset: number): Position {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i += 1) {
    const code = text.charCodeAt(i);
    if (code === CH_LF) {
      line += 1;
      lineStart = i + 1;
    } else if (code === CH_CR && text.charCodeAt(i + 1) !== CH_LF) {
      line += 1;
      lineStart = i + 1;
    }
  }
  let lineEnd = lineStart;
  while (lineEnd < text.length) {
    const code = text.charCodeAt(lineEnd);
    if (code === CH_LF || code === CH_CR) break;
    lineEnd += 1;
  }
  return { line, column: offset - lineStart + 1, lineStart, lineEnd };
}

const SNIPPET_WIDTH = 120;

/**
 * The offending line (windowed to 120 columns around the caret) and a caret
 * line under it. Tabs are copied into the padding rather than replaced with
 * spaces, so the caret stays aligned in a monospace view.
 */
function buildSnippet(lineText: string, column: number): string {
  let start = 0;
  let visible = lineText;
  let head = '';
  let tail = '';
  if (lineText.length > SNIPPET_WIDTH) {
    const centred = column - 1 - Math.floor(SNIPPET_WIDTH / 2);
    start = Math.max(0, Math.min(centred, lineText.length - SNIPPET_WIDTH));
    visible = lineText.slice(start, start + SNIPPET_WIDTH);
    if (start > 0) head = '…';
    if (start + SNIPPET_WIDTH < lineText.length) tail = '…';
  }
  const caretAt = Math.max(0, Math.min(column - 1 - start, visible.length));
  // One space stands in for the leading ellipsis so the caret keeps its column.
  let pad = head.length > 0 ? ' ' : '';
  for (let i = 0; i < caretAt; i += 1) {
    pad += visible.charCodeAt(i) === CH_TAB ? '\t' : ' ';
  }
  return `${head}${visible}${tail}\n${pad}^`;
}

function makeError(text: string, offset: number, message: string, hint?: string): JsonError {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const position = locate(text, clamped);
  const error: JsonError = {
    message,
    line: position.line,
    column: position.column,
    offset: clamped,
    snippet: buildSnippet(text.slice(position.lineStart, position.lineEnd), position.column),
  };
  if (hint !== undefined) error.hint = hint;
  return error;
}

function emptyInputError(text: string): JsonError {
  const message =
    text.length === 0
      ? 'The input is empty — there is nothing to format.'
      : 'The input is empty apart from whitespace.';
  return makeError(text, 0, message, 'The shortest valid JSON documents are {}, [], 0, null and "".');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk a parsed value with an explicit stack. Recursion here would cap the tool
 * at a few thousand levels of nesting, which real-world exports do reach.
 */
export function jsonStats(value: unknown, bytesIn: number, bytesOut: number): JsonStats {
  let keys = 0;
  let arrays = 0;
  let objects = 0;
  let values = 0;
  let maxDepth = 0;
  const pending: unknown[] = [value];
  const depths: number[] = [0];

  while (pending.length > 0) {
    const current = pending.pop();
    const depth = depths.pop() as number;
    if (Array.isArray(current)) {
      arrays += 1;
      const inner = depth + 1;
      if (inner > maxDepth) maxDepth = inner;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        pending.push(current[i]);
        depths.push(inner);
      }
    } else if (isRecord(current)) {
      objects += 1;
      const inner = depth + 1;
      if (inner > maxDepth) maxDepth = inner;
      const names = Object.keys(current);
      keys += names.length;
      for (let i = names.length - 1; i >= 0; i -= 1) {
        pending.push(current[names[i]]);
        depths.push(inner);
      }
    } else {
      values += 1;
    }
  }

  return { bytesIn, bytesOut, keys, maxDepth, arrays, objects, values };
}

/**
 * Key order for `sortKeys`. Deliberately a code-unit comparison rather than
 * `localeCompare`: the formatter must produce byte-identical output on every
 * machine, so `"10"` sorts before `"2"` and `"Z"` before `"a"`.
 */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function scalarToJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    // The one place this deliberately differs from `JSON.stringify`, which turns
    // -0 into "0" and quietly changes the value. A formatter must not do that;
    // "-0" is valid JSON and parses back to the same double.
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null'; // Unreachable: every value here came out of `JSON.parse`.
}

interface SerializeFrame {
  items: unknown[] | null;
  holder: Record<string, unknown> | null;
  names: string[] | null;
  index: number;
}

/**
 * `JSON.stringify` byte-for-byte, but iterative. V8's implementation is
 * recursive and throws `RangeError: Maximum call stack size exceeded` at around
 * 5,000 levels of nesting, which would turn a legitimately deep document into a
 * crash. Sorting happens here, at emit time, rather than by rebuilding the
 * objects — a rebuilt object cannot control the order of integer-like keys,
 * because the engine always enumerates those first, in numeric order.
 */
function serialize(root: unknown, gap: string, sortKeys: boolean): string {
  const out: string[] = [];
  const stack: SerializeFrame[] = [];
  const separator = gap.length > 0 ? ': ' : ':';
  let current: unknown = root;
  let writingValue = true;

  const breakLine = (): void => {
    if (gap.length > 0) out.push(`\n${gap.repeat(stack.length)}`);
  };

  for (;;) {
    if (writingValue) {
      if (Array.isArray(current)) {
        if (current.length === 0) {
          out.push('[]');
          writingValue = false;
          continue;
        }
        out.push('[');
        stack.push({ items: current, holder: null, names: null, index: 0 });
        breakLine();
        current = current[0];
        continue;
      }
      if (isRecord(current)) {
        const names = Object.keys(current);
        if (sortKeys) names.sort(compareKeys);
        if (names.length === 0) {
          out.push('{}');
          writingValue = false;
          continue;
        }
        out.push('{');
        stack.push({ items: null, holder: current, names, index: 0 });
        breakLine();
        out.push(JSON.stringify(names[0]), separator);
        current = current[names[0]];
        continue;
      }
      out.push(scalarToJson(current));
      writingValue = false;
      continue;
    }

    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    frame.index += 1;
    const length = frame.items !== null ? frame.items.length : (frame.names as string[]).length;
    if (frame.index >= length) {
      stack.pop();
      breakLine();
      out.push(frame.items !== null ? ']' : '}');
      continue;
    }
    out.push(',');
    breakLine();
    if (frame.items !== null) {
      current = frame.items[frame.index];
    } else {
      const name = (frame.names as string[])[frame.index];
      out.push(JSON.stringify(name), separator);
      current = (frame.holder as Record<string, unknown>)[name];
    }
    writingValue = true;
  }

  return out.join('');
}

interface ScanFrame {
  object: boolean;
  offset: number;
}

function fallbackError(text: string): JsonError {
  return makeError(
    text,
    0,
    'The input is not valid JSON, but no specific problem could be pinpointed.',
    'Look for mismatched brackets, or a stray character near the end of the document.',
  );
}

/**
 * Tolerant scanner. Walks the input with an explicit container stack and reports
 * the first violation it can *name*. It never inspects the engine's own
 * `SyntaxError`, whose text and position differ between V8, JSC and
 * SpiderMonkey. Called only after `JSON.parse` has already refused the input,
 * so it always returns an error.
 */
function locateProblem(text: string): JsonError {
  const n = text.length;
  let at = 0;

  function fail(offset: number, message: string, hint?: string): JsonError {
    return makeError(text, offset, message, hint);
  }

  /** Skips whitespace, and names the comments JSON does not have. */
  function skipTrivia(): JsonError | null {
    while (at < n) {
      const code = text.charCodeAt(at);
      if (isWhitespace(code)) {
        at += 1;
        continue;
      }
      if (code === CH_SLASH) {
        const next = text.charCodeAt(at + 1);
        if (next === CH_SLASH || next === CH_STAR) {
          const seen = next === CH_SLASH ? '//' : '/*';
          return fail(at, `JSON does not support comments (found "${seen}").`, HINT_COMMENT);
        }
      }
      return null;
    }
    return null;
  }

  /** Reported at the *opening* quote: that is the line the author cares about. */
  function unterminated(start: number): JsonError {
    const where = locate(text, start);
    return fail(
      start,
      `Unterminated string starting at line ${where.line}, column ${where.column} — ` +
        'no closing double quote.',
      'Add the missing ". A JSON string cannot span lines, so write a real line break as \\n.',
    );
  }

  /** `at` points at the opening quote; on success it lands past the closing one. */
  function scanString(): JsonError | null {
    const start = at;
    at += 1;
    while (at < n) {
      const code = text.charCodeAt(at);
      if (code === CH_QUOTE) {
        at += 1;
        return null;
      }
      if (code === CH_BACKSLASH) {
        if (at + 1 >= n) return unterminated(start);
        const escape = text.charCodeAt(at + 1);
        if (escape === CH_LOWER_U) {
          for (let k = 2; k <= 5; k += 1) {
            if (!isHexDigit(text.charCodeAt(at + k))) {
              return fail(
                at,
                'Invalid escape sequence: "\\u" must be followed by exactly four hexadecimal digits.',
                HINT_ESCAPE,
              );
            }
          }
          at += 6;
          continue;
        }
        if (SIMPLE_ESCAPES.has(escape)) {
          at += 2;
          continue;
        }
        const shown =
          escape >= CH_SPACE && escape <= 0x7e
            ? `"\\${String.fromCharCode(escape)}"`
            : `a backslash followed by ${describeChar(escape)}`;
        return fail(at, `Invalid escape sequence ${shown} in a string.`, HINT_ESCAPE);
      }
      if (code === CH_LF || code === CH_CR) return unterminated(start);
      if (code < CH_SPACE) {
        return fail(
          at,
          `Unescaped control character ${describeChar(code)} in a string.`,
          'Control characters must be escaped, e.g. \\t, \\n, \\r or \\u0000.',
        );
      }
      at += 1;
    }
    return unterminated(start);
  }

  function leadingDot(offset: number): JsonError {
    const negative = text.charCodeAt(offset) === CH_MINUS;
    const digitsFrom = offset + (negative ? 2 : 1);
    let end = digitsFrom;
    while (isDigit(text.charCodeAt(end))) end += 1;
    return fail(
      offset,
      'Numbers cannot start with "." in JSON.',
      `Write ${negative ? '-' : ''}0.${text.slice(digitsFrom, end)} instead.`,
    );
  }

  function leadingZero(start: number): JsonError {
    let end = start;
    if (text.charCodeAt(end) === CH_MINUS) end += 1;
    while (isDigit(text.charCodeAt(end))) end += 1;
    const literal = text.slice(start, end);
    return fail(
      start,
      'Numbers cannot have leading zeros in JSON.',
      `Write ${literal.replace(/^(-?)0+(?=\d)/, '$1')}, or quote it as "${literal}" to keep the zeros.`,
    );
  }

  /** `at` points at the first character of something number-shaped. */
  function scanNumber(): JsonError | null {
    const start = at;
    const first = text.charCodeAt(at);
    if (first === CH_PLUS) {
      return fail(at, 'Numbers cannot start with "+" in JSON.', 'Drop the leading plus sign.');
    }
    if (first === CH_DOT) return leadingDot(at);
    if (first === CH_MINUS) {
      at += 1;
      if (text.charCodeAt(at) === CH_DOT) return leadingDot(start);
      if (text.startsWith('Infinity', at)) return literalProblem('-Infinity', start);
      if (!isDigit(text.charCodeAt(at))) {
        return fail(
          start,
          `A "-" must be followed by a digit, but found ${describeChar(text.charCodeAt(at))}.`,
          'Write a number such as -1, or quote the value as a string.',
        );
      }
    }
    if (text.charCodeAt(at) === CH_ZERO) {
      at += 1;
      const next = text.charCodeAt(at);
      if (isDigit(next)) return leadingZero(start);
      if (next === CH_LOWER_X || next === CH_UPPER_X) {
        return fail(
          start,
          'JSON does not support hexadecimal numbers.',
          'Convert it to decimal, or quote it as a string.',
        );
      }
    } else {
      while (isDigit(text.charCodeAt(at))) at += 1;
    }
    if (text.charCodeAt(at) === CH_DOT) {
      at += 1;
      if (!isDigit(text.charCodeAt(at))) {
        return fail(
          at,
          'A decimal point must be followed by at least one digit.',
          'Write 1.0 rather than 1., or drop the decimal point.',
        );
      }
      while (isDigit(text.charCodeAt(at))) at += 1;
    }
    const marker = text.charCodeAt(at);
    if (marker === CH_LOWER_E || marker === CH_UPPER_E) {
      at += 1;
      const sign = text.charCodeAt(at);
      if (sign === CH_PLUS || sign === CH_MINUS) at += 1;
      if (!isDigit(text.charCodeAt(at))) {
        return fail(at, 'An exponent needs at least one digit.', 'Write 1e6 or 1e-6.');
      }
      while (isDigit(text.charCodeAt(at))) at += 1;
    }
    return null;
  }

  /** Bare words: the JavaScript and Python literals people paste by accident. */
  function literalProblem(word: string, offset: number): JsonError {
    if (word === 'NaN') {
      return fail(offset, '"NaN" is not valid JSON.', 'JSON has no NaN. Use null, or the string "NaN".');
    }
    if (word === 'Infinity' || word === '-Infinity') {
      return fail(
        offset,
        `"${word}" is not valid JSON.`,
        'JSON has no infinities. Use null, a string, or a large finite number.',
      );
    }
    if (word === 'undefined') {
      return fail(offset, '"undefined" is not valid JSON.', 'Use null, or leave the member out entirely.');
    }
    if (word === 'None') {
      return fail(offset, '"None" is a Python literal, not valid JSON.', 'JSON spells it null.');
    }
    if (word === 'True' || word === 'False' || word === 'TRUE' || word === 'FALSE') {
      return fail(
        offset,
        `JSON booleans are lowercase, so "${word}" is not valid.`,
        `Write ${word.toLowerCase()}.`,
      );
    }
    if (word === 'Null' || word === 'NULL' || word === 'nil') {
      return fail(offset, `JSON writes the empty value as lowercase null, so "${word}" is not valid.`, 'Write null.');
    }
    return fail(
      offset,
      `Unexpected bare word "${word}" — a value must be a string, number, object, array, ` +
        'true, false or null.',
      `If it is meant to be text, quote it: "${word}".`,
    );
  }

  /** `at` points at a word character. Consumes the word when it is a keyword. */
  function scanWord(): JsonError | null {
    const start = at;
    let end = at;
    while (end < n && isWordChar(text.charCodeAt(end))) end += 1;
    const word = text.slice(start, end);
    if (word === 'true' || word === 'false' || word === 'null') {
      at = end;
      return null;
    }
    return literalProblem(word, start);
  }

  function trailingComma(commaOffset: number, closer: string): JsonError {
    return fail(
      commaOffset,
      `Trailing comma before "${closer}".`,
      'JSON does not allow a comma after the last member. Remove it.',
    );
  }

  function singleQuoted(offset: number, what: 'key' | 'value'): JsonError {
    let end = offset + 1;
    let closed = false;
    while (end < n) {
      const code = text.charCodeAt(end);
      if (code === CH_LF || code === CH_CR) break;
      if (code === CH_APOSTROPHE) {
        closed = true;
        break;
      }
      end += 1;
    }
    const body = closed ? text.slice(offset + 1, end) : null;
    const hint =
      body !== null && !body.includes('"') && !body.includes('\\')
        ? `Write "${body}" instead of '${body}'.`
        : 'Replace the single quotes with double quotes.';
    return fail(
      offset,
      `Single quotes are not valid in JSON — ${what === 'key' ? 'keys' : 'strings'} must use ` +
        'double quotes.',
      hint,
    );
  }

  function unquotedKey(offset: number, end: number, numeric: boolean): JsonError {
    const name = text.slice(offset, end);
    return fail(
      offset,
      `Unquoted object key "${name}" — keys must be double-quoted strings in JSON` +
        (numeric ? ', even numeric ones.' : '.'),
      `Write "${name}": instead of ${name}:.`,
    );
  }

  function unclosed(frame: ScanFrame): JsonError {
    const where = locate(text, frame.offset);
    return fail(
      n,
      `Unexpected end of input — the ${frame.object ? 'object' : 'array'} opened at line ` +
        `${where.line}, column ${where.column} was never closed.`,
      `Add the missing "${frame.object ? '}' : ']'}".`,
    );
  }

  // __SCANNER_BODY__

  const stack: ScanFrame[] = [];
  let step: 'value' | 'key' | 'after' = 'value';
  /** Offset of the comma that led us into a value/key slot, else -1. */
  let commaAt = -1;

  for (;;) {
    // Where the previous token ended, so `[1x]` can be told from `[1 2]`.
    const tokenEnd = at;
    const trivia = skipTrivia();
    if (trivia !== null) return trivia;

    if (step === 'value') {
      const enclosing = stack[stack.length - 1];
      if (at >= n) {
        if (enclosing !== undefined) return unclosed(enclosing);
        return fail(n, 'Unexpected end of input — a value is missing.', 'Add the value.');
      }
      const code = text.charCodeAt(at);
      if (code === CH_OPEN_BRACE || code === CH_OPEN_BRACKET) {
        const object = code === CH_OPEN_BRACE;
        stack.push({ object, offset: at });
        at += 1;
        const inner = skipTrivia();
        if (inner !== null) return inner;
        if (text.charCodeAt(at) === (object ? CH_CLOSE_BRACE : CH_CLOSE_BRACKET)) {
          at += 1;
          stack.pop();
          step = 'after';
          continue;
        }
        commaAt = -1;
        step = object ? 'key' : 'value';
        continue;
      }
      if (code === CH_CLOSE_BRACKET || code === CH_CLOSE_BRACE) {
        const wantsBracket = code === CH_CLOSE_BRACKET;
        if (enclosing === undefined) {
          return fail(
            at,
            `Unexpected ${describeChar(code)} — no ${wantsBracket ? 'array' : 'object'} was opened.`,
            'Remove it, or open the container first.',
          );
        }
        if (enclosing.object === wantsBracket) {
          return fail(
            at,
            `Expected "${enclosing.object ? '}' : ']'}" to close the ` +
              `${enclosing.object ? 'object' : 'array'}, but found ${describeChar(code)}.`,
            `Match every "${enclosing.object ? '{' : '['}" with a "${enclosing.object ? '}' : ']'}".`,
          );
        }
        if (commaAt >= 0) return trailingComma(commaAt, wantsBracket ? ']' : '}');
        return enclosing.object
          ? fail(at, 'Missing value after ":".', 'Every object key needs a value: {"key": null}.')
          : fail(at, 'A value is missing before this "]".', 'Add the value, or remove the punctuation before it.');
      }
      if (code === CH_QUOTE) {
        const bad = scanString();
        if (bad !== null) return bad;
        step = 'after';
        continue;
      }
      if (code === CH_APOSTROPHE) return singleQuoted(at, 'value');
      if (code === CH_COMMA) {
        if (enclosing !== undefined && !enclosing.object) {
          return fail(
            at,
            'Missing value between two commas in an array.',
            'Remove the extra comma, or put a value between them. JSON arrays have no holes.',
          );
        }
        return fail(at, 'Unexpected "," where a value was expected.', 'Remove it.');
      }
      if (code === CH_COLON) {
        return fail(
          at,
          'Unexpected ":" where a value was expected.',
          'A colon belongs between an object key and its value.',
        );
      }
      if (isDigit(code) || code === CH_MINUS || code === CH_PLUS || code === CH_DOT) {
        const bad = scanNumber();
        if (bad !== null) return bad;
        step = 'after';
        continue;
      }
      if (isWordStart(code)) {
        const bad = scanWord();
        if (bad !== null) return bad;
        step = 'after';
        continue;
      }
      return fail(
        at,
        `Unexpected ${describeChar(code)} where a value was expected.`,
        'A value is a string, number, object, array, true, false or null.',
      );
    }

    if (step === 'key') {
      const enclosing = stack[stack.length - 1];
      if (at >= n) {
        return enclosing !== undefined
          ? unclosed(enclosing)
          : fail(n, 'Unexpected end of input — an object key is missing.', 'Add the key.');
      }
      const code = text.charCodeAt(at);
      if (code === CH_CLOSE_BRACE) {
        if (commaAt >= 0) return trailingComma(commaAt, '}');
        return fail(
          at,
          'Unexpected "}" where an object key was expected.',
          'Remove it, or add a "key": value pair.',
        );
      }
      if (code === CH_APOSTROPHE) return singleQuoted(at, 'key');
      if (code !== CH_QUOTE) {
        if (isWordStart(code)) {
          let end = at;
          while (end < n && isWordChar(text.charCodeAt(end))) end += 1;
          return unquotedKey(at, end, false);
        }
        if (isDigit(code) || code === CH_MINUS) {
          let end = at;
          if (code === CH_MINUS) end += 1;
          while (end < n && (isDigit(text.charCodeAt(end)) || text.charCodeAt(end) === CH_DOT)) {
            end += 1;
          }
          return unquotedKey(at, end, true);
        }
        if (code === CH_CLOSE_BRACKET) {
          return fail(
            at,
            'Expected "}" to close the object, but found "]".',
            'Match every "{" with a "}".',
          );
        }
        return fail(
          at,
          `Unexpected ${describeChar(code)} where an object key was expected.`,
          'Object keys are double-quoted strings: {"key": 1}.',
        );
      }
      const keyStart = at;
      const bad = scanString();
      if (bad !== null) return bad;
      const name = text.slice(keyStart + 1, at - 1);
      const afterKey = skipTrivia();
      if (afterKey !== null) return afterKey;
      if (text.charCodeAt(at) !== CH_COLON) {
        return fail(at, `Missing ":" after the object key "${name}".`, `Write "${name}": value.`);
      }
      at += 1;
      commaAt = -1;
      step = 'value';
      continue;
    }

    const open = stack[stack.length - 1];
    if (open === undefined) {
      if (at >= n) return fallbackError(text);
      return fail(at, 'Unexpected content after the JSON value ended.', HINT_TRAILING);
    }
    if (at >= n) return unclosed(open);
    const code = text.charCodeAt(at);
    if (code === CH_COMMA) {
      commaAt = at;
      at += 1;
      step = open.object ? 'key' : 'value';
      continue;
    }
    if (code === (open.object ? CH_CLOSE_BRACE : CH_CLOSE_BRACKET)) {
      at += 1;
      stack.pop();
      step = 'after';
      continue;
    }
    if (code === CH_CLOSE_BRACE || code === CH_CLOSE_BRACKET) {
      const where = locate(text, open.offset);
      return fail(
        at,
        `Expected "${open.object ? '}' : ']'}" to close the ${open.object ? 'object' : 'array'} ` +
          `opened at line ${where.line}, column ${where.column}, but found ${describeChar(code)}.`,
        `Match every "${open.object ? '{' : '['}" with a "${open.object ? '}' : ']'}".`,
      );
    }
    if (code === CH_COLON) {
      return fail(
        at,
        'Unexpected ":" — a comma or a closing bracket was expected here.',
        'A colon belongs between an object key and its value, and only once per member.',
      );
    }
    if (at === tokenEnd && (isWordChar(code) || code === CH_DOT)) {
      return fail(
        at,
        `Unexpected ${describeChar(code)} immediately after a value.`,
        'Values are separated by commas. If these characters belong to the value, quote the ' +
          'whole thing as a string.',
      );
    }
    if (canStartValue(code)) {
      return fail(
        at,
        open.object ? 'Missing comma between object members.' : 'Missing comma between array elements.',
        open.object
          ? 'Separate members with a comma: {"a": 1, "b": 2}.'
          : 'Separate elements with a comma: [1, 2].',
      );
    }
    return fail(
      at,
      `Unexpected ${describeChar(code)} after a value.`,
      open.object
        ? 'Object members are separated by commas and the object is closed with "}".'
        : 'Array elements are separated by commas and the array is closed with "]".',
    );
  }
}

/** From an opening quote to just past the closing one. Tolerates anything. */
function skipStringLoose(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === CH_BACKSLASH) {
      i += 2;
      continue;
    }
    if (code === CH_QUOTE) return i + 1;
    i += 1;
  }
  return i;
}

/** End offset of the number-shaped run starting at `start`. */
function numberEnd(text: string, start: number): number {
  let i = start;
  const first = text.charCodeAt(i);
  if (first === CH_MINUS || first === CH_PLUS) i += 1;
  while (isDigit(text.charCodeAt(i))) i += 1;
  if (text.charCodeAt(i) === CH_DOT) {
    i += 1;
    while (isDigit(text.charCodeAt(i))) i += 1;
  }
  const marker = text.charCodeAt(i);
  if (marker === CH_LOWER_E || marker === CH_UPPER_E) {
    let j = i + 1;
    const sign = text.charCodeAt(j);
    if (sign === CH_PLUS || sign === CH_MINUS) j += 1;
    if (isDigit(text.charCodeAt(j))) {
      i = j;
      while (isDigit(text.charCodeAt(i))) i += 1;
    }
  }
  return i;
}

/**
 * Canonical form of a decimal literal: sign, significant digits with no leading
 * or trailing zeros, and a power of ten. Two literals share a key exactly when
 * they denote the same rational, so `1e2`, `100` and `100.00` all collapse to
 * `1e2` and none of them counts as precision loss.
 */
function decimalKey(literal: string): string {
  let body = literal;
  let sign = '';
  if (body.startsWith('-')) {
    sign = '-';
    body = body.slice(1);
  } else if (body.startsWith('+')) {
    body = body.slice(1);
  }
  let exponent = 0;
  const marker = body.search(/[eE]/);
  if (marker >= 0) {
    exponent = Number(body.slice(marker + 1));
    body = body.slice(0, marker);
  }
  if (!Number.isFinite(exponent)) return literal;
  const dot = body.indexOf('.');
  let digits = body;
  if (dot >= 0) {
    digits = body.slice(0, dot) + body.slice(dot + 1);
    exponent -= body.length - dot - 1;
  }
  let lead = 0;
  while (lead < digits.length && digits.charCodeAt(lead) === CH_ZERO) lead += 1;
  digits = digits.slice(lead);
  let tail = digits.length;
  while (tail > 0 && digits.charCodeAt(tail - 1) === CH_ZERO) {
    tail -= 1;
    exponent += 1;
  }
  digits = digits.slice(0, tail);
  return digits.length === 0 ? '0' : `${sign}${digits}e${exponent}`;
}

/** `null` when the literal survives `JSON.parse`, else how it comes back. */
function precisionLossOf(literal: string): string | null {
  const value = Number(literal);
  // A malformed literal is a syntax problem, reported by the scanner, not here.
  if (Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) return String(value);
  const rendered = String(value);
  if (rendered === literal) return null;
  return decimalKey(literal) === decimalKey(rendered) ? null : rendered;
}

export interface PrecisionLoss {
  literal: string;
  parsedAs: string;
  line: number;
  column: number;
}

/**
 * Numeric literals that a double cannot hold: 64-bit ids past 2^53, decimals
 * with more significant digits than 17, and literals that overflow to Infinity
 * or underflow to zero. Literals that merely *look* different after parsing
 * (`1e2` -> `100`, `1.50` -> `1.5`) are not reported: nothing is lost there.
 *
 * Runs over the raw text and skips string contents, so a quoted big number is
 * correctly left alone. Tolerant of invalid JSON.
 */
export function detectPrecisionLoss(input: string): PrecisionLoss[] {
  const text = stripBom(input);
  const found: PrecisionLoss[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === CH_QUOTE) {
      i = skipStringLoose(text, i);
      continue;
    }
    if (isWordStart(code)) {
      while (i < n && isWordChar(text.charCodeAt(i))) i += 1;
      continue;
    }
    const next = text.charCodeAt(i + 1);
    const numeric = isDigit(code) || (code === CH_MINUS && (isDigit(next) || next === CH_DOT));
    if (!numeric) {
      i += 1;
      continue;
    }
    const start = i;
    i = numberEnd(text, i);
    const literal = text.slice(start, i);
    const parsedAs = precisionLossOf(literal);
    if (parsedAs !== null) {
      const where = locate(text, start);
      found.push({ literal, parsedAs, line: where.line, column: where.column });
    }
  }
  return found;
}

interface DuplicateFrame {
  object: boolean;
  keys: Set<string> | null;
  expectKey: boolean;
}

/**
 * Names of keys that appear more than once inside the same object, in the order
 * they were first duplicated. `JSON.parse` keeps only the last value and reports
 * nothing, so the raw text is the only place this is visible.
 *
 * Only meaningful for text that already parsed. Keys are compared after
 * unescaping, because "a" and "a" name the same member.
 */
function collectDuplicateKeys(text: string): string[] {
  const duplicates: string[] = [];
  const reported = new Set<string>();
  const frames: DuplicateFrame[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const code = text.charCodeAt(i);
    if (code === CH_QUOTE) {
      const end = skipStringLoose(text, i);
      const frame = frames[frames.length - 1];
      if (frame !== undefined && frame.object && frame.expectKey && frame.keys !== null) {
        const token = text.slice(i, end);
        let name: string;
        try {
          name = JSON.parse(token) as string;
        } catch {
          name = token;
        }
        if (frame.keys.has(name)) {
          if (!reported.has(name)) {
            reported.add(name);
            duplicates.push(name);
          }
        } else {
          frame.keys.add(name);
        }
        frame.expectKey = false;
      }
      i = end;
      continue;
    }
    if (code === CH_OPEN_BRACE) {
      frames.push({ object: true, keys: new Set<string>(), expectKey: true });
    } else if (code === CH_OPEN_BRACKET) {
      frames.push({ object: false, keys: null, expectKey: false });
    } else if (code === CH_CLOSE_BRACE || code === CH_CLOSE_BRACKET) {
      frames.pop();
    } else if (code === CH_COMMA) {
      const frame = frames[frames.length - 1];
      if (frame !== undefined && frame.object) frame.expectKey = true;
    }
    i += 1;
  }
  return duplicates;
}

/** JSON whitespace only: an NBSP is not blank, it is an invalid character. */
function isBlank(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (!isWhitespace(text.charCodeAt(i))) return false;
  }
  return true;
}

function resolveGap(opts: JsonFormatOptions): string {
  if (opts.mode === 'minify') return '';
  const indent = opts.indent ?? 2;
  if (indent === 'tab') return '\t';
  if (!Number.isFinite(indent)) return '  ';
  return ' '.repeat(Math.min(10, Math.max(0, Math.floor(indent))));
}

function explainParseFailure(text: string, cause: unknown): JsonError {
  if (cause instanceof RangeError) {
    return makeError(
      text,
      0,
      'The JSON is nested too deeply for this engine to parse.',
      'Split or flatten the document; JavaScript engines cap how deep JSON.parse will go.',
    );
  }
  return locateProblem(text);
}

/** Enough to be useful, few enough that one bad file cannot flood the UI. */
const MAX_WARNINGS_PER_KIND = 20;

function collectWarnings(text: string, warnings: string[]): void {
  const duplicates = collectDuplicateKeys(text);
  for (const name of duplicates.slice(0, MAX_WARNINGS_PER_KIND)) {
    warnings.push(
      `Duplicate object key "${name}" — JSON.parse keeps only the last value, so the earlier ` +
        'one is silently discarded.',
    );
  }
  if (duplicates.length > MAX_WARNINGS_PER_KIND) {
    warnings.push(`...and ${duplicates.length - MAX_WARNINGS_PER_KIND} more duplicate keys.`);
  }

  const losses = detectPrecisionLoss(text);
  for (const loss of losses.slice(0, MAX_WARNINGS_PER_KIND)) {
    warnings.push(
      `Precision loss: the number ${loss.literal} at line ${loss.line}, column ${loss.column} ` +
        `is parsed as ${loss.parsedAs}. A double holds about 15-17 significant digits, so ` +
        'JSON.parse cannot round-trip it. Quote it as a string to keep every digit.',
    );
  }
  if (losses.length > MAX_WARNINGS_PER_KIND) {
    warnings.push(`...and ${losses.length - MAX_WARNINGS_PER_KIND} more inexact numbers.`);
  }
}

/**
 * Pretty-print or minify. `stats.bytesIn` counts the input exactly as supplied,
 * BOM included; `bytesOut` counts `output`. Positions inside `error` are
 * relative to the text with any BOM removed.
 */
export function formatJson(input: string, opts: JsonFormatOptions = {}): JsonFormatResult {
  const bytesIn = utf8Length(input);
  const text = stripBom(input);
  const warnings: string[] = [];
  if (text !== input) {
    warnings.push(
      'A byte order mark (BOM) was removed from the start of the input. JSON.parse rejects it, ' +
        'so the positions reported by this tool refer to the text without it.',
    );
  }
  if (isBlank(text)) return { ok: false, error: emptyInputError(text) };

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    return { ok: false, error: explainParseFailure(text, cause) };
  }

  const output = serialize(value, resolveGap(opts), opts.sortKeys === true);
  collectWarnings(text, warnings);
  return { ok: true, output, stats: jsonStats(value, bytesIn, utf8Length(output)), warnings };
}

/**
 * Validate without producing formatted output. `stats.bytesOut` is the minified
 * size, so a caller can show "would shrink to N bytes" without formatting twice.
 */
export function validateJson(
  input: string,
): { ok: true; stats: JsonStats } | { ok: false; error: JsonError } {
  const bytesIn = utf8Length(input);
  const text = stripBom(input);
  if (isBlank(text)) return { ok: false, error: emptyInputError(text) };
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    return { ok: false, error: explainParseFailure(text, cause) };
  }
  return { ok: true, stats: jsonStats(value, bytesIn, utf8Length(serialize(value, '', false))) };
}

/** RFC 6901 escaping for one JSON Pointer segment. `~` first, then `/`. */
export function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}
