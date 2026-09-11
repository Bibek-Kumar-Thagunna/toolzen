import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIco,
  faviconManifest,
  faviconMarkup,
  isPng,
  readPngSize,
  ICO_MAX_EDGE,
} from './ico.ts';

/**
 * A syntactically valid PNG header of the given size, followed by filler.
 *
 * `buildIco` reads the IHDR and nothing else, so a real encoded image is not
 * needed here — and using one would test the browser's PNG encoder rather than
 * this module's bookkeeping, which is the part that can be wrong.
 */
function fakePng(width: number, height: number, payload = 40): Uint8Array {
  const bytes = new Uint8Array(24 + payload);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false); // IHDR length
  view.setUint32(12, 0x49484452, false); // 'IHDR'
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  // Filler stands in for the rest of the file; its content is never read.
  bytes.fill(0xab, 24);
  return bytes;
}

function ok(images: Parameters<typeof buildIco>[0]): Uint8Array {
  const result = buildIco(images);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.bytes : new Uint8Array();
}

function rejected(images: Parameters<typeof buildIco>[0]): string {
  const result = buildIco(images);
  assert.equal(result.ok, false, 'expected the icon to be rejected');
  return result.ok ? '' : result.error;
}

/* ───────────────────────────── PNG reading ─────────────────────────────── */

test('a PNG signature is recognised and anything else is not', () => {
  assert.equal(isPng(fakePng(16, 16)), true);
  assert.equal(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false); // JPEG
  assert.equal(isPng(new Uint8Array(0)), false);
});

test('the size is read from the IHDR chunk, big-endian', () => {
  assert.deepEqual(readPngSize(fakePng(48, 48)), { width: 48, height: 48 });
  assert.deepEqual(readPngSize(fakePng(256, 128)), { width: 256, height: 128 });
});

test('a file that is not a PNG has no readable size', () => {
  assert.equal(readPngSize(new Uint8Array([1, 2, 3])), null);
});

/* ───────────────────────────── the container ───────────────────────────── */

test('the header declares an icon and the number of images', () => {
  const bytes = ok([{ width: 16, height: 16, png: fakePng(16, 16) }]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(0, true), 0, 'reserved');
  assert.equal(view.getUint16(2, true), 1, 'type 1 = icon');
  assert.equal(view.getUint16(4, true), 1, 'one image');
});

test('every payload is present, byte for byte, at the offset the directory gives', () => {
  const small = fakePng(16, 16, 10);
  const large = fakePng(32, 32, 90);
  const bytes = ok([
    { width: 16, height: 16, png: small },
    { width: 32, height: 32, png: large },
  ]);
  const view = new DataView(bytes.buffer);

  for (const [index, png] of [small, large].entries()) {
    const at = 6 + index * 16;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    assert.equal(size, png.length, `entry ${index} records its own length`);
    assert.deepEqual(
      bytes.slice(offset, offset + size),
      png,
      `entry ${index} is stored unmodified`,
    );
  }
});

test('the file is exactly the header, the directory and the payloads', () => {
  const images = [
    { width: 16, height: 16, png: fakePng(16, 16, 10) },
    { width: 32, height: 32, png: fakePng(32, 32, 20) },
    { width: 48, height: 48, png: fakePng(48, 48, 30) },
  ];
  const bytes = ok(images);
  const expected = 6 + 3 * 16 + images.reduce((sum, i) => sum + i.png.length, 0);
  assert.equal(bytes.length, expected, 'no padding, no gaps');
});

test('payloads do not overlap', () => {
  const images = [
    { width: 16, height: 16, png: fakePng(16, 16, 10) },
    { width: 32, height: 32, png: fakePng(32, 32, 20) },
  ];
  const bytes = ok(images);
  const view = new DataView(bytes.buffer);
  const first = { offset: view.getUint32(6 + 12, true), size: view.getUint32(6 + 8, true) };
  const second = { offset: view.getUint32(22 + 12, true), size: view.getUint32(22 + 8, true) };
  assert.equal(first.offset + first.size, second.offset, 'the second starts where the first ends');
});

test('the directory records each image size, with 256 stored as zero', () => {
  const bytes = ok([
    { width: 16, height: 16, png: fakePng(16, 16) },
    { width: ICO_MAX_EDGE, height: ICO_MAX_EDGE, png: fakePng(ICO_MAX_EDGE, ICO_MAX_EDGE) },
  ]);
  assert.equal(bytes[6], 16);
  assert.equal(bytes[7], 16);
  assert.equal(bytes[22], 0, '256 does not fit in a byte and is written as 0');
  assert.equal(bytes[23], 0);
});

test('entries declare 32 bits per pixel and one colour plane', () => {
  const bytes = ok([{ width: 32, height: 32, png: fakePng(32, 32) }]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(6 + 4, true), 1);
  assert.equal(view.getUint16(6 + 6, true), 32);
});

/* ───────────────────────────── refusals ────────────────────────────────── */

test('an entry whose declared size disagrees with its PNG is refused', () => {
  // The bug this catches renders correctly in one browser and blurred in
  // another, which is why it is a hard failure rather than a correction.
  assert.match(
    rejected([{ width: 16, height: 16, png: fakePng(32, 32) }]),
    /does not match the size/,
  );
});

test('a payload that is not a PNG is refused', () => {
  assert.match(
    rejected([{ width: 16, height: 16, png: new Uint8Array([0xff, 0xd8, 0xff]) }]),
    /must be a PNG/,
  );
});

test('an empty icon is refused', () => {
  assert.match(rejected([]), /at least one image/);
});

test('an image larger than the format allows is refused', () => {
  assert.match(rejected([{ width: 512, height: 512, png: fakePng(512, 512) }]), /between 1 and 256/);
});

test('a fractional size is refused rather than rounded', () => {
  assert.match(rejected([{ width: 16.5, height: 16, png: fakePng(16, 16) }]), /whole numbers/);
});

/* ───────────────────────────── the extras ──────────────────────────────── */

test('the markup names the files the generator produces', () => {
  const html = faviconMarkup({ manifest: true });
  for (const file of ['/favicon.ico', '/icon-192.png', '/apple-touch-icon.png']) {
    assert.ok(html.includes(file), `markup should reference ${file}`);
  }
  assert.ok(html.includes('/site.webmanifest'));
});

test('the manifest link is omitted when no manifest is produced', () => {
  assert.equal(faviconMarkup({ manifest: false }).includes('webmanifest'), false);
});

test('the manifest is valid JSON naming both Android icons', () => {
  const parsed: unknown = JSON.parse(faviconManifest({ name: 'Toolzen', themeColor: '#0f766e' }));
  assert.ok(typeof parsed === 'object' && parsed !== null);
  const manifest = parsed as { name: string; icons: { src: string; sizes: string }[] };
  assert.equal(manifest.name, 'Toolzen');
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
});
