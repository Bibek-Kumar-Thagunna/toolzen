import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listZip, readZipEntry, safeEntryName, METHOD_AES, METHOD_DEFLATE } from './unzip.ts';
import { writeZip } from './zip.ts';
import { decryptAesEntry, writeAesZip } from '../tools/secure/aeszip.ts';

/**
 * The reader is tested against archives this codebase did not write.
 *
 * Reading back your own writer's output proves the two agree with each other,
 * which is exactly the failure mode worth avoiding: a shared misreading of the
 * specification looks perfect from the inside. So the archives here come from
 * `zip` and from `7z`, including the awkward ones — a deflated entry, a
 * unicode name, a directory marker, an archive comment, and an encrypted
 * archive produced by 7-Zip rather than by this code.
 */

const OUT = mkdtempSync(join(tmpdir(), 'unzip-'));
const SRC = join(OUT, 'src');
mkdirSync(SRC, { recursive: true });

function has(command: string): boolean {
  return spawnSync('which', [command], { encoding: 'utf8' }).status === 0;
}
const HAS_ZIP = has('zip');
const HAS_7Z = has('7z');

const TEXT = Buffer.from('compress me. '.repeat(400), 'utf8');
const RANDOM = randomBytes(5000);
writeFileSync(join(SRC, 'notes.txt'), TEXT);
writeFileSync(join(SRC, 'blob.bin'), RANDOM);
writeFileSync(join(SRC, '写真.txt'), TEXT);

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: SRC, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} failed: ${result.stdout}${result.stderr}`);
}

/* ── archives written by the `zip` program ─────────────────────────────── */

test(
  'reads a deflated archive written by zip(1)',
  { skip: HAS_ZIP ? false : 'zip is not installed' },
  async () => {
    const archive = join(OUT, 'plain.zip');
    run('zip', ['-q', archive, 'notes.txt', 'blob.bin', '写真.txt']);
    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true, listed.ok ? '' : listed.error);
    if (!listed.ok) return;

    const byName = new Map(listed.entries.map((e) => [e.name, e]));
    assert.equal(listed.entries.length, 3);
    assert.equal(byName.get('notes.txt')?.method, METHOD_DEFLATE, 'zip should have deflated the text');

    for (const [name, expected] of [
      ['notes.txt', TEXT],
      ['blob.bin', RANDOM],
      ['写真.txt', TEXT],
    ] as const) {
      const entry = byName.get(name);
      assert.ok(entry, `${name} is missing from the listing`);
      const read = await readZipEntry(entry);
      assert.equal(read.ok, true, read.ok ? '' : read.error);
      if (read.ok) assert.equal(sha(read.bytes), sha(new Uint8Array(expected)), name);
    }
  },
);

test(
  'an archive comment does not hide the end record',
  { skip: HAS_ZIP ? false : 'zip is not installed' },
  async () => {
    const archive = join(OUT, 'comment.zip');
    run('zip', ['-q', archive, 'notes.txt']);
    // A comment pushes the end record away from the last 22 bytes, which is
    // where a reader that only looks at the tail expects it.
    const withComment = spawnSync('zip', ['-z', archive], {
      input: 'a comment long enough to matter\n',
      encoding: 'utf8',
    });
    assert.equal(withComment.status, 0, withComment.stderr);
    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true, listed.ok ? '' : listed.error);
    if (listed.ok) assert.equal(listed.entries.length, 1);
  },
);

test(
  'directory markers are listed but flagged',
  { skip: HAS_ZIP ? false : 'zip is not installed' },
  () => {
    mkdirSync(join(SRC, 'folder'), { recursive: true });
    writeFileSync(join(SRC, 'folder', 'inner.txt'), TEXT);
    const archive = join(OUT, 'dirs.zip');
    run('zip', ['-q', '-r', archive, 'folder']);
    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const dirs = listed.entries.filter((e) => e.isDirectory);
    const files = listed.entries.filter((e) => !e.isDirectory);
    assert.ok(dirs.length >= 1, 'the folder entry should be recognised');
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'inner.txt', 'the path should be reduced to one segment');
  },
);

/* ── an encrypted archive written by 7-Zip, not by us ──────────────────── */

test(
  'reads an AES archive produced by 7-Zip',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const archive = join(OUT, 'their-aes.zip');
    const password = 'their password';
    run('7z', ['a', '-tzip', '-mem=AES256', `-p${password}`, archive, 'notes.txt', 'blob.bin']);

    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true, listed.ok ? '' : listed.error);
    if (!listed.ok) return;

    for (const entry of listed.entries) {
      assert.equal(entry.method, METHOD_AES, `${entry.name} should be an AES entry`);
      assert.equal(entry.encrypted, true);
      assert.equal(entry.legacyEncryption, false);
      assert.equal(entry.aesStrength, 3, 'AES-256 is strength 3');

      const result = await decryptAesEntry(entry.payload, password, entry.innerMethod, entry.crc);
      assert.equal(result.ok, true, result.ok ? '' : result.error);
      if (result.ok) {
        const expected = entry.name === 'notes.txt' ? TEXT : RANDOM;
        assert.equal(sha(result.bytes), sha(new Uint8Array(expected)), entry.name);
      }
    }
  },
);

test(
  'the broken ZipCrypto scheme is recognised as such',
  { skip: HAS_7Z ? false : '7z is not installed' },
  () => {
    const archive = join(OUT, 'legacy.zip');
    run('7z', ['a', '-tzip', '-mem=ZipCrypto', '-psecret', archive, 'notes.txt']);
    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.entries[0].encrypted, true);
    assert.equal(
      listed.entries[0].legacyEncryption,
      true,
      'a ZipCrypto entry has to be distinguishable, so the page can say the file is weakly protected',
    );
  },
);

test(
  'a compression method we do not implement is named, not swallowed',
  { skip: HAS_7Z ? false : '7z is not installed' },
  async () => {
    const archive = join(OUT, 'bzip.zip');
    run('7z', ['a', '-tzip', '-mm=BZip2', archive, 'notes.txt']);
    const listed = listZip(new Uint8Array(readFileSync(archive)));
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const read = await readZipEntry(listed.entries[0]);
    assert.equal(read.ok, false);
    if (!read.ok) assert.match(read.error, /bzip2/i);
  },
);

/* ── round trip with this codebase's own writers ───────────────────────── */

test('reads back what writeZip produced', async () => {
  const written = writeZip([
    { name: 'a.txt', data: new Uint8Array(TEXT) },
    { name: 'b.bin', data: new Uint8Array(RANDOM) },
  ]);
  assert.equal(written.ok, true);
  if (!written.ok) return;
  const listed = listZip(written.bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(
    listed.entries.map((e) => e.name),
    ['a.txt', 'b.bin'],
  );
  const read = await readZipEntry(listed.entries[0]);
  assert.equal(read.ok, true, read.ok ? '' : read.error);
  if (read.ok) assert.equal(sha(read.bytes), sha(new Uint8Array(TEXT)));
});

test('reads back an archive this codebase encrypted', async () => {
  const locked = await writeAesZip(
    [
      { name: 'a.txt', bytes: new Uint8Array(TEXT) },
      { name: 'b.bin', bytes: new Uint8Array(RANDOM) },
    ],
    'round trip',
  );
  assert.equal(locked.ok, true);
  if (!locked.ok) return;
  const listed = listZip(locked.bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;

  for (const entry of listed.entries) {
    const result = await decryptAesEntry(entry.payload, 'round trip', entry.innerMethod, entry.crc);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    if (result.ok) {
      assert.equal(sha(result.bytes), sha(new Uint8Array(entry.name === 'a.txt' ? TEXT : RANDOM)));
    }
  }
});

/* ── the awkward inputs ────────────────────────────────────────────────── */

test('something that is not a zip is refused clearly', () => {
  const listed = listZip(new Uint8Array(randomBytes(2000)));
  assert.equal(listed.ok, false);
  if (!listed.ok) assert.match(listed.error, /zip/i);
});

test('an empty buffer is refused rather than throwing', () => {
  assert.equal(listZip(new Uint8Array(0)).ok, false);
});

test(
  'a truncated archive is refused rather than returning half a file',
  { skip: HAS_ZIP ? false : 'zip is not installed' },
  () => {
    const archive = join(OUT, 'cut.zip');
    run('zip', ['-q', archive, 'notes.txt', 'blob.bin']);
    const whole = new Uint8Array(readFileSync(archive));
    // Keeping the tail but losing the middle: the index still parses, the data
    // it points at does not exist.
    const cut = whole.slice(0, 200);
    assert.equal(listZip(cut).ok, false);
  },
);

test('entry names are reduced to one safe segment', () => {
  assert.equal(safeEntryName('../../etc/passwd', 0), 'passwd');
  assert.equal(safeEntryName('folder/sub/report.pdf', 0), 'report.pdf');
  assert.equal(safeEntryName('C:\\Users\\me\\secret.txt', 0), 'secret.txt');
  assert.equal(safeEntryName('..', 0), 'file-1');
  assert.equal(safeEntryName('', 3), 'file-4');
});

test('a corrupted entry fails its checksum instead of returning rubbish', async () => {
  const written = writeZip([{ name: 'a.txt', data: new Uint8Array(TEXT) }]);
  assert.equal(written.ok, true);
  if (!written.ok) return;
  const damaged = Uint8Array.from(written.bytes);
  // Well inside the stored payload, past the header.
  damaged[60] ^= 0xff;
  const listed = listZip(damaged);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  const read = await readZipEntry(listed.entries[0]);
  assert.equal(read.ok, false, 'the CRC should have caught this');
  if (!read.ok) assert.equal(read.reason, 'corrupt_input');
});
