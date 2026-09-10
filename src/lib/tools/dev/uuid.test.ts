import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateNanoId,
  generateObjectId,
  generateUuid,
  generateUuids,
  inspectUuid,
  MAX_UUID,
  NIL_UUID,
} from './uuid.ts';

/** RFC 4122 v4: version nibble is 4, variant nibble is 8, 9, a or b. */
const V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function expectFail(result: { ok: true } | { ok: false; error: string }): string {
  if (result.ok) assert.fail('expected a friendly error, got a result');
  return result.error;
}

test('5000 v4 UUIDs are all unique and all RFC-shaped', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i += 1) {
    const uuid = generateUuid('v4');
    assert.match(uuid, V4_PATTERN);
    assert.equal(uuid[14], '4', 'version nibble');
    assert.ok('89ab'.includes(uuid[19]), `variant nibble was ${uuid[19]}`);
    seen.add(uuid);
  }
  assert.equal(seen.size, 5000, 'a repeat in 5000 draws would mean the randomness is broken');
});

test('v4 is the default, and inspect agrees about the version and variant', () => {
  const info = inspectUuid(generateUuid());
  assert.equal(info.valid, true);
  assert.equal(info.version, 4);
  assert.equal(info.variant, 'RFC 4122');
  assert.equal(info.timestamp, null, 'v4 carries no time');
  assert.match(info.note, /random/);
});

test('1000 v7 UUIDs come out in order and carry the time they were made', () => {
  const before = Date.now();
  const uuids: string[] = [];
  for (let i = 0; i < 1000; i += 1) uuids.push(generateUuid('v7'));
  const after = Date.now();

  for (let i = 1; i < uuids.length; i += 1) {
    assert.ok(
      uuids[i - 1] < uuids[i],
      `plain string sort must follow creation order: ${uuids[i - 1]} then ${uuids[i]}`,
    );
  }
  for (const uuid of uuids) {
    assert.match(uuid, ANY_UUID_PATTERN);
    assert.equal(uuid[14], '7');
    assert.ok('89ab'.includes(uuid[19]));
    const info = inspectUuid(uuid);
    assert.equal(info.version, 7);
    assert.equal(info.variant, 'RFC 4122');
    assert.ok(info.timestamp !== null, 'v7 must give its timestamp back');
    const recovered = Date.parse(info.timestamp ?? '');
    assert.ok(
      recovered >= before - 2000 && recovered <= after + 2000,
      `recovered ${info.timestamp}, which is not within 2s of now`,
    );
  }
  assert.equal(new Set(uuids).size, 1000);
});

test('v7 timestamps survive a round trip through the 48-bit field', () => {
  const uuid = '0192f0e5-4c37-7b6d-8b1c-2f0a7d3e5c91';
  const info = inspectUuid(uuid);
  assert.equal(info.version, 7);
  assert.equal(info.timestamp, new Date(0x0192f0e54c37).toISOString());
});

test('inspectUuid reads every way people write a UUID', () => {
  const canonical = '0192f0e5-4c37-7b6d-8b1c-2f0a7d3e5c91';
  const forms = [
    canonical,
    `  ${canonical}  `,
    canonical.toUpperCase(),
    `{${canonical}}`,
    `{${canonical.toUpperCase()}}`,
    canonical.replace(/-/g, ''),
    canonical.replace(/-/g, '').toUpperCase(),
    `urn:uuid:${canonical}`,
    `URN:UUID:${canonical.toUpperCase()}`,
    `{${canonical.replace(/-/g, '')}}`,
  ];
  for (const form of forms) {
    const info = inspectUuid(form);
    assert.equal(info.valid, true, `should have read ${form}`);
    assert.equal(info.normalised, canonical, `normalised form of ${form}`);
    assert.equal(info.version, 7);
  }
});

test('the nil and max UUIDs are recognised as themselves', () => {
  assert.equal(generateUuid('nil'), NIL_UUID);
  assert.equal(generateUuid('max'), MAX_UUID);

  const nil = inspectUuid(NIL_UUID);
  assert.equal(nil.valid, true);
  assert.equal(nil.isNil, true);
  assert.equal(nil.isMax, false);
  assert.equal(nil.version, null);
  assert.equal(nil.timestamp, null);
  assert.match(nil.note, /nil/i);

  const max = inspectUuid('{FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF}');
  assert.equal(max.valid, true);
  assert.equal(max.isMax, true);
  assert.equal(max.isNil, false);
  assert.equal(max.version, null);
  assert.equal(max.normalised, MAX_UUID);
});

test('input that is not a UUID is rejected with something readable', () => {
  const rejects = [
    '',
    '   ',
    'hello',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    '0192f0e5-4c37-7b6d-8b1c-2f0a7d3e5c9', // 31 digits
    '0192f0e5-4c37-7b6d-8b1c-2f0a7d3e5c911', // 33 digits
  ];
  for (const value of rejects) {
    const info = inspectUuid(value);
    assert.equal(info.valid, false, `should have rejected ${JSON.stringify(value)}`);
    assert.equal(info.normalised, '');
    assert.ok(info.note.length > 10, 'the note has to explain itself');
  }
  // Right digits, dashes in the wrong places: worth its own sentence.
  const misgrouped = inspectUuid('0192f0e-54c37-7b6d-8b1c-2f0a7d3e5c91');
  assert.equal(misgrouped.valid, false);
  assert.match(misgrouped.note, /dashes/);
});

test('unusual but well-formed UUIDs are described rather than rejected', () => {
  // Variant bits `110`: a Microsoft-era GUID.
  const microsoft = inspectUuid('0192f0e5-4c37-4b6d-cb1c-2f0a7d3e5c91');
  assert.equal(microsoft.valid, true);
  assert.equal(microsoft.variant, 'Microsoft GUID');
  assert.match(microsoft.note, /variant/);

  // Version 9 does not exist.
  const madeUp = inspectUuid('0192f0e5-4c37-9b6d-8b1c-2f0a7d3e5c91');
  assert.equal(madeUp.valid, true);
  assert.equal(madeUp.version, 9);
  assert.match(madeUp.note, /not a version/);

  // A real v1, from RFC 9562's own examples.
  const v1 = inspectUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846');
  assert.equal(v1.version, 1);
  assert.equal(v1.timestamp, '2022-02-22T19:22:22.000Z');
});

test('the batch size has bounds, and says why in English', () => {
  for (const bad of [0, -1, -10000, 2.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 10_001, 1e9]) {
    const error = expectFail(generateUuids(bad));
    assert.ok(error.length > 10, `error for ${bad} was too terse: ${error}`);
    assert.ok(!/NaN|undefined/.test(error), `errors must never leak internals: ${error}`);
  }
  assert.match(expectFail(generateUuids(10_001)), /10,000/);
  assert.match(expectFail(generateUuids(2.5)), /whole number/);

  const one = generateUuids(1);
  assert.ok(one.ok && one.uuids.length === 1);
  const many = generateUuids(10_000);
  assert.ok(many.ok && many.uuids.length === 10_000, 'the cap itself must be allowed');
  if (many.ok) assert.equal(new Set(many.uuids).size, 10_000);
});

test('the written form follows the options', () => {
  const plain = generateUuids(1);
  assert.ok(plain.ok && ANY_UUID_PATTERN.test(plain.uuids[0]));

  const upper = generateUuids(2, { uppercase: true });
  assert.ok(upper.ok);
  if (upper.ok) for (const value of upper.uuids) assert.match(value, /^[0-9A-F-]{36}$/);

  const braced = generateUuids(1, { braces: true });
  assert.ok(braced.ok);
  if (braced.ok) assert.match(braced.uuids[0], /^\{[0-9a-f-]{36}\}$/);

  const bare = generateUuids(1, { noHyphens: true });
  assert.ok(bare.ok);
  if (bare.ok) assert.match(bare.uuids[0], /^[0-9a-f]{32}$/);

  const everything = generateUuids(1, { braces: true, noHyphens: true, uppercase: true, version: 'v7' });
  assert.ok(everything.ok);
  if (everything.ok) {
    assert.match(everything.uuids[0], /^\{[0-9A-F]{32}\}$/);
    // Every written form has to inspect back to the same value.
    assert.equal(inspectUuid(everything.uuids[0]).version, 7);
  }

  const nils = generateUuids(3, { version: 'nil' });
  assert.ok(nils.ok);
  if (nils.ok) assert.deepEqual(nils.uuids, [NIL_UUID, NIL_UUID, NIL_UUID]);
});

const NANO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Sum of (observed - expected)^2 / expected. Small means the draws look uniform. */
function chiSquare(counts: Map<string, number>, total: number): number {
  const expected = total / counts.size;
  let sum = 0;
  for (const observed of counts.values()) sum += (observed - expected) ** 2 / expected;
  return sum;
}

test('nanoid uses its alphabet, its length, and no character more than the rest', () => {
  const counts = new Map<string, number>();
  let drawn = 0;
  while (drawn < 100_000) {
    const id = generateNanoId();
    assert.equal(id.length, 21, 'the default length is 21 characters');
    for (const character of id) {
      assert.ok(NANO_ALPHABET.includes(character), `${character} is not in the alphabet`);
      counts.set(character, (counts.get(character) ?? 0) + 1);
      drawn += 1;
    }
  }
  assert.equal(counts.size, 64, 'all 64 symbols should turn up in 100k draws');
  const expected = drawn / counts.size;
  for (const [character, observed] of counts) {
    assert.ok(
      Math.abs(observed - expected) < expected * 0.15,
      `${character} came up ${observed} times, expected about ${Math.round(expected)}`,
    );
  }
  // 63 degrees of freedom: a fair generator lands under 150 essentially always.
  assert.ok(chiSquare(counts, drawn) < 150, `chi-square ${chiSquare(counts, drawn)} looks skewed`);
});

test('a 10-symbol alphabet stays flat, which is where modulo bias would show', () => {
  // 256 is not a multiple of 10, so `byte % 10` would favour 0-5 by about 4%.
  // With 100k draws that is a 4-sigma tilt per digit and chi-square catches it.
  const counts = new Map<string, number>();
  let drawn = 0;
  while (drawn < 100_000) {
    for (const character of generateNanoId(50, '0123456789')) {
      assert.ok('0123456789'.includes(character));
      counts.set(character, (counts.get(character) ?? 0) + 1);
      drawn += 1;
    }
  }
  assert.equal(counts.size, 10);
  assert.ok(chiSquare(counts, drawn) < 45, `chi-square ${chiSquare(counts, drawn)} on 9 df says biased`);
});

test('nanoid corrects arguments it cannot honour', () => {
  assert.equal(generateNanoId(1).length, 1);
  assert.equal(generateNanoId(0).length, 1, 'a zero-length id is no id at all');
  assert.equal(generateNanoId(-5).length, 1);
  assert.equal(generateNanoId(7.9).length, 7, 'truncated, not rounded up');
  assert.equal(generateNanoId(10_000).length, 512, 'clamped to the cap');
  assert.equal(generateNanoId(Number.NaN).length, 21);
  assert.equal(generateNanoId(10, 'x').length, 10, 'a one-symbol alphabet falls back');
  assert.match(generateNanoId(10, 'x'), /^[0-9A-Za-z_-]{10}$/);
  assert.match(generateNanoId(30, 'aaab'), /^[ab]{30}$/, 'repeats are de-duplicated, not weighted');
  assert.match(generateNanoId(16, '0123456789abcdef'), /^[0-9a-f]{16}$/);
});

test('objectIds are 24 hex characters, in order, stamped with now', () => {
  const ids: string[] = [];
  for (let i = 0; i < 500; i += 1) ids.push(generateObjectId());
  const now = Math.floor(Date.now() / 1000);
  for (const id of ids) {
    assert.equal(id.length, 24);
    assert.match(id, /^[0-9a-f]{24}$/);
    const seconds = parseInt(id.slice(0, 8), 16);
    assert.ok(Math.abs(seconds - now) <= 5, `${id} says ${seconds}, now is ${now}`);
  }
  assert.equal(new Set(ids).size, 500);
  // The invariant is the counter, which moves by exactly one per id (and wraps at
  // 2^24, as Mongo's own drivers do). Two ids made in the same second therefore
  // differ, and sorting them sorts by creation order.
  const counters = ids.map((id) => parseInt(id.slice(18), 16));
  for (let i = 1; i < counters.length; i += 1) {
    assert.equal(counters[i], (counters[i - 1] + 1) % 0x100_0000, `counter jumped at ${i}`);
  }
  // The middle five bytes are fixed per process, as Mongo's own drivers do.
  const machine = ids.map((id) => id.slice(8, 18));
  assert.equal(new Set(machine).size, 1);
});
