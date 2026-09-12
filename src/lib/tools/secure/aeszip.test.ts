import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { decryptAesEntry, writeAesZip } from './aeszip.ts';

/**
 * The only question that matters about an encrypted archive is whether the
 * software on the recipient's computer opens it. Everything else is a proxy.
 *
 * So the tests below hand the bytes to **7-Zip** — the C++ implementation most
 * people on Windows and Linux actually use — and to **pyzipper**, a Python
 * library written by different people from a reading of the same
 * specification. Two independent readers agreeing that a file decrypts to the
 * right bytes is the proof; a structural assertion about byte offsets is not.
 *
 * Both are skipped rather than failed when absent: a missing developer tool is
 * not a defect in the writer.
 */

const OUT = mkdtempSync(join(tmpdir(), 'aeszip-'));

function has(command: string): boolean {
  return spawnSync('which', [command], { encoding: 'utf8' }).status === 0;
}

const HAS_7Z = has('7z');
const HAS_PYZIPPER =
  spawnSync('python3', ['-c', 'import pyzipper'], { encoding: 'utf8' }).status === 0;

const PASSWORD = 'correct horse battery staple';

/** A text file compresses; random bytes do not. Both paths need covering. */
const TEXT = Buffer.from('the quick brown fox. '.repeat(500), 'utf8');
const RANDOM = randomBytes(40_000);

async function lock(
  files: { name: string; bytes: Uint8Array }[],
  password = PASSWORD,
): Promise<Uint8Array> {
  const result = await writeAesZip(files, password);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.bytes : new Uint8Array();
}

function writeTo(name: string, bytes: Uint8Array): string {
  const path = join(OUT, name);
  writeFileSync(path, bytes);
  return path;
}

/* ── 7-Zip: the reader most recipients will have ───────────────────────── */

test(
  '7-Zip extracts a locked archive and the bytes come back identical',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const archive = writeTo(
      'seven.zip',
      await lock([
        { name: 'notes.txt', bytes: TEXT },
        { name: 'blob.bin', bytes: RANDOM },
      ]),
    );
    const dir = join(OUT, 'seven-out');
    const run = spawnSync('7z', ['x', archive, `-p${PASSWORD}`, `-o${dir}`, '-y'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `7z refused the archive:\n${run.stdout}\n${run.stderr}`);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'notes.txt'))), new Uint8Array(TEXT));
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'blob.bin'))), new Uint8Array(RANDOM));
    rmSync(dir, { recursive: true, force: true });
  },
);

test(
  '7-Zip reports AES-256 rather than the broken ZipCrypto',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const archive = writeTo('listed.zip', await lock([{ name: 'notes.txt', bytes: TEXT }]));
    const run = spawnSync('7z', ['l', '-slt', archive, `-p${PASSWORD}`], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /AES-256/, `7z did not report AES-256:\n${run.stdout}`);
    assert.doesNotMatch(run.stdout, /ZipCrypto/);
  },
);

test(
  '7-Zip rejects the wrong password rather than producing rubbish',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const archive = writeTo('wrong.zip', await lock([{ name: 'notes.txt', bytes: TEXT }]));
    const dir = join(OUT, 'wrong-out');
    const run = spawnSync('7z', ['x', archive, '-pnot-the-password', `-o${dir}`, '-y'], {
      encoding: 'utf8',
    });
    assert.notEqual(run.status, 0, 'a wrong password must fail, not extract garbage');
    rmSync(dir, { recursive: true, force: true });
  },
);

test(
  '7-Zip survives a unicode filename and a unicode password',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const password = 'пароль-密码-🔒';
    const archive = writeTo(
      'unicode.zip',
      await lock([{ name: '写真メモ.txt', bytes: TEXT }], password),
    );
    const dir = join(OUT, 'unicode-out');
    const run = spawnSync('7z', ['x', archive, `-p${password}`, `-o${dir}`, '-y'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, '写真メモ.txt'))), new Uint8Array(TEXT));
    rmSync(dir, { recursive: true, force: true });
  },
);

/* ── pyzipper: a second, unrelated implementation ──────────────────────── */

const PY_READ = `
import json, sys, hashlib
import pyzipper
with pyzipper.AESZipFile(sys.argv[1]) as zf:
    zf.setpassword(sys.argv[2].encode('utf-8'))
    out = {}
    for name in zf.namelist():
        data = zf.read(name)
        out[name] = {"sha": hashlib.sha256(data).hexdigest(), "len": len(data)}
    info = [{"name": i.filename, "compress_type": i.compress_type} for i in zf.infolist()]
print(json.dumps({"files": out, "info": info}))
`;

function pyRead(archive: string, password: string): Record<string, unknown> {
  const script = join(OUT, 'read-zip.py');
  writeFileSync(script, PY_READ);
  const run = spawnSync('python3', [script, archive, password], { encoding: 'utf8' });
  assert.equal(run.status, 0, `pyzipper failed:\n${run.stderr}`);
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test(
  'pyzipper reads back both a compressible and an incompressible file',
  { skip: HAS_PYZIPPER ? false : 'pyzipper is not installed' },
  async () => {
    const archive = writeTo(
      'py.zip',
      await lock([
        { name: 'notes.txt', bytes: TEXT },
        { name: 'blob.bin', bytes: RANDOM },
      ]),
    );
    const read = pyRead(archive, PASSWORD) as {
      files: Record<string, { sha: string; len: number }>;
    };
    assert.equal(read.files['notes.txt'].sha, sha256(new Uint8Array(TEXT)));
    assert.equal(read.files['blob.bin'].sha, sha256(new Uint8Array(RANDOM)));
  },
);

test(
  'a compressible file is actually deflated, and random data is not',
  { skip: HAS_PYZIPPER ? false : 'pyzipper is not installed' },
  async () => {
    const archive = writeTo(
      'methods.zip',
      await lock([
        { name: 'notes.txt', bytes: TEXT },
        { name: 'blob.bin', bytes: RANDOM },
      ]),
    );
    const read = pyRead(archive, PASSWORD) as {
      info: { name: string; compress_type: number }[];
    };
    const byName = new Map(read.info.map((i) => [i.name, i.compress_type]));
    // pyzipper reports the method recorded inside the AES extra field.
    assert.equal(byName.get('notes.txt'), 8, 'repetitive text should deflate');
    assert.equal(byName.get('blob.bin'), 0, 'random bytes should be stored, not grown');
  },
);

test(
  'pyzipper refuses a wrong password',
  { skip: HAS_PYZIPPER ? false : 'pyzipper is not installed' },
  async () => {
    const archive = writeTo('pywrong.zip', await lock([{ name: 'notes.txt', bytes: TEXT }]));
    const script = join(OUT, 'read-zip.py');
    writeFileSync(script, PY_READ);
    const run = spawnSync('python3', [script, archive, 'wrong'], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, 'pyzipper should have raised on a bad password');
  },
);

/* ── the reader in this module ─────────────────────────────────────────── */

/**
 * Pull one entry's payload straight out of an archive this module wrote, so the
 * decryptor can be exercised without the full ZIP reader. Local header layout:
 * 30 fixed bytes, then the name, then the extra field, then the payload.
 */
function firstPayload(archive: Uint8Array): { payload: Uint8Array; method: number } {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const compressedSize = view.getUint32(18, true);
  const extraAt = 30 + nameLength;
  const extra = archive.subarray(extraAt, extraAt + extraLength);
  const method = extra[9] | (extra[10] << 8);
  const at = extraAt + extraLength;
  return { payload: archive.subarray(at, at + compressedSize), method };
}

test('the module decrypts what it encrypted', async () => {
  const archive = await lock([{ name: 'notes.txt', bytes: TEXT }]);
  const { payload, method } = firstPayload(archive);
  const result = await decryptAesEntry(payload, PASSWORD, method, null);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (result.ok) assert.deepEqual(result.bytes, new Uint8Array(TEXT));
});

test('a wrong password is named as a wrong password', async () => {
  const archive = await lock([{ name: 'notes.txt', bytes: TEXT }]);
  const { payload, method } = firstPayload(archive);
  const result = await decryptAesEntry(payload, 'nope', method, null);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'password_protected');
    assert.match(result.error, /password/i);
  }
});

test('a single flipped byte is caught by the authentication code', async () => {
  const archive = await lock([{ name: 'blob.bin', bytes: RANDOM }]);
  const { payload, method } = firstPayload(archive);
  const tampered = Uint8Array.from(payload);
  // Past the salt and the password check, so the first two gates still pass.
  tampered[40] ^= 0x01;
  const result = await decryptAesEntry(tampered, PASSWORD, method, null);
  assert.equal(result.ok, false, 'a modified archive must not decrypt silently');
});

test('a truncated entry is refused rather than throwing', async () => {
  const result = await decryptAesEntry(new Uint8Array(8), PASSWORD, 0, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'corrupt_input');
});

test('an empty file survives the round trip', async () => {
  const archive = await lock([{ name: 'empty.txt', bytes: new Uint8Array(0) }]);
  const { payload, method } = firstPayload(archive);
  const result = await decryptAesEntry(payload, PASSWORD, method, null);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (result.ok) assert.equal(result.bytes.length, 0);
});

test('every archive uses a fresh salt, so two runs never match', async () => {
  const a = await lock([{ name: 'notes.txt', bytes: TEXT }]);
  const b = await lock([{ name: 'notes.txt', bytes: TEXT }]);
  assert.notEqual(sha256(a), sha256(b), 'a reused salt would leak that two files are identical');
});

test('locking with no files, or no password, is refused', async () => {
  const none = await writeAesZip([], PASSWORD);
  assert.equal(none.ok, false);
  const blank = await writeAesZip([{ name: 'a.txt', bytes: TEXT }], '');
  assert.equal(blank.ok, false);
});

test(
  'a file larger than one encryption slice still round-trips',
  async () => {
    // 3 MB crosses the 1 MB slice boundary twice, which is where a counter kept
    // as loop state instead of derived from position would drift.
    const big = randomBytes(3 * 1024 * 1024 + 7);
    const archive = await lock([{ name: 'big.bin', bytes: big }]);
    const { payload, method } = firstPayload(archive);
    const result = await decryptAesEntry(payload, PASSWORD, method, null);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    if (result.ok) assert.equal(sha256(result.bytes), sha256(new Uint8Array(big)));
  },
);
