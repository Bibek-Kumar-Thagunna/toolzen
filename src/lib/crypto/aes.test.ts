import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { Aes256, ctrXor, AES_BLOCK_BYTES } from './aes.ts';

/**
 * A block cipher is either bit-for-bit correct or worthless — there is no
 * "nearly". So this file does not sample behaviour, it pins it:
 *
 *   1. The FIPS-197 appendix C.3 worked example, the vector the standard
 *      itself publishes for AES-256.
 *   2. The NIST SP 800-38A ECB-AES256 vectors.
 *   3. A hundred random key/block pairs compared against OpenSSL, which is a
 *      completely independent implementation.
 *   4. The CTR counter, checked against keystream computed by hand from the
 *      block function, because the little-endian counter is the one thing in
 *      the module that no published vector covers.
 */

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function unhex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function encrypt(keyHex: string, blockHex: string): string {
  const cipher = new Aes256(unhex(keyHex));
  const out = new Uint8Array(16);
  cipher.encryptBlock(unhex(blockHex), 0, out, 0);
  return hex(out);
}

/* ── the standard's own vector ─────────────────────────────────────────── */

test('FIPS-197 C.3: the AES-256 worked example', () => {
  assert.equal(
    encrypt(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      '00112233445566778899aabbccddeeff',
    ),
    '8ea2b7ca516745bfeafc49904b496089',
  );
});

/* ── NIST SP 800-38A, F.1.5 ECB-AES256.Encrypt ─────────────────────────── */

test('NIST SP 800-38A: all four ECB-AES256 vectors', () => {
  const key = '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4';
  const vectors = [
    ['6bc1bee22e409f96e93d7e117393172a', 'f3eed1bdb5d2a03c064b5a7e3db181f8'],
    ['ae2d8a571e03ac9c9eb76fac45af8e51', '591ccb10d410ed26dc5ba74a31362870'],
    ['30c81c46a35ce411e5fbc1191a0a52ef', 'b6ed21b99ca6f4f9f153e7b1beafed1d'],
    ['f69f2445df4f9b17ad2b417be66c3710', '23304b7a39f9f3ff067d8d8f9e24ecc7'],
  ];
  for (const [plain, expected] of vectors) {
    assert.equal(encrypt(key, plain), expected, `block ${plain}`);
  }
});

/* ── against an implementation that has never seen this code ───────────── */

const opensslAvailable = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

test(
  'agrees with OpenSSL on 100 random key and block pairs',
  { skip: opensslAvailable ? false : 'openssl is not installed' },
  () => {
    for (let i = 0; i < 100; i += 1) {
      const key = randomBytes(32);
      const block = randomBytes(16);
      // -nopad keeps OpenSSL from appending a padding block, so the output is
      // exactly the one block this cipher produces.
      const run = spawnSync(
        'openssl',
        ['enc', '-aes-256-ecb', '-nopad', '-K', hex(key), '-in', '-'],
        { input: block, maxBuffer: 1 << 20 },
      );
      assert.equal(run.status, 0, `openssl failed: ${String(run.stderr)}`);
      const theirs = hex(new Uint8Array(run.stdout));

      const out = new Uint8Array(16);
      new Aes256(key).encryptBlock(block, 0, out, 0);
      assert.equal(hex(out), theirs, `key ${hex(key)} block ${hex(block)}`);
    }
  },
);

/* ── the key schedule ──────────────────────────────────────────────────── */

test('a wrong-length key is refused rather than silently padded', () => {
  assert.throws(() => new Aes256(new Uint8Array(16)), RangeError);
  assert.throws(() => new Aes256(new Uint8Array(31)), RangeError);
  assert.throws(() => new Aes256(new Uint8Array(33)), RangeError);
});

test('an all-zero key still produces the published vector', () => {
  // From the AES-256 ECB "variable text" known-answer set.
  assert.equal(
    encrypt('0'.repeat(64), '80000000000000000000000000000000'),
    'ddc6bf790c15760d8d9aeb6f9a75fd4e',
  );
});

test('the same instance encrypts repeatedly without drifting', () => {
  const cipher = new Aes256(unhex('0'.repeat(64)));
  const out = new Uint8Array(16);
  const block = unhex('80000000000000000000000000000000');
  for (let i = 0; i < 5; i += 1) {
    cipher.encryptBlock(block, 0, out, 0);
    assert.equal(hex(out), 'ddc6bf790c15760d8d9aeb6f9a75fd4e', `run ${i}`);
  }
});

test('input and output may be the same array', () => {
  const cipher = new Aes256(unhex('0'.repeat(64)));
  const buffer = unhex('80000000000000000000000000000000');
  cipher.encryptBlock(buffer, 0, buffer, 0);
  assert.equal(hex(buffer), 'ddc6bf790c15760d8d9aeb6f9a75fd4e');
});

test('offsets address the right block in a longer buffer', () => {
  const cipher = new Aes256(unhex('0'.repeat(64)));
  const input = new Uint8Array(48);
  input.set(unhex('80000000000000000000000000000000'), 16);
  const output = new Uint8Array(48);
  cipher.encryptBlock(input, 16, output, 32);
  assert.equal(hex(output.subarray(32)), 'ddc6bf790c15760d8d9aeb6f9a75fd4e');
  assert.equal(hex(output.subarray(0, 32)), '0'.repeat(64), 'nothing else should be touched');
});

/* ── the little-endian counter ─────────────────────────────────────────── */

/** The keystream WinZip's counter produces, computed straight from the cipher. */
function expectedKeystream(key: Uint8Array, blocks: number): Uint8Array {
  const cipher = new Aes256(key);
  const out = new Uint8Array(blocks * AES_BLOCK_BYTES);
  for (let i = 1; i <= blocks; i += 1) {
    const counter = new Uint8Array(AES_BLOCK_BYTES);
    counter[0] = i & 0xff;
    counter[1] = (i >>> 8) & 0xff;
    counter[2] = (i >>> 16) & 0xff;
    counter[3] = (i >>> 24) & 0xff;
    cipher.encryptBlock(counter, 0, out, (i - 1) * AES_BLOCK_BYTES);
  }
  return out;
}

test('CTR starts at counter 1, not 0', () => {
  const key = randomBytes(32);
  const cipher = new Aes256(key);
  const data = new Uint8Array(16);
  ctrXor(cipher, data);

  const zeroCounter = new Uint8Array(16);
  const wrong = new Uint8Array(16);
  cipher.encryptBlock(zeroCounter, 0, wrong, 0);
  assert.notEqual(hex(data), hex(wrong), 'a counter starting at 0 is the classic off-by-one');
  assert.equal(hex(data), hex(expectedKeystream(key, 1)));
});

test('CTR carries into the second counter byte at block 256', () => {
  // 257 blocks forces the increment past 0xff, which a one-byte counter would
  // wrap and a big-endian counter would place at the other end of the block.
  const key = randomBytes(32);
  const blocks = 257;
  const data = new Uint8Array(blocks * 16);
  ctrXor(new Aes256(key), data);
  assert.equal(hex(data), hex(expectedKeystream(key, blocks)));
});

test('CTR is its own inverse', () => {
  const key = randomBytes(32);
  const original = randomBytes(1000);
  const data = Uint8Array.from(original);
  ctrXor(new Aes256(key), data);
  assert.notEqual(hex(data), hex(original), 'the ciphertext should not be the plaintext');
  ctrXor(new Aes256(key), data);
  assert.equal(hex(data), hex(original));
});

test('CTR handles a final partial block', () => {
  const key = randomBytes(32);
  // 35 bytes: two whole blocks and three bytes.
  const data = new Uint8Array(35);
  ctrXor(new Aes256(key), data);
  assert.equal(hex(data), hex(expectedKeystream(key, 3).subarray(0, 35)));
});

test('CTR in slices matches CTR in one pass', () => {
  const key = randomBytes(32);
  const whole = randomBytes(4099);
  const sliced = Uint8Array.from(whole);
  const once = Uint8Array.from(whole);

  ctrXor(new Aes256(key), once);

  const cipher = new Aes256(key);
  // Boundaries chosen to be block-aligned but not equal, which is how a
  // chunked run with a progress callback actually behaves.
  ctrXor(cipher, sliced, 0, 1024);
  ctrXor(cipher, sliced, 1024, 1040);
  ctrXor(cipher, sliced, 1040, 4099);
  assert.equal(hex(sliced), hex(once));
});

test('a slice that does not start on a block boundary is refused', () => {
  const cipher = new Aes256(randomBytes(32));
  assert.throws(() => ctrXor(cipher, new Uint8Array(64), 5, 64), RangeError);
});

test('an empty buffer is a no-op rather than an error', () => {
  ctrXor(new Aes256(randomBytes(32)), new Uint8Array(0));
});
