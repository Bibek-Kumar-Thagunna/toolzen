import test from 'node:test';
import assert from 'node:assert/strict';
// Node's own Base64 is the reference oracle for the parity test below. It is
// allowed here and nowhere else: the engine itself must stay isomorphic.
import { Buffer } from 'node:buffer';

import {
  base64ToBytes,
  bytesToBase64,
  decodeBase64,
  encodeBase64,
  encodeBytes,
  isProbablyText,
  looksLikeBase64,
} from './base64.ts';

/** Deterministic PRNG, so a parity failure is reproducible from the seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decodeText(input: string): { text: string; warnings: string[] } {
  const result = decodeBase64(input);
  assert.ok(result.ok, `expected "${input}" to decode`);
  return { text: result.text, warnings: result.warnings };
}

function decodeFailure(input: string): string {
  const result = decodeBase64(input);
  assert.equal(result.ok, false, `expected "${input}" to be rejected`);
  return result.ok ? '' : result.error;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

test('round-trips text outside the BMP', () => {
  for (const original of [
    '𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
    '👨‍👩‍👧‍👦',
    'naïve café — ½ price',
    'こんにちは世界',
    'Zero\u0000inside is still text?',
  ]) {
    const encoded = encodeBase64(original);
    assert.equal(decodeText(encoded).text, original, `failed for ${original}`);
  }
});

test('astral characters go through UTF-8, not UTF-16 code units', () => {
  // 𝔘 is U+1D518: four UTF-8 bytes. A charCodeAt-based encoder would emit the
  // two surrogates as two bytes and lose the character.
  assert.equal(encodeBase64('𝔘'), '8J2UmA==');
  assert.equal(decodeText('8J2UmA==').text, '𝔘');
});

test('the URL-safe alphabet works in both directions', () => {
  const raw = bytes(0xfb, 0xff, 0xbf);
  assert.equal(bytesToBase64(raw), '+/+/');
  assert.equal(bytesToBase64(raw, { urlSafe: true }), '-_-_');

  for (const encoded of ['+/+/', '-_-_']) {
    const decoded = base64ToBytes(encoded);
    assert.ok(decoded.ok, `expected ${encoded} to decode`);
    assert.deepEqual(decoded.bytes, raw);
  }
});

test('mixing the two alphabets decodes but is reported', () => {
  assert.equal(encodeBase64('~~~~~~'), 'fn5+fn5+');
  const mixed = decodeText('fn5-fn5+');
  assert.equal(mixed.text, '~~~~~~');
  assert.ok(
    mixed.warnings.some((warning) => warning.includes('mixes')),
    `expected a mixed-alphabet warning, got ${JSON.stringify(mixed.warnings)}`,
  );
  // One alphabet, used consistently, is not worth a warning.
  assert.deepEqual(decodeText('fn5+fn5+').warnings, []);
});

test('missing padding is repaired, with a warning', () => {
  const withPadding = encodeBase64('hello');
  assert.equal(withPadding, 'aGVsbG8=');

  const repaired = decodeText('aGVsbG8');
  assert.equal(repaired.text, 'hello');
  assert.ok(
    repaired.warnings.some((warning) => warning.includes('padding')),
    `expected a padding warning, got ${JSON.stringify(repaired.warnings)}`,
  );
  assert.deepEqual(decodeText(withPadding).warnings, []);

  // Two characters over needs two "=" back.
  assert.equal(decodeText('aGVsbG9vbw').text, 'hellooo');
  assert.equal(decodeText('aGk').text, 'hi');

  // Too much padding is also survivable.
  const overPadded = decodeText('aGk=====');
  assert.equal(overPadded.text, 'hi');
  assert.ok(overPadded.warnings.some((warning) => warning.includes('"="')));
});

test('noPadding and the urlSafe default control the trailing "="', () => {
  assert.equal(encodeBase64('hi'), 'aGk=');
  assert.equal(encodeBase64('hi', { noPadding: true }), 'aGk');
  // Base64URL is unpadded by convention, which is what web tokens expect.
  assert.equal(encodeBase64('hi', { urlSafe: true }), 'aGk');
  assert.equal(encodeBase64('hi', { urlSafe: true, noPadding: false }), 'aGk=');
});

test('a length that leaves one character over is rejected', () => {
  for (const broken of ['aGVsbG8gd', 'a', 'aaaaa']) {
    const error = decodeFailure(broken);
    assert.match(error, /cannot be Base64/);
    assert.match(error, /cut off/);
  }
  // The same length check applies to the byte decoder.
  const bytesResult = base64ToBytes('aGVsbG8gd');
  assert.equal(bytesResult.ok, false);
});

test('whitespace and line breaks anywhere are tolerated', () => {
  const original = 'The quick brown fox jumps over the lazy dog, twice over.';
  const encoded = encodeBase64(original);
  const scattered = `  ${encoded.slice(0, 10)}\n${encoded.slice(10, 20)}\r\n\t${encoded.slice(20)}  `;

  const decoded = decodeText(scattered);
  assert.equal(decoded.text, original);
  assert.ok(
    decoded.warnings.some((warning) => warning.includes('line breaks')),
    `expected a whitespace warning, got ${JSON.stringify(decoded.warnings)}`,
  );
});

test('wrapAt 76 produces MIME-shaped lines that still decode', () => {
  const original = 'x'.repeat(500);
  const wrapped = encodeBase64(original, { wrapAt: 76 });
  const lines = wrapped.split('\n');

  assert.ok(lines.length > 1, 'expected more than one line');
  for (const line of lines.slice(0, -1)) {
    assert.equal(line.length, 76);
  }
  const lastLine = lines[lines.length - 1] ?? '';
  assert.ok(lastLine.length > 0 && lastLine.length <= 76);
  assert.equal(decodeText(wrapped).text, original);

  // The legacy option spelling still works.
  assert.equal(encodeBase64(original, { lineBreaks: true }), wrapped);
  assert.equal(encodeBase64(original, { wrapAt: 0 }).includes('\n'), false);
  assert.equal(encodeBase64(original, { wrapAt: 4, lineEnding: '\r\n' }).split('\r\n')[0]?.length, 4);
});

test('a character in neither alphabet is a fatal, located error', () => {
  const error = decodeFailure('aGVsbG8*=');
  assert.match(error, /"\*" at position 8/);
  assert.match(error, /not a Base64 character/);
  assert.match(decodeFailure('aG\u0001sbG8='), /control character \(U\+0001\)/);
  assert.match(decodeFailure('aGVs=bG8='), /"=" at position 5 but the data carries on/);
});

/** The first eight bytes of every PNG file. Not valid UTF-8 at any offset. */
const PNG_MAGIC = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

test('binary data is refused as text but still available as bytes', () => {
  const encoded = bytesToBase64(PNG_MAGIC);
  assert.equal(encoded, 'iVBORw0KGgo=');

  const asText = decodeBase64(encoded);
  assert.equal(asText.ok, false, 'a PNG must not be shown as text');
  if (!asText.ok) {
    assert.match(asText.error, /file, not text/);
    assert.match(asText.error, /download as file/);
    // No mojibake: the message must not be the replacement character itself.
    assert.equal(asText.error.includes('�'), false);
  }

  const asBytes = base64ToBytes(encoded);
  assert.ok(asBytes.ok, 'the same input must still decode to bytes');
  assert.deepEqual(asBytes.bytes, PNG_MAGIC);

  assert.equal(isProbablyText(PNG_MAGIC), false);
  assert.equal(isProbablyText(new TextEncoder().encode('plain words')), true);
  assert.equal(isProbablyText(bytes()), true);
  assert.equal(isProbablyText(bytes(0x68, 0x00, 0x69)), false, 'a NUL means binary');
  assert.equal(isProbablyText(bytes(0xc3)), false, 'a truncated UTF-8 sequence is not text');
});

test('the empty string works in both directions', () => {
  assert.equal(encodeBase64(''), '');
  assert.equal(bytesToBase64(bytes()), '');
  const decoded = decodeText('');
  assert.equal(decoded.text, '');
  assert.deepEqual(decoded.warnings, []);
  const asBytes = base64ToBytes('');
  assert.ok(asBytes.ok);
  assert.equal(asBytes.bytes.length, 0);
  // Whitespace-only input is empty too, not an error.
  assert.equal(decodeText('   \n  ').text, '');
});

test('agrees with Node for 200 random byte arrays, in both directions', () => {
  const random = mulberry32(20260903);
  for (let run = 0; run < 200; run += 1) {
    const length = Math.floor(random() * 300);
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) data[i] = Math.floor(random() * 256);

    const reference = Buffer.from(data).toString('base64');
    const mine = bytesToBase64(data);
    assert.equal(mine, reference, `encode mismatch at run ${run}, length ${length}`);

    const decoded = base64ToBytes(mine);
    assert.ok(decoded.ok, `decode failed at run ${run}`);
    assert.deepEqual(
      Buffer.from(decoded.bytes),
      Buffer.from(data),
      `round-trip mismatch at run ${run}`,
    );

    // Base64URL parity too, since that is what tokens and data URIs use.
    const urlSafe = bytesToBase64(data, { urlSafe: true });
    assert.equal(urlSafe, Buffer.from(data).toString('base64url'), `base64url mismatch at run ${run}`);
    const fromUrlSafe = base64ToBytes(urlSafe);
    assert.ok(fromUrlSafe.ok);
    assert.deepEqual(Buffer.from(fromUrlSafe.bytes), Buffer.from(data));

    // encodeBytes is the same function under its original name.
    assert.equal(encodeBytes(data), mine);
  }
});

test('looksLikeBase64 is a useful guess rather than a validator', () => {
  assert.equal(looksLikeBase64('aGVsbG8='), true);
  assert.equal(looksLikeBase64('aGVsbG8'), true);
  assert.equal(looksLikeBase64('aGVs bG8g d29y bGQ='), true, 'wrapped Base64 still counts');
  assert.equal(looksLikeBase64('-_-_'), true);

  assert.equal(looksLikeBase64(''), false);
  assert.equal(looksLikeBase64('hi'), false, 'too short to be worth guessing');
  assert.equal(looksLikeBase64('hello world'), false, 'a space in the middle is not padding');
  assert.equal(looksLikeBase64('aaaaa'), false, 'impossible length');
  assert.equal(looksLikeBase64('aGVsbG8===='), false, 'more padding than Base64 allows');
  assert.equal(looksLikeBase64('café1234'), false);
  assert.equal(looksLikeBase64('{"a":1}'), false);
});
