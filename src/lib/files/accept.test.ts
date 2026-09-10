import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptAttribute,
  checkBatch,
  checkFile,
  describeFile,
  matchesAccept,
  type FileLike,
} from './accept.ts';

/** Mirrors the image-compressor entry in the registry, which is the busiest spec. */
const images = {
  mime: ['image/jpeg', 'image/png', 'image/webp', '.jpg', '.jpeg', '.png', '.webp'],
  label: 'JPG, PNG or WebP',
  maxBytes: 30 * 1024 * 1024,
  maxFiles: 20,
};

const singlePdf = {
  mime: ['application/pdf', '.pdf'],
  label: 'PDF',
  maxBytes: 100 * 1024 * 1024,
  maxFiles: 1,
};

const anyImage = {
  mime: ['image/*'],
  label: 'any image',
  maxBytes: 1024,
  maxFiles: 5,
};

function file(name: string, size = 1000, type = ''): FileLike {
  return { name, size, type };
}

test('acceptAttribute: the registry list is already the attribute value', () => {
  assert.equal(
    acceptAttribute(images),
    'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
  );
});

test('matchesAccept: a declared MIME type is enough', () => {
  assert.equal(matchesAccept(file('photo', 10, 'image/png'), images), true);
  assert.equal(matchesAccept(file('photo', 10, 'IMAGE/PNG'), images), true);
  assert.equal(matchesAccept(file('doc', 10, 'application/pdf'), images), false);
});

test('matchesAccept: an extension is enough when the browser reports nothing', () => {
  // The Linux desktop case: File.type is '' for anything the environment does
  // not recognise, and rejecting on that alone would break the tool entirely.
  assert.equal(matchesAccept(file('photo.PNG', 10, ''), images), true);
  assert.equal(matchesAccept(file('photo.heic', 10, ''), images), false);
  assert.equal(matchesAccept(file('photo', 10, ''), images), false);
});

test('matchesAccept: a wrong-looking pair still matches on either signal', () => {
  // Windows sometimes reports image/x-png; the extension carries it.
  assert.equal(matchesAccept(file('photo.png', 10, 'image/x-png'), images), true);
  // A camera export with no extension carries it on the type instead.
  assert.equal(matchesAccept(file('DSC0001', 10, 'image/jpeg'), images), true);
});

test('matchesAccept: wildcards work, and only as a prefix', () => {
  assert.equal(matchesAccept(file('x', 10, 'image/avif'), anyImage), true);
  assert.equal(matchesAccept(file('x', 10, 'video/mp4'), anyImage), false);
  assert.equal(matchesAccept(file('x.png', 10, ''), anyImage), false);
});

test('matchesAccept: a bare wildcard takes everything, typed or not', () => {
  // The Base64 spec. A file the OS could not classify is exactly the case that
  // must still be accepted here, so this is checked before the empty-type guard.
  const anything = { mime: ['*/*'], label: 'any file', maxBytes: 100, maxFiles: 1 };
  assert.equal(matchesAccept(file('archive.7z', 10, ''), anything), true);
  assert.equal(matchesAccept(file('no-extension', 10, ''), anything), true);
  assert.equal(matchesAccept(file('x', 10, 'application/octet-stream'), anything), true);
});

test('checkFile: an empty file is reported as empty, not as the wrong type', () => {
  const result = checkFile(file('folder-dropped', 0, ''), images);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'corrupt_input');
  assert.match(result.error, /is empty/);
  assert.match(result.error, /folder/);
});

test('checkFile: size is checked before type, because size is actionable', () => {
  const result = checkFile(file('huge.txt', 40 * 1024 * 1024, 'text/plain'), images);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'too_large');
  assert.match(result.error, /30 MB/);
});

test('checkFile: the limit is quoted without a pointless decimal', () => {
  const result = checkFile(file('huge.png', 31 * 1024 * 1024, 'image/png'), images);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.error.includes('30.0 MB'), 'limit should read "30 MB"');
});

test('checkFile: an unsupported file is told what the tool does take', () => {
  const result = checkFile(file('song.mp3', 5000, 'audio/mpeg'), images);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupported_type');
  assert.match(result.error, /JPG, PNG or WebP/);
});

test('checkFile: a good file passes', () => {
  assert.deepEqual(checkFile(file('photo.jpg', 2000, 'image/jpeg'), images), { ok: true });
});

test('describeFile: long and hostile names cannot wreck a sentence', () => {
  assert.equal(describeFile('photo.png'), '“photo.png”');
  assert.equal(describeFile('/tmp/deep/photo.png'), '“photo.png”');
  assert.equal(describeFile(''), 'That file');
  assert.equal(describeFile('<<<>>>'), 'That file');
  const long = describeFile(`${'a'.repeat(400)}.png`);
  // 60 code points plus the two quotation marks.
  assert.equal(Array.from(long).length, 62);
});

test('checkBatch: everything valid is accepted and there is no message', () => {
  const result = checkBatch(
    [file('a.png', 10, 'image/png'), file('b.jpg', 10, 'image/jpeg')],
    images,
  );
  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.message, null);
  assert.equal(result.reason, null);
});

test('checkBatch: a partial drop adds what fits and says what did not', () => {
  const incoming = Array.from({ length: 25 }, (_, i) => file(`p${i}.png`, 10, 'image/png'));
  const result = checkBatch(incoming, images);
  assert.equal(result.accepted.length, 20);
  assert.equal(result.rejected.length, 5);
  assert.equal(result.reason, 'too_many_files');
  assert.match(result.message ?? '', /up to 20/);
});

test('checkBatch: the cap accounts for files already queued', () => {
  const result = checkBatch([file('a.png', 10, 'image/png')], images, { existing: 20 });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reason, 'too_many_files');
});

test('checkBatch: a single-file tool says so in the singular', () => {
  const result = checkBatch(
    [file('a.pdf', 10, 'application/pdf'), file('b.pdf', 10, 'application/pdf')],
    singlePdf,
  );
  assert.equal(result.accepted.length, 1);
  assert.match(result.message ?? '', /one file at a time/);
});

test('checkBatch: the cap is applied after validation, so bad files waste no slots', () => {
  const result = checkBatch(
    [
      file('bad1.mp3', 10, 'audio/mpeg'),
      file('bad2.mp3', 10, 'audio/mpeg'),
      file('good.png', 10, 'image/png'),
    ],
    { ...images, maxFiles: 2 },
  );
  assert.deepEqual(
    result.accepted.map((f) => f.name),
    ['good.png'],
  );
  assert.equal(result.rejected.length, 2);
});

test('checkBatch: several rejections for one reason collapse into one sentence', () => {
  const result = checkBatch(
    [file('a.mp3', 10, 'audio/mpeg'), file('b.mp3', 10, 'audio/mpeg')],
    images,
  );
  assert.equal(result.message, '2 files were skipped because this tool works with JPG, PNG or WebP.');
  assert.equal(result.reason, 'unsupported_type');
});

test('checkBatch: a mixed batch keeps one specific sentence and counts the rest', () => {
  const result = checkBatch(
    [
      file('a.mp3', 10, 'audio/mpeg'),
      file('huge.png', 40 * 1024 * 1024, 'image/png'),
      file('empty.png', 0, 'image/png'),
    ],
    images,
  );
  assert.match(result.message ?? '', /^“a\.mp3” is not a supported file\./);
  assert.match(result.message ?? '', /2 files were skipped as well\.$/);
});

test('checkBatch: the reported reason is the dominant one, not the first', () => {
  const result = checkBatch(
    [
      file('a.mp3', 10, 'audio/mpeg'),
      file('h1.png', 40 * 1024 * 1024, 'image/png'),
      file('h2.png', 40 * 1024 * 1024, 'image/png'),
    ],
    images,
  );
  assert.equal(result.reason, 'too_large');
});

test('checkBatch: a single rejection keeps its own specific sentence', () => {
  const result = checkBatch([file('song.mp3', 10, 'audio/mpeg')], images);
  assert.equal(result.message, '“song.mp3” is not a supported file. This tool works with JPG, PNG or WebP.');
});

test('checkBatch: an empty drop is not an error', () => {
  const result = checkBatch([], images);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.message, null);
});
