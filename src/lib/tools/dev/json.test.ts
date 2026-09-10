import test from 'node:test';
import assert from 'node:assert/strict';

import type { JsonError, JsonFormatOptions, JsonStats } from './json.ts';
import {
  detectPrecisionLoss,
  escapeJsonPointer,
  formatJson,
  jsonStats,
  validateJson,
} from './json.ts';

/** Longest source line a snippet may show, plus the two ellipsis markers. */
const SNIPPET_LIMIT = 122;

/**
 * Invariants every reported error must satisfy. Checked for every rejection in
 * this file, so a regression in one message cannot hide behind a passing
 * assertion about a different one.
 */
function assertWellFormed(input: string, error: JsonError): void {
  assert.ok(error.message.endsWith('.'), `message is not a sentence: ${error.message}`);
  assert.ok(
    !error.message.includes('Unexpected token') && !/ at position \d/.test(error.message),
    `engine wording leaked into the message: ${error.message}`,
  );
  assert.ok(error.line >= 1, 'line must be 1-based');
  assert.ok(error.column >= 1, 'column must be 1-based');
  assert.ok(error.offset >= 0 && error.offset <= input.length, 'offset must be inside the input');
  const lines = error.snippet.split('\n');
  assert.equal(lines.length, 2, 'a snippet is a source line and a caret line');
  assert.ok(lines[0].length <= SNIPPET_LIMIT, `snippet line too long: ${lines[0].length}`);
  assert.ok(lines[1].endsWith('^'), 'the caret line must end with a caret');
  const under = lines[0][lines[1].indexOf('^')];
  if (under !== undefined) {
    assert.equal(under, input[error.offset], 'the caret must sit over the reported offset');
  }
}

function expectError(input: string): JsonError {
  const result = formatJson(input);
  if (result.ok) assert.fail(`expected a rejection, got: ${result.output}`);
  assertWellFormed(input, result.error);
  return result.error;
}

function expectOk(
  input: string,
  opts?: JsonFormatOptions,
): { output: string; stats: JsonStats; warnings: string[] } {
  const result = formatJson(input, opts);
  if (!result.ok) assert.fail(`expected valid JSON, got: ${result.error.message}`);
  return result;
}

function assertAt(error: JsonError, line: number, column: number, phrase: string): void {
  assert.ok(
    error.message.includes(phrase),
    `expected ${JSON.stringify(error.message)} to mention ${JSON.stringify(phrase)}`,
  );
  assert.equal(error.line, line, `wrong line for: ${error.message}`);
  assert.equal(error.column, column, `wrong column for: ${error.message}`);
  assert.equal(typeof error.hint, 'string', `no hint for: ${error.message}`);
}

/**
 * Every kind of problem the scanner names, on a multi-line input so the line
 * number is genuinely exercised rather than always being 1.
 */
const MULTILINE: Array<{ kind: string; input: string; line: number; column: number; phrase: string }> = [
  {
    kind: 'trailing comma before }',
    input: '{\n  "a": 1,\n  "b": 2,\n}\n',
    line: 3,
    column: 9,
    phrase: 'Trailing comma before "}"',
  },
  {
    kind: 'trailing comma before ]',
    input: '[\n  1,\n  2,\n]\n',
    line: 3,
    column: 4,
    phrase: 'Trailing comma before "]"',
  },
  {
    kind: 'single-quoted string',
    input: '{\n  "ok": 1,\n  \'bad\': 2\n}\n',
    line: 3,
    column: 3,
    phrase: 'Single quotes are not valid in JSON',
  },
  {
    kind: 'unquoted object key',
    input: '{\n  "ok": 1,\n  bad: 2\n}\n',
    line: 3,
    column: 3,
    phrase: 'Unquoted object key "bad"',
  },
  {
    kind: 'missing comma between array elements',
    input: '[\n  1,\n  2\n  3\n]\n',
    line: 4,
    column: 3,
    phrase: 'Missing comma between array elements',
  },
  {
    kind: 'missing comma between object members',
    input: '{\n  "a": 1\n  "b": 2\n}\n',
    line: 3,
    column: 3,
    phrase: 'Missing comma between object members',
  },
  {
    kind: 'unterminated string, reported where it started',
    input: '{\n  "a": "hello\n  "b": 2\n}\n',
    line: 2,
    column: 8,
    phrase: 'Unterminated string starting at line 2, column 8',
  },
  {
    kind: 'invalid escape sequence',
    input: '{\n  "ok": 1,\n  "bad": "a\\xb"\n}\n',
    line: 3,
    column: 12,
    phrase: 'Invalid escape sequence "\\x"',
  },
  {
    kind: 'literal NaN',
    input: '{\n  "a": 1,\n  "b": NaN\n}\n',
    line: 3,
    column: 8,
    phrase: '"NaN" is not valid JSON',
  },
  {
    kind: 'literal Infinity',
    input: '[\n  1,\n  Infinity\n]\n',
    line: 3,
    column: 3,
    phrase: '"Infinity" is not valid JSON',
  },
  {
    kind: 'literal -Infinity',
    input: '[\n  1,\n  -Infinity\n]\n',
    line: 3,
    column: 3,
    phrase: '"-Infinity" is not valid JSON',
  },
  {
    kind: 'literal undefined',
    input: '{\n  "a": undefined\n}\n',
    line: 2,
    column: 8,
    phrase: '"undefined" is not valid JSON',
  },
  {
    kind: 'line comment',
    input: '{\n  "a": 1,\n  // nope\n  "b": 2\n}\n',
    line: 3,
    column: 3,
    phrase: 'JSON does not support comments (found "//")',
  },
  {
    kind: 'block comment',
    input: '{\n  "a": 1,\n  /* nope */ "b": 2\n}\n',
    line: 3,
    column: 3,
    phrase: 'JSON does not support comments (found "/*")',
  },
  {
    kind: 'leading plus',
    input: '[\n  1,\n  +2\n]\n',
    line: 3,
    column: 3,
    phrase: 'Numbers cannot start with "+"',
  },
  {
    kind: 'bare .5',
    input: '[\n  1,\n  .5\n]\n',
    line: 3,
    column: 3,
    phrase: 'Numbers cannot start with "."',
  },
  {
    kind: 'leading zero',
    input: '{\n  "a": 1,\n  "b": 007\n}\n',
    line: 3,
    column: 8,
    phrase: 'Numbers cannot have leading zeros',
  },
  {
    kind: 'trailing content after a complete value',
    input: '{\n  "a": 1\n}\noops\n',
    line: 4,
    column: 1,
    phrase: 'Unexpected content after the JSON value ended',
  },
  {
    kind: 'unclosed container',
    input: '{\n  "a": [\n    1,\n    2\n}\n',
    line: 5,
    column: 1,
    phrase: 'Expected "]" to close the array opened at line 2, column 8',
  },
  {
    kind: 'unescaped control character',
    input: '{\n  "a": "tab\there"\n}\n',
    line: 2,
    column: 12,
    phrase: 'Unescaped control character U+0009',
  },
];

test('every named error kind: right line, right column, human message', () => {
  for (const item of MULTILINE) {
    const error = expectError(item.input);
    assertAt(error, item.line, item.column, item.phrase);
  }
  assert.equal(MULTILINE.length, 20, 'keep the coverage table complete');
});

test('trailing comma: caret sits on the comma, not on the brace', () => {
  const error = expectError('{"a":1,}');
  assertAt(error, 1, 7, 'Trailing comma before "}"');
  assert.equal(error.offset, 6);
  assert.equal(error.snippet, '{"a":1,}\n      ^');
});

test('single quotes are named, and the hint shows the fix', () => {
  const error = expectError("{'a':1}");
  assertAt(error, 1, 2, 'Single quotes are not valid in JSON');
  assert.equal(error.hint, 'Write "a" instead of \'a\'.');
});

test('unquoted key is named, with the key in the message', () => {
  const error = expectError('{a:1}');
  assertAt(error, 1, 2, 'Unquoted object key "a"');
});

test('missing comma between two members', () => {
  const error = expectError('{"a":1 "b":2}');
  assertAt(error, 1, 8, 'Missing comma between object members');
});

test('unterminated string reports the line the string started on', () => {
  const error = expectError('{"a":"oops}');
  assertAt(error, 1, 6, 'Unterminated string starting at line 1, column 6');
  assert.equal(error.offset, 5, 'the offset is the opening quote, not the end of input');
});

test('NaN is named rather than reported as a stray character', () => {
  const error = expectError('[1,2,NaN]');
  assertAt(error, 1, 6, '"NaN" is not valid JSON');
  assert.match(error.hint as string, /null/);
});

test('trailing content after a complete value', () => {
  const error = expectError('{"a":1} extra');
  assertAt(error, 1, 9, 'Unexpected content after the JSON value ended');
  assert.match(error.hint as string, /JSON Lines/);
});

test('empty input is called empty, not malformed', () => {
  const error = expectError('');
  assert.match(error.message, /empty/);
  assert.equal(error.line, 1);
  assert.equal(error.column, 1);
  assert.equal(error.offset, 0);
  const blank = expectError('\n\n   \t');
  assert.match(blank.message, /empty/);
  assert.equal(blank.line, 1);
  assert.equal(blank.column, 1);
});

test('the engine SyntaxError never reaches the caller', () => {
  const inputs = ['{"a":1,}', "{'a':1}", '{a:1}', '{"a":1 "b":2}', '[1,2,NaN]', '{', '[', ':', '&'];
  for (const input of inputs) {
    const error = expectError(input);
    let engine = '';
    try {
      JSON.parse(input);
    } catch (cause) {
      engine = (cause as Error).message;
    }
    assert.notEqual(error.message, engine, `passed the engine message through for ${input}`);
  }
});

test('duplicate keys parse, but the lost value is warned about by name', () => {
  const result = expectOk('{"a":1,"a":2}');
  assert.equal(result.output, '{\n  "a": 2\n}');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Duplicate object key "a"/);
  assert.match(result.warnings[0], /keeps only the last value/);
});

test('duplicate keys: nested, escaped, and same name in different objects', () => {
  const nested = expectOk('{\n  "a": 1,\n  "b": { "c": 1, "c": 2 }\n}');
  assert.equal(nested.warnings.length, 1);
  assert.match(nested.warnings[0], /"c"/);

  // "a" and "a" are the same member, so this is a duplicate too.
  const escaped = expectOk('{"a":1,"\\u0061":2}');
  assert.equal(escaped.warnings.length, 1);
  assert.match(escaped.warnings[0], /"a"/);

  // The same name in two different objects is not a duplicate.
  assert.deepEqual(expectOk('{"a":{"a":1},"b":{"a":2}}').warnings, []);
  assert.deepEqual(expectOk('[{"a":1},{"a":2}]').warnings, []);
  // A string value that looks like a repeated key must not trip the scanner.
  assert.deepEqual(expectOk('{"a":"a","b":"a"}').warnings, []);
});

test('a BOM is stripped and warned about instead of failing the parse', () => {
  const withBom = String.fromCharCode(0xfeff) + '{"a":1}';
  const result = expectOk(withBom);
  assert.equal(result.output, '{\n  "a": 1\n}');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /BOM/);
  // JSON.parse itself cannot cope with it, which is the whole point.
  assert.throws(() => JSON.parse(withBom));
});

test('precision loss is warned about with the literal and its position', () => {
  const result = expectOk('{\n  "id": 12345678901234567890\n}');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Precision loss/);
  assert.match(result.warnings[0], /12345678901234567890/);
  assert.match(result.warnings[0], /12345678901234567000/);
  assert.match(result.warnings[0], /line 2, column 9/);
});

/** Nested objects, arrays, unicode escapes, empties, null, negatives, exponents. */
const ROUND_TRIP = [
  '{',
  '  "nested": { "deep": { "deeper": [1, 2, [3, { "k": null }]] } },',
  '  "empty_object": {},',
  '  "empty_array": [],',
  '  "unicode": "caf\\u00e9 \\u2014 \\ud83d\\ude00 \\u0041",',
  '  "lone_surrogate": "\\ud800",',
  '  "escapes": "line\\nbreak\\ttab \\"quoted\\" back\\\\slash slash\\/x",',
  '  "nil": null,',
  '  "negative": -42.5,',
  '  "exponents": [1e21, -1.5e-7, 6.02e23, 0e0],',
  '  "flags": [true, false]',
  '}',
].join('\n');

test('pretty -> minify -> pretty is a fixed point', () => {
  const pretty = expectOk(ROUND_TRIP, { indent: 2 }).output;
  const minified = expectOk(pretty, { mode: 'minify' }).output;
  const again = expectOk(minified, { indent: 2 }).output;
  assert.equal(again, pretty, 'the second pretty pass must reproduce the first');

  const thirdCycle = expectOk(expectOk(again, { mode: 'minify' }).output, { indent: 2 }).output;
  assert.equal(thirdCycle, pretty, 'and it must stay put');
  assert.equal(expectOk(minified, { mode: 'minify' }).output, minified, 'minify is idempotent');
  assert.ok(!minified.includes('\n'), 'minified output has no newlines');

  // Round-tripping must not change any value, only the layout.
  assert.deepEqual(JSON.parse(minified), JSON.parse(ROUND_TRIP));
  assert.deepEqual(JSON.parse(pretty), JSON.parse(ROUND_TRIP));
});

test('formatting matches JSON.stringify byte for byte on shallow input', () => {
  // Negative zero is deliberately absent: `JSON.stringify` drops its sign and we
  // do not. See 'negative zero keeps its sign, unlike JSON.stringify' below.
  const fixtures = [
    ROUND_TRIP,
    '{}',
    '[]',
    'null',
    '0',
    '"plain"',
    '[[[[1]]]]',
    '{"":1,"2":2,"10":3,"a":{"b":[{}]}}',
    '[1e21,1e-7,123456789.123456,0.1,1.7976931348623157e308]',
    '{"ctrl":"a\\u0007b","slash":"a/b","emoji":"\\ud83d\\ude00"}',
  ];
  const options: Array<[JsonFormatOptions, number | string | undefined]> = [
    [{ indent: 2 }, 2],
    [{ indent: 4 }, 4],
    [{ indent: 'tab' }, '\t'],
    [{ indent: 0 }, 0],
    [{ indent: 99 }, 10],
    [{ mode: 'minify' }, undefined],
  ];
  for (const fixture of fixtures) {
    const value: unknown = JSON.parse(fixture);
    for (const [opts, gap] of options) {
      assert.equal(
        expectOk(fixture, opts).output,
        JSON.stringify(value, null, gap),
        `${fixture} with ${JSON.stringify(opts)}`,
      );
    }
  }
});

test('negative zero keeps its sign, unlike JSON.stringify', () => {
  // `JSON.stringify(-0)` is "0", so every formatter built on it silently changes
  // the value. Formatting must only change layout, never data.
  assert.equal(JSON.stringify(-0), '0', 'the reference implementation loses the sign');

  assert.equal(expectOk('-0', { mode: 'minify' }).output, '-0');
  assert.equal(expectOk('-0.0', { mode: 'minify' }).output, '-0');
  assert.equal(expectOk('{"a":-0,"b":0}', { mode: 'minify' }).output, '{"a":-0,"b":0}');
  assert.equal(expectOk('[-0.0e10]', { mode: 'minify' }).output, '[-0]');
  assert.equal(expectOk('-0', { indent: 2 }).output, '-0');

  // The whole point: the value survives a round trip, and the sign is real.
  assert.ok(Object.is(JSON.parse(expectOk('-0', { mode: 'minify' }).output), -0));
  assert.deepEqual(JSON.parse(expectOk('{"a":-0}').output), JSON.parse('{"a":-0}'));

  // Positive zero must not gain a sign, and -0 is not a precision loss.
  assert.equal(expectOk('[0,0.0,0e0]', { mode: 'minify' }).output, '[0,0,0]');
  assert.deepEqual(expectOk('-0', { mode: 'minify' }).warnings, []);
  assert.deepEqual(detectPrecisionLoss('-0'), []);
});

test('indent: 2, 4 and tab', () => {
  const input = '{"a":[1,{"b":2}]}';
  assert.equal(
    expectOk(input, { indent: 2 }).output,
    ['{', '  "a": [', '    1,', '    {', '      "b": 2', '    }', '  ]', '}'].join('\n'),
  );
  assert.equal(
    expectOk(input, { indent: 4 }).output,
    ['{', '    "a": [', '        1,', '        {', '            "b": 2', '        }', '    ]', '}'].join('\n'),
  );
  assert.equal(
    expectOk(input, { indent: 'tab' }).output,
    ['{', '\t"a": [', '\t\t1,', '\t\t{', '\t\t\t"b": 2', '\t\t}', '\t]', '}'].join('\n'),
  );
  assert.equal(expectOk(input, { indent: 2 }).output, expectOk(input).output, 'default is 2');
  assert.equal(expectOk(input, { indent: 0 }).output, input, 'zero indent collapses');
  assert.equal(expectOk(input, { indent: -5 }).output, input, 'negative indent is clamped to 0');
  assert.equal(
    expectOk(input, { indent: 99 }).output,
    expectOk(input, { indent: 10 }).output,
    'indent is capped at 10, as JSON.stringify does',
  );
  assert.equal(expectOk(input, { mode: 'minify', indent: 4 }).output, input, 'minify wins');
});

test('sortKeys sorts every level and leaves array order alone', () => {
  const input = '{"b":{"d":1,"c":{"z":1,"y":2}},"a":[{"q":1,"p":2},3,2,1]}';
  assert.equal(
    expectOk(input, { sortKeys: true, mode: 'minify' }).output,
    '{"a":[{"p":2,"q":1},3,2,1],"b":{"c":{"y":2,"z":1},"d":1}}',
  );
  assert.equal(expectOk(input, { mode: 'minify' }).output, input, 'unsorted keeps input order');
  assert.equal(
    expectOk(input, { sortKeys: true, indent: 2 }).output,
    expectOk(expectOk(input, { sortKeys: true, mode: 'minify' }).output, { indent: 2 }).output,
    'sorting is independent of indentation',
  );
});

test('sortKeys compares code units, so it is locale independent', () => {
  assert.equal(
    expectOk('{"10":1,"2":2,"a":3,"B":4,"":5}', { sortKeys: true, mode: 'minify' }).output,
    '{"":5,"10":1,"2":2,"B":4,"a":3}',
  );
});

test('stats count keys, containers, scalars and depth', () => {
  const input = '{"a":[1,2,{"b":null,"c":"x"}],"d":true}';
  const result = expectOk(input, { mode: 'minify' });
  assert.equal(result.output, input);
  assert.deepEqual(result.stats, {
    bytesIn: input.length,
    bytesOut: input.length,
    keys: 4,
    maxDepth: 3,
    arrays: 1,
    objects: 2,
    values: 5,
  });
});

test('jsonStats on scalars and empty containers', () => {
  assert.deepEqual(jsonStats(42, 1, 2), {
    bytesIn: 1,
    bytesOut: 2,
    keys: 0,
    maxDepth: 0,
    arrays: 0,
    objects: 0,
    values: 1,
  });
  assert.equal(jsonStats([], 0, 0).arrays, 1);
  assert.equal(jsonStats([], 0, 0).maxDepth, 1);
  assert.equal(jsonStats([], 0, 0).values, 0);
  assert.equal(jsonStats({}, 0, 0).objects, 1);
  assert.equal(jsonStats({}, 0, 0).keys, 0);
  assert.equal(jsonStats([[[]]], 0, 0).maxDepth, 3);
});

test('bytes are counted as UTF-8, not as UTF-16 code units', () => {
  assert.equal(expectOk('"café"').stats.bytesIn, 7, 'e-acute is two bytes');
  assert.equal(expectOk('"😀"').stats.bytesIn, 6, 'an emoji is four bytes');
  const bom = expectOk(String.fromCharCode(0xfeff) + '{"a":1}');
  assert.equal(bom.stats.bytesIn, 10, 'bytesIn counts the input as supplied, BOM included');
  assert.equal(bom.stats.bytesOut, bom.output.length);
});

test('maxDepth: 10,000 levels deep, without a stack overflow', () => {
  let value: unknown = 0;
  for (let i = 0; i < 10_000; i += 1) value = [value];
  const stats = jsonStats(value, 0, 0);
  assert.equal(stats.maxDepth, 10_000);
  assert.equal(stats.arrays, 10_000);
  assert.equal(stats.values, 1);
  assert.equal(stats.objects, 0);
});

test('a 10,000-deep array formats and validates, where JSON.stringify cannot', () => {
  const deep = '['.repeat(10_000) + '0' + ']'.repeat(10_000);
  const result = expectOk(deep, { mode: 'minify' });
  assert.equal(result.output, deep);
  assert.equal(result.stats.maxDepth, 10_000);

  const validated = validateJson(deep);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.stats.maxDepth, 10_000);

  // The reference implementation gives up long before this depth.
  assert.throws(() => JSON.stringify(JSON.parse(deep)), RangeError);
});

test('detectPrecisionLoss flags what a double cannot hold', () => {
  assert.deepEqual(detectPrecisionLoss('{"id": 12345678901234567890}'), [
    { literal: '12345678901234567890', parsedAs: '12345678901234567000', line: 1, column: 8 },
  ]);
  assert.deepEqual(detectPrecisionLoss('{"n": 0.1}'), [], '0.1 round-trips, so it is not flagged');
});

test('detectPrecisionLoss: no false positives for exact values', () => {
  const safe = '{"a":[1e2,1.50,-0,0,9007199254740994,1.7976931348623157e308,0.30000000000000004]}';
  assert.deepEqual(detectPrecisionLoss(safe), [], 'these all round-trip exactly');
  assert.deepEqual(
    detectPrecisionLoss('{"s":"12345678901234567890"}'),
    [],
    'a quoted big number is a string, not a number',
  );
});

test('detectPrecisionLoss: overflow, underflow, lost digits, and positions', () => {
  const found = detectPrecisionLoss('[\n  1e400,\n  1e-400,\n  9007199254740993,\n  0.1\n]');
  assert.deepEqual(found, [
    { literal: '1e400', parsedAs: 'Infinity', line: 2, column: 3 },
    { literal: '1e-400', parsedAs: '0', line: 3, column: 3 },
    { literal: '9007199254740993', parsedAs: '9007199254740992', line: 4, column: 3 },
  ]);
});

test('detectPrecisionLoss tolerates invalid JSON', () => {
  const found = detectPrecisionLoss('{"a": 12345678901234567890, oops');
  assert.equal(found.length, 1);
  assert.equal(found[0].literal, '12345678901234567890');
});

test('validateJson agrees with formatJson, and reports the minified size', () => {
  const valid = validateJson('{ "a" : [ 1 , 2 ] }');
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.stats.bytesIn, 19);
  assert.equal(valid.stats.bytesOut, 11, '{"a":[1,2]} minified');
  assert.equal(valid.stats.keys, 1);

  const invalid = validateJson('{\n  "a": 1,\n}');
  assert.equal(invalid.ok, false);
  if (invalid.ok) return;
  assert.equal(invalid.error.line, 2);
  assert.equal(invalid.error.column, 9);
  assert.deepEqual(invalid.error, expectError('{\n  "a": 1,\n}'));
});

test('snippet: caret under the column, tabs preserved for alignment', () => {
  const error = expectError('{\n  "a": 1,\n  "b": 007\n}');
  assert.equal(error.snippet, '  "b": 007\n       ^');
  assert.equal(error.snippet.split('\n')[1].indexOf('^') + 1, error.column);

  const tabbed = expectError('{\n\t\t"a" 1\n}');
  assert.equal(tabbed.snippet, '\t\t"a" 1\n\t\t    ^');
});

test('snippet: a very long line is windowed around the caret', () => {
  const input = `[${'1,'.repeat(200)}]`;
  const error = expectError(input);
  assert.match(error.message, /Trailing comma before "\]"/);
  const [source, caret] = error.snippet.split('\n');
  assert.ok(source.length <= SNIPPET_LIMIT, `windowed line is ${source.length} chars`);
  assert.ok(source.startsWith('…'), 'the elision is marked');
  assert.equal(source[caret.indexOf('^')], ',');
  assert.equal(source[caret.indexOf('^')], input[error.offset]);
});

test('escapeJsonPointer escapes ~ before /, per RFC 6901', () => {
  assert.equal(escapeJsonPointer('a/b'), 'a~1b');
  assert.equal(escapeJsonPointer('a~b'), 'a~0b');
  assert.equal(escapeJsonPointer('~1'), '~01', 'a literal ~1 must not decode back to /');
  assert.equal(escapeJsonPointer('a/b~/c'), 'a~1b~0~1c');
  assert.equal(escapeJsonPointer(''), '');
  assert.equal(escapeJsonPointer('plain key'), 'plain key');
});

test('valid documents are accepted without warnings', () => {
  const valid = [
    '{}',
    '[]',
    'null',
    'true',
    'false',
    '0',
    '-0',
    '1e-7',
    '"\\u0000"',
    '{"a":{"b":{"c":[]}}}',
    '[{"a":1},{"a":2}]',
    '\n\t {"a": 1} \r\n',
    '{"a":"\\\\"}',
    '{"key with / and ~":1}',
  ];
  for (const input of valid) {
    const result = formatJson(input, { mode: 'minify' });
    if (!result.ok) assert.fail(`${input} should be valid: ${result.error.message}`);
    assert.deepEqual(result.warnings, [], `${input} should not warn`);
    assert.deepEqual(JSON.parse(result.output), JSON.parse(input));
  }
});

test('a value at the top level does not need to be a container', () => {
  assert.equal(expectOk('  42  ').output, '42');
  assert.equal(expectOk('"x"', { indent: 4 }).output, '"x"');
  assert.equal(expectOk('null').stats.values, 1);
});

test('CRLF input is reported with the right line numbers', () => {
  const error = expectError('{\r\n  "a": 1,\r\n  "b": NaN\r\n}');
  assertAt(error, 3, 8, '"NaN" is not valid JSON');
  assert.equal(error.snippet.split('\n')[0], '  "b": NaN', 'the CR is not part of the line');
});
