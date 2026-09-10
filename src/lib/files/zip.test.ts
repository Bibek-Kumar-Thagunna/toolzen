import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { ZIP_MAX_ENTRIES, crc32, writeZip, type ZipEntry } from './zip.ts';

const OUT = `${tmpdir()}/flint-zip-tests`;
mkdirSync(OUT, { recursive: true });

/**
 * Python's `zipfile` is the verifier: an unrelated implementation, written by
 * people who did not see this code, reading the archive the way the user's
 * computer will. `testzip()` recomputes every CRC, so a wrong checksum or a
 * misplaced offset fails here rather than in someone's Downloads folder.
 */
const INSPECT = `
import hashlib, json, sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as archive:
    broken = archive.testzip()
    entries = []
    for info in archive.infolist():
        body = archive.read(info.filename)
        entries.append({
            'name': info.filename,
            'size': info.file_size,
            'method': info.compress_type,
            'crc': info.CRC,
            'dateTime': list(info.date_time),
            'sha256': hashlib.sha256(body).hexdigest(),
        })
print(json.dumps({'broken': broken, 'entries': entries}))
`;

interface InspectedEntry {
  name: string;
  size: number;
  method: number;
  crc: number;
  dateTime: number[];
  sha256: string;
}

interface Inspected {
  broken: string | null;
  entries: InspectedEntry[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function build(entries: readonly ZipEntry[]): Uint8Array {
  const result = writeZip(entries);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.bytes;
}

/** Write the archive out and read it back through Python. */
function inspect(name: string, entries: readonly ZipEntry[]): Inspected {
  const bytes = build(entries);
  const path = `${OUT}/${name}`;
  writeFileSync(path, bytes);
  const result = spawnSync('python3', ['-c', INSPECT, path], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) assert.fail(`python3 could not be run: ${result.error.message}`);
  assert.equal(result.status, 0, `python3 rejected ${name}:\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as Inspected;
  assert.equal(parsed.broken, null, `a CRC in ${name} did not match its data`);
  return parsed;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('crc32: the published test vectors', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(text('123456789')), 0xcbf43926);
  assert.equal(crc32(text('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  // A value with the high bit set has to come back unsigned, or the archive is
  // rejected by every reader.
  assert.ok(crc32(text('a')) > 0x7fffffff);
  assert.equal(crc32(text('a')), 0xe8b7be43);
});

test('a real ZIP program reads the archive back byte for byte', () => {
  const one = text('first result');
  const two = new Uint8Array(1024 * 1024);
  for (let i = 0; i < two.length; i += 1) two[i] = (i * 31 + 7) & 0xff;
  const inspected = inspect('round-trip.zip', [
    { name: 'photo-1.jpg', data: one },
    { name: 'photo-2.jpg', data: two },
  ]);
  assert.deepEqual(
    inspected.entries.map((e) => e.name),
    ['photo-1.jpg', 'photo-2.jpg'],
  );
  assert.equal(inspected.entries[0].sha256, sha256(one));
  assert.equal(inspected.entries[1].sha256, sha256(two));
  assert.equal(inspected.entries[1].size, two.length);
});

test('entries are stored, not deflated, so the CPU cost is nil', () => {
  const inspected = inspect('stored.zip', [{ name: 'a.txt', data: text('x'.repeat(5000)) }]);
  assert.equal(inspected.entries[0].method, 0);
});

test('an empty file is a legal entry', () => {
  // A tool can legitimately produce nothing — an empty text export, say — and
  // dropping the entry would make the archive quietly disagree with the results
  // list the user is looking at.
  const inspected = inspect('empty-entry.zip', [
    { name: 'blank.txt', data: new Uint8Array(0) },
    { name: 'after.txt', data: text('still here') },
  ]);
  assert.equal(inspected.entries.length, 2);
  assert.equal(inspected.entries[0].size, 0);
  assert.equal(inspected.entries[0].crc, 0);
  assert.equal(inspected.entries[1].sha256, sha256(text('still here')));
});

test('unicode names survive, because the UTF-8 flag is set', () => {
  const inspected = inspect('unicode.zip', [
    { name: '写真.jpg', data: text('a') },
    { name: 'vacaciones 🏖.png', data: text('b') },
  ]);
  assert.deepEqual(
    inspected.entries.map((e) => e.name),
    ['写真.jpg', 'vacaciones 🏖.png'],
  );
});

test('an entry name is never a path, so extraction cannot escape', () => {
  const inspected = inspect('flat.zip', [
    { name: '../../etc/passwd', data: text('nope') },
    { name: 'C:\\Windows\\system32\\evil.dll', data: text('nope') },
  ]);
  assert.deepEqual(
    inspected.entries.map((e) => e.name),
    ['passwd', 'evil.dll'],
  );
});

test('colliding names are numbered, so nothing is silently overwritten', () => {
  const inspected = inspect('collisions.zip', [
    { name: 'scan.pdf', data: text('one') },
    { name: 'scan.pdf', data: text('two') },
    { name: 'SCAN.pdf', data: text('three') },
  ]);
  assert.deepEqual(
    inspected.entries.map((e) => e.name),
    ['scan.pdf', 'scan (2).pdf', 'SCAN (3).pdf'],
  );
  assert.equal(inspected.entries[1].sha256, sha256(text('two')));
});

test('a name that sanitises to nothing still gets an entry', () => {
  const inspected = inspect('unnameable.zip', [{ name: '<<<>>>', data: text('kept') }]);
  assert.equal(inspected.entries[0].name, 'file-1');
  assert.equal(inspected.entries[0].sha256, sha256(text('kept')));
});

test('timestamps are written, and two-second resolution is respected', () => {
  const when = new Date(2026, 8, 3, 14, 35, 45);
  const inspected = inspect('stamped.zip', [{ name: 'a.txt', data: text('a'), modified: when }]);
  // Month is 1-based in the archive; seconds are rounded down to even.
  assert.deepEqual(inspected.entries[0].dateTime, [2026, 9, 3, 14, 35, 44]);
});

test('a clock set before 1980 is clamped rather than written out of range', () => {
  // An out-of-range DOS date makes some readers refuse the whole archive, and a
  // device with an unset clock is not the user's fault.
  const inspected = inspect('old-clock.zip', [
    { name: 'a.txt', data: text('a'), modified: new Date(1970, 0, 1) },
  ]);
  assert.deepEqual(inspected.entries[0].dateTime.slice(0, 3), [1980, 1, 1]);
});

test('a full twenty-file batch is exactly as long as it should be', () => {
  // The buffer is allocated once at its final size, so any miscount shows up as
  // trailing zero bytes or a truncated central directory. Both make the end
  // record unfindable, which is why the length is asserted rather than assumed.
  const entries = Array.from({ length: 20 }, (_, i) => ({
    name: `photo-${i + 1}.webp`,
    data: new Uint8Array(2048).fill(i),
  }));
  const bytes = build(entries);
  const names = entries.reduce((sum, e) => sum + e.name.length, 0);
  assert.equal(bytes.length, 20 * (30 + 46 + 2048) + names * 2 + 22);
  // The end record is the last twenty-two bytes, and readers find it by
  // scanning backwards for this signature.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 20, 'entry count');
  assert.equal(inspect('twenty.zip', entries).entries.length, 20);
});

test('an empty archive is refused with something a user can act on', () => {
  const result = writeZip([]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_input');
  assert.match(result.error, /no files/);
});

test('more entries than the format can count is refused before allocating', () => {
  const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({
    name: `f${i}`,
    data: new Uint8Array(0),
  }));
  const result = writeZip(many);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'too_many_files');
  // The sentence has to point somewhere useful, not just apologise.
  assert.match(result.error, /individually/);
});

test('the failure sentences contain no jargon a user would have to look up', () => {
  const result = writeZip([]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  for (const word of ['ZIP64', 'CRC', 'central directory', 'undefined', 'Error']) {
    assert.ok(!result.error.includes(word), `"${word}" should not reach a user`);
  }
});
