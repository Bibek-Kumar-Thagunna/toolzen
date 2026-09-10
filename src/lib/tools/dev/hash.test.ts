import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';

import {
  ALGORITHM_NOTES,
  crc32,
  crc32Hex,
  HASH_ALGORITHMS,
  hashAll,
  hashBytes,
  hashText,
  hmac,
} from './hash.ts';
import type { HashAlgorithm } from './hash.ts';

/** `node:crypto` and `Buffer` are the oracle here, and are only used in this file. */
function nodeDigest(text: string, algorithm: string): string {
  return createHash(algorithm.replace('-', '').toLowerCase()).update(text, 'utf8').digest('hex');
}

function expectOk<T>(result: ({ ok: true } & T) | { ok: false; error: string }): { ok: true } & T {
  if (!result.ok) assert.fail(`expected success, got error: ${result.error}`);
  return result;
}

function expectFail(result: { ok: true } | { ok: false; error: string }): string {
  if (result.ok) assert.fail('expected a friendly error, got a result');
  return result.error;
}

test('the published test vectors come out exactly right', async () => {
  // FIPS 180-4 and RFC 3174 examples, the values every other implementation prints.
  const empty = expectOk(await hashText('', 'SHA-256'));
  assert.equal(empty.hex, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(empty.bytes, 0, 'bytes is the size of the input, not of the digest');

  const abc = expectOk(await hashText('abc', 'SHA-256'));
  assert.equal(abc.hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(abc.bytes, 3);

  assert.equal(expectOk(await hashText('abc', 'SHA-1')).hex, 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(
    expectOk(await hashText('abc', 'SHA-512')).hex,
    nodeDigest('abc', 'SHA-512'),
    'SHA-512 against node:crypto',
  );
  assert.equal(expectOk(await hashText('abc', 'SHA-384')).hex, nodeDigest('abc', 'SHA-384'));
});

test('text is hashed as UTF-8, so accents and emoji match every other tool', async () => {
  const text = 'héllo 👋';
  const result = expectOk(await hashText(text, 'SHA-256'));
  assert.equal(result.hex, nodeDigest(text, 'SHA-256'));
  assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'));
  assert.equal(result.bytes, 11, 'one for h, two for é, three letters, a space and four for the emoji');

  for (const sample of ['', 'a', 'Grüße', 'こんにちは', '👨‍👩‍👧‍👦', 'line\nbreak\ttab', ' ', '\u0000\u0001binary']) {
    for (const algorithm of HASH_ALGORITHMS) {
      const digest = expectOk(await hashText(sample, algorithm));
      assert.equal(digest.hex, nodeDigest(sample, algorithm), `${algorithm} of ${JSON.stringify(sample)}`);
      assert.equal(digest.bytes, Buffer.byteLength(sample, 'utf8'));
    }
  }
});

test('the digest is the right length, and the base64 is the same bytes', async () => {
  for (const algorithm of HASH_ALGORITHMS) {
    const result = expectOk(await hashText('the same input every time', algorithm));
    assert.equal(result.hex.length, ALGORITHM_NOTES[algorithm].bits / 4, `${algorithm} hex length`);
    assert.match(result.hex, /^[0-9a-f]+$/, 'lowercase hex, no prefix');
    assert.equal(result.base64, Buffer.from(result.hex, 'hex').toString('base64'), `${algorithm} base64`);
  }
});

test('hashing bytes and hashing text agree, and random buffers match node', async () => {
  const utf8 = expectOk(await hashText('abc', 'SHA-256'));
  const bytes = expectOk(await hashBytes(new TextEncoder().encode('abc'), 'SHA-256'));
  assert.equal(bytes.hex, utf8.hex);

  for (let i = 0; i < 50; i += 1) {
    const buffer = randomBytes(1 + Math.floor(Math.random() * 5000));
    const result = expectOk(await hashBytes(new Uint8Array(buffer), 'SHA-256'));
    assert.equal(result.hex, createHash('sha256').update(buffer).digest('hex'));
    assert.equal(result.bytes, buffer.length);
  }

  // An empty buffer is a real input, not a missing one.
  const empty = expectOk(await hashBytes(new Uint8Array(0), 'SHA-512'));
  assert.equal(empty.hex, createHash('sha512').update(Buffer.alloc(0)).digest('hex'));
  assert.equal(empty.bytes, 0);
});

test('hashAll gives all four digests of one input', async () => {
  const all = await hashAll('abc');
  assert.deepEqual(Object.keys(all).sort(), [...HASH_ALGORITHMS].sort(), 'every algorithm and no others');
  for (const algorithm of HASH_ALGORITHMS) {
    assert.equal(all[algorithm], nodeDigest('abc', algorithm), `${algorithm} in the table`);
  }
  assert.equal(new Set(Object.values(all)).size, 4, 'four different digests');
  const emptyInput = await hashAll('');
  assert.equal(emptyInput['SHA-256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('an algorithm this tool does not do is refused, and MD5 is named', async () => {
  for (const bogus of ['MD5', 'md5', 'SHA-224', 'SHA3-256', '', 'sha256']) {
    const error = expectFail(await hashText('abc', bogus as HashAlgorithm));
    assert.match(error, /SHA-1, SHA-256, SHA-384, SHA-512/, `${bogus} should list what is on offer`);
    assert.ok(error.includes(bogus), `the error should quote ${JSON.stringify(bogus)}`);
    assert.match(error, /MD5/, 'and should explain the one omission people ask about');
  }
  assert.match(expectFail(await hashBytes(new Uint8Array(1), 'MD5' as HashAlgorithm)), /MD5/);
  assert.match(expectFail(await hmac('abc', 'key', 'MD5' as HashAlgorithm)), /MD5/);
  assert.ok(!('MD5' in ALGORITHM_NOTES), 'MD5 must not be described as something this tool does');
});

test('the notes are honest about what these hashes are not for', () => {
  assert.deepEqual([...HASH_ALGORITHMS], ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
  const bits: Record<HashAlgorithm, number> = { 'SHA-1': 160, 'SHA-256': 256, 'SHA-384': 384, 'SHA-512': 512 };
  for (const algorithm of HASH_ALGORITHMS) {
    const note = ALGORITHM_NOTES[algorithm];
    assert.equal(note.label, algorithm);
    assert.equal(note.bits, bits[algorithm]);
    assert.equal(note.safeForPasswords, false, 'none of these is a password hash');
    assert.ok(note.note.length > 60, `${algorithm} needs a real explanation, not a label`);
  }
  assert.match(ALGORITHM_NOTES['SHA-1'].note, /broken/i, 'SHA-1 must not be presented as safe');
  assert.match(ALGORITHM_NOTES['SHA-1'].note, /collision/i);
  assert.match(ALGORITHM_NOTES['SHA-256'].note, /password/i, 'the default choice must warn about passwords');
});

test('hmac matches node:crypto for 50 random text and secret pairs', async () => {
  for (let i = 0; i < 50; i += 1) {
    const algorithm = HASH_ALGORITHMS[i % HASH_ALGORITHMS.length];
    const text = randomBytes(1 + Math.floor(Math.random() * 200)).toString('base64');
    const secret = randomBytes(1 + Math.floor(Math.random() * 64)).toString('hex');
    const result = expectOk(await hmac(text, secret, algorithm));
    const oracle = createHmac(algorithm.replace('-', '').toLowerCase(), secret).update(text, 'utf8');
    const expected = oracle.digest();
    assert.equal(result.hex, expected.toString('hex'), `${algorithm} hmac`);
    assert.equal(result.base64, expected.toString('base64'));
  }
});

test('hmac agrees with the RFC 4231 vectors, and is not just a hash', async () => {
  // Case 1: a 20-byte key of 0x0b. Those code points are all below 0x80, so the
  // UTF-8 of this string is exactly the 20 bytes the RFC specifies.
  const elevens = String.fromCharCode(11).repeat(20);
  assert.equal(Buffer.byteLength(elevens, 'utf8'), 20, 'the key has to be the RFC 20 bytes');
  assert.equal(
    expectOk(await hmac('Hi There', elevens, 'SHA-256')).hex,
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  );
  assert.equal(
    expectOk(await hmac('what do ya want for nothing?', 'Jefe', 'SHA-256')).hex,
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );

  const keyed = expectOk(await hmac('abc', 'secret', 'SHA-256')).hex;
  assert.notEqual(keyed, expectOk(await hashText('abc', 'SHA-256')).hex, 'the key has to matter');
  assert.notEqual(keyed, expectOk(await hmac('abc', 'secrets', 'SHA-256')).hex, 'one letter changes everything');
  assert.notEqual(keyed, expectOk(await hmac('abd', 'secret', 'SHA-256')).hex);

  const noKey = expectFail(await hmac('abc', '', 'SHA-256'));
  assert.match(noKey, /key/i, 'an empty key has to be explained, not crash');
  assert.match(noKey, /hash/i);
});

/** Bit-by-bit CRC-32, written the slow obvious way to check the table-driven one. */
function referenceCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

test('crc32 gives the values zip and gzip give', () => {
  assert.equal(crc32(utf8('The quick brown fox jumps over the lazy dog')), 0x414f_a339);
  assert.equal(crc32(utf8('123456789')), 0xcbf4_3926, 'the standard check value for CRC-32');
  assert.equal(crc32(utf8('a')), 0xe8b7_be43);
  assert.equal(crc32(utf8('')), 0, 'nothing in, nothing out');
  assert.equal(crc32Hex(utf8('The quick brown fox jumps over the lazy dog')), '414fa339');
  assert.equal(crc32Hex(utf8('')), '00000000', 'always eight digits, zero-padded');
  assert.equal(crc32Hex(utf8('123456789')), 'cbf43926');
});

test('crc32 matches a bit-by-bit implementation on 200 random buffers', () => {
  for (let i = 0; i < 200; i += 1) {
    const bytes = new Uint8Array(randomBytes(Math.floor(Math.random() * 300)));
    const value = crc32(bytes);
    assert.equal(value, referenceCrc32(bytes), `differed on ${Buffer.from(bytes).toString('hex')}`);
    assert.ok(value >= 0 && value <= 0xffff_ffff, 'unsigned, never a negative int32');
    assert.equal(crc32Hex(bytes), value.toString(16).padStart(8, '0'));
    assert.equal(crc32Hex(bytes).length, 8);
    assert.equal(crc32(bytes), value, 'the cached table must not change the answer');
  }
  // Every byte value, so no table entry goes unchecked.
  const allBytes = new Uint8Array(256).map((_, index) => index);
  assert.equal(crc32(allBytes), referenceCrc32(allBytes));
  assert.equal(crc32(new Uint8Array(1000)), referenceCrc32(new Uint8Array(1000)), 'a thousand zero bytes');
});

