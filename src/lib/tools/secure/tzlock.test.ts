import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { listZip, readZipEntry } from '../../files/unzip.ts';
import {
  readTzlock,
  readTzlockHeader,
  writeTzlock,
  TZLOCK_ITERATIONS,
  TZLOCK_VERSION,
} from './tzlock.ts';

/**
 * There is no second implementation of this format to check against — that is
 * the nature of a private container — so the tests do the next best thing and
 * attack it.
 *
 * Every byte of the header is flipped in turn to confirm the file then refuses
 * to open, which is the property the whole design rests on: an attacker who
 * can edit the file cannot lower the work factor, change the compression flag
 * or rewrite the hint and still have it decrypt. Then the inner archive is
 * handed to the ZIP reader, because the promise that a .tzlock unwraps to an
 * ordinary .zip is what keeps its contents recoverable without this site.
 */

const PASSWORD = 'a reasonably long passphrase';
const TEXT = Buffer.from('lock me away. '.repeat(300), 'utf8');
const RANDOM = randomBytes(20_000);

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function lock(password = PASSWORD, hint?: string): Promise<Uint8Array> {
  const result = await writeTzlock(
    [
      { name: 'notes.txt', bytes: new Uint8Array(TEXT) },
      { name: 'blob.bin', bytes: new Uint8Array(RANDOM) },
    ],
    password,
    hint === undefined ? {} : { hint },
  );
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.bytes : new Uint8Array();
}

/** Unlock, then unwrap the inner archive the way the tool does. */
async function unlockFiles(
  bytes: Uint8Array,
  password: string,
): Promise<Map<string, Uint8Array>> {
  const opened = await readTzlock(bytes, password);
  assert.equal(opened.ok, true, opened.ok ? '' : opened.error);
  if (!opened.ok) return new Map();
  const listed = listZip(opened.files[0].bytes);
  assert.equal(listed.ok, true, listed.ok ? '' : listed.error);
  const out = new Map<string, Uint8Array>();
  if (!listed.ok) return out;
  for (const entry of listed.entries) {
    const read = await readZipEntry(entry);
    assert.equal(read.ok, true, read.ok ? '' : read.error);
    if (read.ok) out.set(entry.name, read.bytes);
  }
  return out;
}

/* ── the round trip ────────────────────────────────────────────────────── */

test('files come back byte for byte', async () => {
  const files = await unlockFiles(await lock(), PASSWORD);
  assert.equal(files.size, 2);
  assert.equal(sha(files.get('notes.txt')!), sha(new Uint8Array(TEXT)));
  assert.equal(sha(files.get('blob.bin')!), sha(new Uint8Array(RANDOM)));
});

test('the contents are an ordinary zip, so the files are never trapped', async () => {
  const opened = await readTzlock(await lock(), PASSWORD);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const inner = opened.files[0].bytes;
  // "PK\x03\x04" — what every unzip program looks for.
  assert.deepEqual(Array.from(inner.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
});

test('a unicode password and filename survive', async () => {
  const password = 'пароль-密码-🔒';
  const result = await writeTzlock([{ name: '写真メモ.txt', bytes: new Uint8Array(TEXT) }], password);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const files = await unlockFiles(result.bytes, password);
  assert.equal(sha(files.get('写真メモ.txt')!), sha(new Uint8Array(TEXT)));
});

test('an empty file inside still round-trips', async () => {
  const result = await writeTzlock([{ name: 'empty.txt', bytes: new Uint8Array(0) }], PASSWORD);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const files = await unlockFiles(result.bytes, PASSWORD);
  assert.equal(files.get('empty.txt')?.length, 0);
});

/* ── the header ────────────────────────────────────────────────────────── */

test('the header is readable without the password', async () => {
  const bytes = await lock(PASSWORD, 'the usual one');
  const parsed = readTzlockHeader(bytes);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
  if (!parsed.ok) return;
  assert.equal(parsed.header.version, TZLOCK_VERSION);
  assert.equal(parsed.header.iterations, TZLOCK_ITERATIONS);
  assert.equal(parsed.header.hint, 'the usual one');
});

test('the work factor is stored, and is the one that was promised', async () => {
  const parsed = readTzlockHeader(await lock());
  assert.equal(parsed.ok, true);
  // The entire reason this format exists alongside the zip one: an AES zip is
  // frozen at 1000 rounds, and this is not.
  if (parsed.ok) assert.ok(parsed.header.iterations >= 600_000, 'the work factor must not regress');
});

test('a file that is not a .tzlock is named as such, not called corrupt', () => {
  const parsed = readTzlockHeader(new Uint8Array(randomBytes(500)));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.reason, 'unsupported_type');
    assert.match(parsed.error, /zip/i, 'the message should point at the other format');
  }
});

test('a too-short file is refused rather than throwing', () => {
  assert.equal(readTzlockHeader(new Uint8Array(4)).ok, false);
});

/* ── tampering ─────────────────────────────────────────────────────────── */

test('every byte of the header is authenticated', async () => {
  const original = await lock(PASSWORD, 'hint text');
  const parsed = readTzlockHeader(original);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const headerLength = parsed.header.headerBytes.length;

  let refused = 0;
  for (let at = 0; at < headerLength; at += 1) {
    const tampered = Uint8Array.from(original);
    tampered[at] ^= 0x01;
    const opened = await readTzlock(tampered, PASSWORD);
    assert.equal(opened.ok, false, `byte ${at} of the header was changed and the file still opened`);
    refused += 1;
  }
  assert.equal(refused, headerLength);
});

test('a flipped byte in the payload is caught', async () => {
  const original = await lock();
  const tampered = Uint8Array.from(original);
  tampered[original.length - 100] ^= 0x01;
  const opened = await readTzlock(tampered, PASSWORD);
  assert.equal(opened.ok, false, 'GCM should have rejected this');
});

test('truncating the file is caught', async () => {
  const original = await lock();
  const opened = await readTzlock(original.slice(0, original.length - 5), PASSWORD);
  assert.equal(opened.ok, false);
});

test('a wrong password is refused, and the message admits the ambiguity', async () => {
  const opened = await readTzlock(await lock(), 'not it');
  assert.equal(opened.ok, false);
  if (!opened.ok) {
    assert.equal(opened.reason, 'password_protected');
    // GCM cannot distinguish a wrong key from a modified file, and pretending
    // otherwise sends people to re-download a file that was fine.
    assert.match(opened.error, /altered/i);
  }
});

test('an absurd work factor is refused before the work is done', async () => {
  const original = await lock();
  const parsed = readTzlockHeader(original);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const tampered = Uint8Array.from(original);
  // The iteration count sits just after the magic and the four mode bytes.
  const at = 7 + 4;
  new DataView(tampered.buffer).setUint32(at, 500_000_000, true);
  const started = Date.now();
  const opened = await readTzlock(tampered, PASSWORD);
  assert.equal(opened.ok, false);
  assert.ok(Date.now() - started < 2000, 'it should refuse rather than grind for minutes');
});

/* ── refusals ──────────────────────────────────────────────────────────── */

test('locking nothing, or locking without a password, is refused', async () => {
  assert.equal((await writeTzlock([], PASSWORD)).ok, false);
  assert.equal((await writeTzlock([{ name: 'a', bytes: new Uint8Array(4) }], '')).ok, false);
});

test('two locks of the same files never produce the same bytes', async () => {
  assert.notEqual(sha(await lock()), sha(await lock()), 'a reused salt or nonce would be fatal');
});

test('a hint is optional and defaults to nothing', async () => {
  const parsed = readTzlockHeader(await lock());
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.header.hint, '');
});

test('an over-long hint is truncated rather than refused', async () => {
  const bytes = await lock(PASSWORD, 'x'.repeat(500));
  const parsed = readTzlockHeader(bytes);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.ok(parsed.header.hint.length <= 200);
});
