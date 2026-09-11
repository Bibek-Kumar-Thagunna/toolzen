import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';

import { bitDepthFor, encodeIndexedPng, orderPalette, type IndexedPng } from './png.ts';
import { buildPalette, countColors, quantize, type PaletteEntry } from './quantize.ts';

/** Node's zlib produces the same wrapping CompressionStream('deflate') does. */
const deflate = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(deflateSync(Buffer.from(bytes)));

async function encode(image: IndexedPng): Promise<Uint8Array> {
  const result = await encodeIndexedPng(image, deflate);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.bytes : new Uint8Array();
}

/** Walk the chunk list, verifying every CRC on the way. */
function readChunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.deepEqual(
    Array.from(png.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'signature',
  );
  const chunks: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    const stated = view.getUint32(at + 8 + length, false);
    // CRC over type + data, big-endian, never over the length.
    const computed = crcOf(png.subarray(at + 4, at + 8 + length));
    assert.equal(stated, computed, `CRC for ${type}`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

/** An independent CRC-32, so the test does not check the encoder against itself. */
function crcOf(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkNamed(png: Uint8Array, type: string): Uint8Array | undefined {
  return readChunks(png).find((entry) => entry.type === type)?.data;
}

/** Unpack IDAT back into one index per pixel. */
function readIndices(png: Uint8Array, width: number, height: number, depth: number): number[] {
  const idat = chunkNamed(png, 'IDAT');
  assert.ok(idat, 'IDAT present');
  const raw = new Uint8Array(inflateSync(Buffer.from(idat)));
  const rowBytes = depth === 8 ? width + 1 : Math.ceil(width / (8 / depth)) + 1;
  assert.equal(raw.length, rowBytes * height, 'raw data is exactly the packed scanlines');

  const out: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const start = y * rowBytes;
    assert.equal(raw[start], 0, `row ${y} uses filter None`);
    for (let x = 0; x < width; x += 1) {
      if (depth === 8) {
        out.push(raw[start + 1 + x] as number);
      } else {
        const perByte = 8 / depth;
        const byte = raw[start + 1 + Math.floor(x / perByte)] as number;
        const shift = 8 - depth * ((x % perByte) + 1);
        out.push((byte >> shift) & ((1 << depth) - 1));
      }
    }
  }
  return out;
}

const OPAQUE = (r: number, g: number, b: number): PaletteEntry => ({ r, g, b, a: 255 });

/* ───────────────────────────── structure ────────────────────────────────── */

test('the file is a signature and the four required chunks, in order', async () => {
  const png = await encode({
    width: 2,
    height: 2,
    indices: new Uint8Array([0, 1, 1, 0]),
    palette: [OPAQUE(255, 0, 0), OPAQUE(0, 0, 255)],
  });
  const types = readChunks(png).map((entry) => entry.type);
  assert.deepEqual(types, ['IHDR', 'PLTE', 'IDAT', 'IEND']);
});

test('IHDR states the size, colour type 3, and no interlacing', async () => {
  const png = await encode({
    width: 7,
    height: 3,
    indices: new Uint8Array(21),
    palette: [OPAQUE(1, 2, 3)],
  });
  const ihdr = chunkNamed(png, 'IHDR');
  assert.ok(ihdr);
  const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  assert.equal(view.getUint32(0, false), 7, 'width');
  assert.equal(view.getUint32(4, false), 3, 'height');
  assert.equal(ihdr[9], 3, 'colour type 3 = palette');
  assert.equal(ihdr[10], 0, 'compression method');
  assert.equal(ihdr[11], 0, 'filter method');
  assert.equal(ihdr[12], 0, 'interlace');
});

test('PLTE is three bytes per entry, in palette order', async () => {
  const png = await encode({
    width: 1,
    height: 1,
    indices: new Uint8Array([0]),
    palette: [OPAQUE(10, 20, 30), OPAQUE(40, 50, 60)],
  });
  const plte = chunkNamed(png, 'PLTE');
  assert.ok(plte);
  assert.deepEqual(Array.from(plte), [10, 20, 30, 40, 50, 60]);
});

/* ───────────────────────────── bit packing ──────────────────────────────── */

test('the bit depth is the smallest that addresses the palette', () => {
  assert.equal(bitDepthFor(2), 1);
  assert.equal(bitDepthFor(3), 2);
  assert.equal(bitDepthFor(4), 2);
  assert.equal(bitDepthFor(5), 4);
  assert.equal(bitDepthFor(16), 4);
  assert.equal(bitDepthFor(17), 8);
  assert.equal(bitDepthFor(256), 8);
});

test('every pixel survives the round trip at 8 bits', async () => {
  const indices = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const palette = Array.from({ length: 20 }, (_, i) => OPAQUE(i, i, i));
  const png = await encode({ width: 4, height: 3, indices, palette });
  // orderPalette is stable for an all-opaque palette, so indices are unchanged.
  assert.deepEqual(readIndices(png, 4, 3, 8), Array.from(indices));
});

test('every pixel survives the round trip at 4 bits', async () => {
  const indices = new Uint8Array([0, 5, 15, 3, 8, 8, 1, 0, 15, 15, 2, 7]);
  const palette = Array.from({ length: 16 }, (_, i) => OPAQUE(i * 16, 0, 0));
  const png = await encode({ width: 4, height: 3, indices, palette });
  assert.deepEqual(readIndices(png, 4, 3, 4), Array.from(indices));
});

test('every pixel survives the round trip at 1 bit', async () => {
  const indices = new Uint8Array([0, 1, 1, 0, 1, 0, 0, 1, 1]);
  const png = await encode({
    width: 3,
    height: 3,
    indices,
    palette: [OPAQUE(0, 0, 0), OPAQUE(255, 255, 255)],
  });
  assert.deepEqual(readIndices(png, 3, 3, 1), Array.from(indices));
});

test('a row that does not fill its last byte is padded per row, not continuously', async () => {
  // Three pixels at 4bpp is one and a half bytes, so each row pads to two. A
  // continuous packer would shear every row after the first by half a byte.
  const indices = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const palette = Array.from({ length: 8 }, (_, i) => OPAQUE(i, i, i));
  const png = await encode({ width: 3, height: 2, indices, palette });
  assert.deepEqual(readIndices(png, 3, 2, 4), [1, 2, 3, 4, 5, 6]);
});

/* ───────────────────────────── transparency ─────────────────────────────── */

test('an all-opaque palette writes no tRNS chunk at all', async () => {
  const png = await encode({
    width: 1,
    height: 1,
    indices: new Uint8Array([0]),
    palette: [OPAQUE(1, 2, 3)],
  });
  assert.equal(chunkNamed(png, 'tRNS'), undefined);
});

test('tRNS is only as long as the transparent prefix', async () => {
  const palette = [
    OPAQUE(1, 1, 1),
    { r: 2, g: 2, b: 2, a: 0 },
    OPAQUE(3, 3, 3),
    OPAQUE(4, 4, 4),
  ];
  const png = await encode({ width: 2, height: 2, indices: new Uint8Array([0, 1, 2, 3]), palette });
  const trns = chunkNamed(png, 'tRNS');
  assert.ok(trns);
  // One transparent entry, sorted to the front: one byte, not four.
  assert.equal(trns.length, 1);
  assert.equal(trns[0], 0);
});

test('reordering the palette rewrites the pixels to match', () => {
  const palette = [OPAQUE(9, 9, 9), { r: 1, g: 1, b: 1, a: 0 }];
  const { palette: sorted, remap } = orderPalette(palette);
  assert.equal(sorted[0]?.a, 0, 'transparent first');
  assert.equal(remap[0], 1, 'the opaque entry moved to index 1');
  assert.equal(remap[1], 0, 'the transparent entry moved to index 0');
});

test('a pixel keeps its colour after the palette is reordered', async () => {
  // Pixel 0 points at the opaque grey. After sorting it must still be grey.
  const palette = [OPAQUE(9, 9, 9), { r: 1, g: 1, b: 1, a: 0 }];
  const png = await encode({ width: 2, height: 1, indices: new Uint8Array([0, 1]), palette });
  const plte = chunkNamed(png, 'PLTE');
  const read = readIndices(png, 2, 1, 1);
  assert.ok(plte);
  const colourOf = (index: number): number[] => [
    plte[index * 3] as number,
    plte[index * 3 + 1] as number,
    plte[index * 3 + 2] as number,
  ];
  assert.deepEqual(colourOf(read[0] as number), [9, 9, 9]);
  assert.deepEqual(colourOf(read[1] as number), [1, 1, 1]);
});

/* ───────────────────────────── refusals ─────────────────────────────────── */

test('pixel data that does not match the stated size is refused', async () => {
  const result = await encodeIndexedPng(
    { width: 4, height: 4, indices: new Uint8Array(9), palette: [OPAQUE(0, 0, 0)] },
    deflate,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /does not match/);
});

test('a palette larger than 256 entries is refused', async () => {
  const result = await encodeIndexedPng(
    {
      width: 1,
      height: 1,
      indices: new Uint8Array(1),
      palette: Array.from({ length: 257 }, () => OPAQUE(0, 0, 0)),
    },
    deflate,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /between 1 and 256/);
});

/* ───────────────────────────── quantization ─────────────────────────────── */

/** A flat image of `colors` distinct colours, repeated to fill width × height. */
function swatches(colors: number[][], width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const colour = colors[i % colors.length] as number[];
    data[i * 4] = colour[0] as number;
    data[i * 4 + 1] = colour[1] as number;
    data[i * 4 + 2] = colour[2] as number;
    data[i * 4 + 3] = (colour[3] ?? 255) as number;
  }
  return data;
}

test('an image with fewer colours than the palette allows is reproduced exactly', () => {
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const data = swatches(colors, 30, 30);
  const { palette, indices } = quantize(data, 30, 30, { colors: 16 });
  assert.ok(palette.length <= 3, `expected at most 3 entries, got ${palette.length}`);
  for (let i = 0; i < 30 * 30; i += 1) {
    const entry = palette[indices[i] as number] as PaletteEntry;
    assert.deepEqual(
      [entry.r, entry.g, entry.b],
      colors[i % colors.length],
      `pixel ${i} kept its colour`,
    );
  }
});

test('the palette never exceeds the requested size', () => {
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i += 1) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = (i * 7) % 256;
    data[i * 4 + 2] = (i * 13) % 256;
    data[i * 4 + 3] = 255;
  }
  for (const colors of [2, 8, 64, 256]) {
    const { palette } = quantize(data, 64, 64, { colors });
    assert.ok(palette.length <= colors, `${palette.length} > ${colors}`);
  }
});

test('every index points at a real palette entry', () => {
  const data = swatches(
    [
      [10, 20, 30],
      [200, 100, 50],
      [0, 0, 0],
      [255, 255, 255],
    ],
    16,
    16,
  );
  const { palette, indices } = quantize(data, 16, 16, { colors: 4 });
  for (const index of indices) {
    assert.ok(index < palette.length, `index ${index} is outside a palette of ${palette.length}`);
  }
});

test('transparency is carried into the palette rather than flattened', () => {
  const data = swatches(
    [
      [255, 0, 0, 255],
      [255, 0, 0, 0],
    ],
    20,
    20,
  );
  const { palette } = quantize(data, 20, 20, { colors: 8 });
  assert.ok(
    palette.some((entry) => entry.a === 0),
    'a fully transparent entry should survive',
  );
  assert.ok(
    palette.some((entry) => entry.a === 255),
    'the opaque entry should survive too',
  );
});

test('dithering produces the same shape of output as not dithering', () => {
  const data = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i += 1) {
    data[i * 4] = Math.floor((i / (32 * 32)) * 255);
    data[i * 4 + 1] = 128;
    data[i * 4 + 2] = 200;
    data[i * 4 + 3] = 255;
  }
  const plain = quantize(data, 32, 32, { colors: 4 });
  const dithered = quantize(data, 32, 32, { colors: 4, dither: true });
  assert.equal(dithered.indices.length, plain.indices.length);
  assert.deepEqual(dithered.palette, plain.palette, 'dithering changes pixels, not the palette');
  for (const index of dithered.indices) {
    assert.ok(index < dithered.palette.length);
  }
});

test('an empty image does not throw', () => {
  const { palette } = quantize(new Uint8Array(0), 0, 0, { colors: 16 });
  assert.equal(palette.length, 1);
});

test('buildPalette is deterministic', () => {
  const data = swatches(
    [
      [1, 2, 3],
      [250, 240, 230],
      [128, 64, 32],
    ],
    40,
    40,
  );
  assert.deepEqual(buildPalette(data, 8), buildPalette(data, 8));
});

test('countColors stops at its cap instead of counting a photograph', () => {
  const data = new Uint8Array(200 * 200 * 4);
  for (let i = 0; i < 200 * 200; i += 1) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = (i >> 8) % 256;
    data[i * 4 + 2] = (i >> 4) % 256;
    data[i * 4 + 3] = 255;
  }
  assert.equal(countColors(data, 100), 100);

  const flat = swatches(
    [
      [0, 0, 0],
      [255, 255, 255],
    ],
    50,
    50,
  );
  assert.equal(countColors(flat), 2);
});

/* ───────────────────────────── the point of it all ──────────────────────── */

test('a quantized screenshot is dramatically smaller than its truecolour form', async () => {
  // A flat graphic: wide bands of solid colour, which is what screenshots,
  // logos and diagrams look like to a compressor.
  const width = 256;
  const height = 256;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const band = Math.floor(x / 32);
      rgba[i] = band * 30;
      rgba[i + 1] = 255 - band * 20;
      rgba[i + 2] = 120;
      rgba[i + 3] = 255;
    }
  }

  const { palette, indices } = quantize(rgba, width, height, { colors: 16 });
  const png = await encode({ width, height, indices, palette });

  // The comparison is against the raw truecolour data deflated, which is a
  // generous stand-in for what a canvas would write.
  const truecolour = deflateSync(Buffer.from(rgba)).length;
  assert.ok(
    png.length < truecolour / 2,
    `expected well under half of ${truecolour} bytes, got ${png.length}`,
  );
});
