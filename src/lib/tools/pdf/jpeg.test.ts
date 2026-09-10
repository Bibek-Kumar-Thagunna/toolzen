import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { jpegColourSpace, parseJpeg } from './jpeg.ts';
import type { JpegInfo } from './jpeg.ts';

const FIXTURES = '/tmp/pdf-fixtures';

/**
 * Fixtures come from PIL, not from hand-written byte arrays.
 *
 * A parser tested only against bytes the test author wrote proves the two agree
 * with each other, which is not the question. These are real encoder output:
 * baseline, progressive, grayscale, CMYK-from-Adobe-conventions, and a file with
 * an Exif rotation flag. The directory is cached, and the same script appears in
 * `writer.test.ts` so each test file runs on its own; whichever process gets
 * there first wins the rename and the other reuses the result.
 */
const FIXTURE_SCRIPT = `
import sys, os
from PIL import Image, ImageDraw
D = sys.argv[1]
os.makedirs(D, exist_ok=True)

def photo(w, h):
    g = Image.linear_gradient('L').resize((w, h))
    r = g.transpose(Image.Transpose.ROTATE_90).resize((w, h))
    b = Image.new('L', (w, h), 128)
    im = Image.merge('RGB', (r, g, b))
    ImageDraw.Draw(im).ellipse([w // 6, h // 6, w * 5 // 6, h * 5 // 6], outline=(255, 0, 0), width=6)
    return im

photo(640, 480).save(D + '/baseline-rgb.jpg', quality=90)
photo(320, 200).convert('L').save(D + '/gray.jpg', quality=90)
photo(640, 480).save(D + '/progressive.jpg', quality=85, progressive=True)
photo(200, 150).convert('CMYK').save(D + '/cmyk.jpg', quality=90)
Image.new('RGB', (200, 200), (220, 20, 30)).save(D + '/red.jpg', quality=95)
im = Image.new('RGB', (300, 200), (10, 120, 200))
ex = im.getexif(); ex[0x0112] = 6
im.save(D + '/exif-orient6.jpg', quality=88, exif=ex)
Image.new('RGB', (8, 8), (1, 2, 3)).save(D + '/tiny.png')
open(D + '/rgb-raw.bin', 'wb').write(bytes(v for y in range(48) for x in range(64) for v in (x * 4, y * 5, 200)))
open(D + '/rgba-raw.bin', 'wb').write(bytes(v for y in range(48) for x in range(64) for v in (255, 40, 40, 0 if x < 32 else 255)))
open(D + '/gray-raw.bin', 'wb').write(bytes((x * 8) % 256 for x in range(1024)))
`;

function ensureFixtures(): void {
  if (existsSync(`${FIXTURES}/baseline-rgb.jpg`)) return;
  const staging = `${FIXTURES}.${process.pid}`;
  mkdirSync(staging, { recursive: true });
  const built = spawnSync('python3', ['-c', FIXTURE_SCRIPT, staging], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`could not build fixtures: ${built.stderr}`);
  try {
    renameSync(staging, FIXTURES);
  } catch {
    // Another test file built them first, which is the point of the marker check.
  }
  if (!existsSync(`${FIXTURES}/baseline-rgb.jpg`)) throw new Error('fixtures were not created');
}

ensureFixtures();

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
}

function info(name: string): JpegInfo {
  const result = parseJpeg(fixture(name));
  if (!result.ok) assert.fail(`${name} should have parsed: ${result.error}`);
  return result.info;
}

function errorFor(bytes: Uint8Array, what: string): string {
  const result = parseJpeg(bytes);
  if (result.ok) assert.fail(`${what} should have been rejected, got ${JSON.stringify(result.info)}`);
  assert.ok(result.error.length > 30, `${what}: the message should be a sentence, got "${result.error}"`);
  assert.ok(/[.!]$/.test(result.error), `${what}: the message should end in a full stop`);
  return result.error;
}

/**
 * An independent segment walk, used only to build mutant files at the right
 * offsets. Scanning for `FF C0` with `indexOf` would find false positives inside
 * a quantisation table, so this steps segment by segment like a reader must.
 */
function segmentOffset(bytes: Uint8Array, wanted: number): number {
  let at = 2;
  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === wanted) return at;
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  assert.fail(`no FF${wanted.toString(16).toUpperCase()} segment found`);
}

function splice(bytes: Uint8Array, at: number, insert: readonly number[]): Uint8Array {
  const out = new Uint8Array(bytes.length + insert.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(insert, at);
  out.set(bytes.subarray(at), at + insert.length);
  return out;
}

test('every fixture reports the exact size and channel count PIL wrote', () => {
  const baseline = info('baseline-rgb.jpg');
  assert.equal(baseline.width, 640);
  assert.equal(baseline.height, 480);
  assert.equal(baseline.components, 3);
  assert.equal(baseline.bitsPerComponent, 8);
  assert.equal(baseline.progressive, false);
  assert.equal(baseline.adobeTransform, null);
  assert.equal(baseline.hasExifOrientation, null);
  assert.equal(baseline.iccChunks, 0);

  const grey = info('gray.jpg');
  assert.deepEqual([grey.width, grey.height, grey.components], [320, 200, 1]);

  const red = info('red.jpg');
  assert.deepEqual([red.width, red.height, red.components], [200, 200, 3]);

  const oriented = info('exif-orient6.jpg');
  assert.deepEqual([oriented.width, oriented.height], [300, 200], 'the SOF size, not the rotated size');

  const cmyk = info('cmyk.jpg');
  assert.deepEqual([cmyk.width, cmyk.height, cmyk.components], [200, 150, 4]);

  const progressive = info('progressive.jpg');
  assert.deepEqual([progressive.width, progressive.height], [640, 480]);
});

test('progressive JPEGs are recognised, and still allowed', () => {
  const progressive = info('progressive.jpg');
  assert.equal(progressive.progressive, true, 'SOF2 means progressive');
  assert.equal(info('baseline-rgb.jpg').progressive, false);
  // Reporting it, not refusing it: /DCTDecode decodes progressive perfectly well,
  // and the same picture is in both files.
  assert.equal(progressive.components, 3);
  assert.equal(jpegColourSpace(progressive).pdfName, '/DeviceRGB');
});

test('the Exif orientation flag is read, because a raw embed ignores it', () => {
  assert.equal(info('exif-orient6.jpg').hasExifOrientation, 6, 'orientation 6 is rotate 90° clockwise');
  assert.equal(info('baseline-rgb.jpg').hasExifOrientation, null, 'no Exif means no answer, not 1');
  assert.equal(info('red.jpg').hasExifOrientation, null);
});

test('the colour space follows the channel count, and CMYK is inverted', () => {
  assert.deepEqual(jpegColourSpace(info('gray.jpg')), {
    pdfName: '/DeviceGray',
    needsInvertedDecode: false,
  });
  assert.deepEqual(jpegColourSpace(info('baseline-rgb.jpg')), {
    pdfName: '/DeviceRGB',
    needsInvertedDecode: false,
  });

  // PIL writes CMYK JPEGs the way Adobe does: an APP14 marker and every sample
  // complemented. Without /Decode the PDF renders as a negative.
  const cmyk = info('cmyk.jpg');
  assert.equal(cmyk.adobeTransform, 0, 'transform 0 is plain CMYK rather than YCCK');
  assert.deepEqual(jpegColourSpace(cmyk), { pdfName: '/DeviceCMYK', needsInvertedDecode: true });

  // A four-channel file with no Adobe marker is not an Adobe file, so its samples
  // are the right way up.
  const noAdobe: JpegInfo = { ...cmyk, adobeTransform: null };
  assert.deepEqual(jpegColourSpace(noAdobe), { pdfName: '/DeviceCMYK', needsInvertedDecode: false });

  // YCCK (transform 2) is still stored inverted.
  assert.equal(jpegColourSpace({ ...cmyk, adobeTransform: 2 }).needsInvertedDecode, true);
});

test('truncated files come back as a sentence, never as a thrown error', () => {
  const whole = fixture('baseline-rgb.jpg');
  for (const cut of [0, 1, 2, 3, 4, 10, 100, 157, 200]) {
    const message = errorFor(whole.slice(0, cut), `${cut} bytes`);
    assert.ok(!message.includes('undefined'), `${cut} bytes: no internals in the message`);
  }
  // A byte-by-byte sweep of the whole header: no length, offset or index can be
  // made to throw, whatever the file stops on.
  for (let cut = 0; cut < 700; cut += 1) {
    const result = parseJpeg(whole.slice(0, cut));
    assert.equal(typeof result.ok, 'boolean', `${cut} bytes returned nothing`);
  }
});

test('files that are not JPEGs are turned away', () => {
  assert.match(errorFor(fixture('tiny.png'), 'a PNG'), /not look like a JPEG/);
  errorFor(new Uint8Array(0), 'nothing at all');
  errorFor(new Uint8Array([0xff, 0xd7, 0x00, 0x00]), 'the wrong start marker');
  errorFor(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'a PNG signature');
  errorFor(fixture('rgb-raw.bin'), 'raw pixels with no header');
});

test('JPEG variants no PDF reader can show are refused with an explanation', () => {
  const whole = fixture('baseline-rgb.jpg');
  const sofAt = segmentOffset(whole, 0xc0);

  const mutate = (change: (bytes: Uint8Array) => void): Uint8Array => {
    const copy = whole.slice();
    change(copy);
    return copy;
  };

  const arithmetic = mutate((b) => {
    b[sofAt + 1] = 0xc9;
  });
  assert.match(errorFor(arithmetic, 'arithmetic coding'), /arithmetic/i);

  const lossless = mutate((b) => {
    b[sofAt + 1] = 0xc3;
  });
  assert.match(errorFor(lossless, 'lossless JPEG'), /lossless/i);

  const hierarchical = mutate((b) => {
    b[sofAt + 1] = 0xc5;
  });
  errorFor(hierarchical, 'a differential frame');

  // Precision is the first byte of the frame payload, four bytes past the marker.
  const twelveBit = mutate((b) => {
    b[sofAt + 4] = 12;
  });
  assert.match(errorFor(twelveBit, '12-bit samples'), /12 bits/);

  // Two channels is a real JPEG shape and not one PDF has a colour space for.
  const twoChannels = mutate((b) => {
    b[sofAt + 9] = 2;
  });
  assert.match(errorFor(twoChannels, 'two channels'), /2 colour channels/);
});

test('the segment walk survives padding, counts ICC chunks and rejects nonsense lengths', () => {
  const whole = fixture('baseline-rgb.jpg');
  const sofAt = segmentOffset(whole, 0xc0);

  // FF bytes before a marker are legal padding. A reader that treats one as the
  // marker itself reads the following segment at the wrong offset.
  const padded = splice(splice(whole, sofAt, [0xff, 0xff, 0xff]), 2, [0xff, 0xff]);
  const result = parseJpeg(padded);
  if (!result.ok) assert.fail(`padding should be skipped: ${result.error}`);
  assert.deepEqual([result.info.width, result.info.height], [640, 480]);

  // Two APP2 chunks carrying an ICC profile, inserted straight after the start marker.
  const iccSegment = [0xff, 0xe2, 0x00, 0x10, 0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00, 1, 2];
  const withIcc = splice(splice(whole, 2, iccSegment), 2, iccSegment);
  const iccResult = parseJpeg(withIcc);
  if (!iccResult.ok) assert.fail(`ICC chunks should not break the walk: ${iccResult.error}`);
  assert.equal(iccResult.info.iccChunks, 2);
  assert.equal(iccResult.info.width, 640, 'and the size still reads correctly past them');

  // A length of 0 or 1 is impossible: the field counts itself, so 2 is the floor.
  for (const bogus of [0, 1]) {
    const broken = whole.slice();
    broken[sofAt + 2] = 0;
    broken[sofAt + 3] = bogus;
    errorFor(broken, `a segment claiming length ${bogus}`);
  }

  // A byte where a marker must be.
  const desynced = whole.slice();
  desynced[sofAt] = 0x42;
  errorFor(desynced, 'a lost marker');

  // A file whose segments are all fine but which never declares a frame.
  const headerOnly = splice(whole.slice(0, sofAt), sofAt, [0xff, 0xd9]);
  assert.match(errorFor(headerOnly, 'no frame header'), /how large/);
});
