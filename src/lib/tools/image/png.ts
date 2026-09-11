/**
 * ============================================================================
 * WRITING AN INDEXED PNG
 * ============================================================================
 * The other half of real PNG compression. `quantize.ts` reduces an image to a
 * palette; this writes that palette out as a PNG a browser will display.
 *
 * A browser canvas cannot do this. `canvas.toBlob('image/png')` always writes
 * truecolour — colour type 6, four bytes a pixel — so the only way to ship the
 * saving quantization produces is to write the file ourselves.
 *
 * ── The format, in the order it appears ───────────────────────────────────
 *   signature  8 bytes, fixed
 *   IHDR       width, height, bit depth, colour type 3 (palette), and three
 *              zeros for compression, filter and interlace methods
 *   PLTE       three bytes per palette entry, RGB only
 *   tRNS       one byte of alpha per entry, and — the part that saves space —
 *              it may stop early: entries past its end are fully opaque, so a
 *              palette sorted transparent-first writes a very short tRNS
 *   IDAT       zlib stream of the filtered scanlines
 *   IEND       empty
 * Every chunk is length, type, data, CRC-32 of type+data, all big-endian.
 *
 * ── Why the filter byte is always zero ────────────────────────────────────
 * PNG's row filters predict each byte from its neighbours, which works because
 * neighbouring *colours* are similar. In an indexed image the bytes are palette
 * indices, and index 4 sitting next to index 200 says nothing about how similar
 * those colours are — the numbering is arbitrary. Filtering indices therefore
 * usually makes the data harder to compress, and the specification recommends
 * filter type None for palette images. One byte of zero per row it is.
 *
 * ── Why sub-byte depths matter ────────────────────────────────────────────
 * A palette of 16 colours needs 4 bits per pixel, not 8. Packing halves the
 * data before deflate even sees it, and on the flat graphics and screenshots
 * that quantize best, small palettes are the normal case. Depths 1, 2, 4 and 8
 * are all written; 16 does not exist for palette images.
 *
 * ── Deflate is injected ───────────────────────────────────────────────────
 * Same reasoning as the PDF writer: the browser's `CompressionStream` is the
 * only compressor here, but passing it in keeps this module pure, keeps it
 * testable under Node with `zlib`, and means a future worker-based compressor
 * is a parameter change rather than a rewrite. `CompressionStream('deflate')`
 * emits zlib-wrapped output, which is exactly what IDAT wants.
 * ============================================================================
 */
import type { FailureReason } from '../../analytics.ts';
import { crc32 } from '../../files/zip.ts';
import { readPixels, type DecodedImage } from './codec.ts';
import { quantize, type PaletteEntry } from './quantize.ts';

export type PngDeflate = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface IndexedPng {
  width: number;
  height: number;
  /** One palette index per pixel, row-major. Length must be width × height. */
  indices: Uint8Array;
  palette: PaletteEntry[];
}

export type PngResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG's own ceiling is 2^31-1 per axis; this is the practical one. */
const MAX_EDGE = 65_535;

/** Smallest bit depth that can address `count` palette entries. */
export function bitDepthFor(count: number): 1 | 2 | 4 | 8 {
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 16) return 4;
  return 8;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the data, and never the length.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)) >>> 0, false);
  return out;
}

/**
 * Pack one row of indices at the given bit depth, with the leading filter byte.
 *
 * Sub-byte samples are packed most-significant-bit first, and a row that does
 * not fill its last byte leaves the remaining bits zero — PNG requires each
 * scanline to start on a byte boundary, so padding is per row rather than
 * continuous across the image. Getting that wrong produces an image that looks
 * correct at the top and shears progressively down the page.
 */
function packRow(indices: Uint8Array, offset: number, width: number, depth: number): Uint8Array {
  if (depth === 8) {
    const row = new Uint8Array(width + 1);
    row[0] = 0; // filter: None
    row.set(indices.subarray(offset, offset + width), 1);
    return row;
  }

  const perByte = 8 / depth;
  const bytes = Math.ceil(width / perByte);
  const row = new Uint8Array(bytes + 1);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const value = (indices[offset + x] as number) & ((1 << depth) - 1);
    const byteIndex = 1 + Math.floor(x / perByte);
    const slot = x % perByte;
    const shift = 8 - depth * (slot + 1);
    row[byteIndex] = (row[byteIndex] as number) | (value << shift);
  }
  return row;
}

/**
 * Order the palette so every entry carrying transparency comes first.
 *
 * tRNS is a prefix: it gives alpha for entries 0..n-1 and everything after is
 * opaque. Sorting this way makes that prefix as short as possible — for the
 * common case of one transparent colour in an otherwise opaque image, tRNS is
 * a single byte instead of 256 of them.
 *
 * Returns the new palette and a map from old index to new, so the caller can
 * rewrite the pixel data.
 */
export function orderPalette(palette: PaletteEntry[]): {
  palette: PaletteEntry[];
  remap: Uint8Array;
} {
  const order = palette
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.a - b.entry.a);

  const remap = new Uint8Array(palette.length);
  order.forEach((item, newIndex) => {
    remap[item.index] = newIndex;
  });
  return { palette: order.map((item) => item.entry), remap };
}

export async function encodeIndexedPng(image: IndexedPng, deflate: PngDeflate): Promise<PngResult> {
  const { width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, error: 'The image has no usable size.' };
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    return { ok: false, error: `Images above ${MAX_EDGE} pixels on a side cannot be written here.` };
  }
  if (image.palette.length < 1 || image.palette.length > 256) {
    return { ok: false, error: 'A palette image needs between 1 and 256 colours.' };
  }
  if (image.indices.length !== width * height) {
    return { ok: false, error: 'The pixel data does not match the stated size.' };
  }

  const { palette, remap } = orderPalette(image.palette);
  const depth = bitDepthFor(palette.length);

  // Rewrite the indices through the remap in one pass. A lookup table of at
  // most 256 entries makes this a byte substitution rather than a search.
  const indices = new Uint8Array(image.indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    indices[i] = remap[image.indices[i] as number] as number;
  }

  /* ── IHDR ─────────────────────────────────────────────────────────────── */
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
  header[8] = depth;
  header[9] = 3; // colour type 3 — indexed
  header[10] = 0; // compression: deflate, the only defined value
  header[11] = 0; // filter method 0, the only defined value
  header[12] = 0; // no interlacing

  /* ── PLTE and tRNS ────────────────────────────────────────────────────── */
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((entry, i) => {
    plte[i * 3] = entry.r;
    plte[i * 3 + 1] = entry.g;
    plte[i * 3 + 2] = entry.b;
  });

  // The prefix that is not fully opaque. See `orderPalette`.
  let transparentCount = 0;
  for (let i = 0; i < palette.length; i += 1) {
    if ((palette[i] as PaletteEntry).a < 255) transparentCount = i + 1;
  }
  const trns = new Uint8Array(transparentCount);
  for (let i = 0; i < transparentCount; i += 1) trns[i] = (palette[i] as PaletteEntry).a;

  /* ── IDAT ─────────────────────────────────────────────────────────────── */
  const rowBytes = depth === 8 ? width + 1 : Math.ceil(width / (8 / depth)) + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(packRow(indices, y * width, width, depth), y * rowBytes);
  }

  let compressed: Uint8Array;
  try {
    compressed = await deflate(raw);
  } catch {
    return { ok: false, error: 'This browser could not compress the image data.' };
  }

  /* ── assembly ─────────────────────────────────────────────────────────── */
  const parts: Uint8Array[] = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', plte),
    ...(transparentCount > 0 ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return { ok: true, bytes };
}

/**
 * `CompressionStream`-backed deflate, in the zlib wrapping IDAT requires.
 *
 * Kept beside the encoder rather than shared with the PDF writer's copy: that
 * one is part of the PDF module's contract and this one is part of this
 * module's, and a single shared helper would make either module's behaviour
 * depend on the other's needs.
 */
export function browserPngDeflate(): PngDeflate {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser cannot compress image data.');
  }
  return async (bytes: Uint8Array): Promise<Uint8Array> => {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    // Write and read concurrently: awaiting the write first deadlocks on any
    // input larger than the stream's internal buffer, because nothing drains it.
    const pump = (async (): Promise<void> => {
      await writer.write(bytes);
      await writer.close();
    })();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await pump;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of chunks) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
}

/**
 * A drop-in encoder for the image batch runner that writes an indexed PNG.
 *
 * Structurally typed rather than importing `CustomEncoder` from `batch.ts`, so
 * this module stays a leaf: the batch runner depends on the encoders it is
 * given, and none of them depends on it.
 *
 * ── Why this is offered as one candidate among several ────────────────────
 * It is lossy, and on a photograph it loses more than WebP does at the same
 * size. Rather than deciding that centrally, it competes: the batch runner
 * encodes every candidate and keeps whichever is smallest, and the tool says
 * which one won. On a screenshot this wins by a wide margin; on a photograph it
 * usually loses to WebP and is discarded.
 */
export function indexedPngEncoder(opts: { colors: number; dither?: boolean }) {
  return async (
    image: DecodedImage,
    signal: AbortSignal,
  ): Promise<
    | { ok: true; bytes: Uint8Array; width: number; height: number }
    | { ok: false; error: string; reason: FailureReason }
  > => {
    if (signal.aborted) {
      return { ok: false, error: 'Cancelled.', reason: 'cancelled' as FailureReason };
    }

    const pixels = readPixels(image);
    if (!pixels.ok) {
      return { ok: false, error: pixels.error, reason: pixels.reason };
    }

    const { width, height } = pixels.size;
    const { palette, indices } = quantize(pixels.data, width, height, {
      colors: opts.colors,
      dither: opts.dither,
    });

    let deflate: PngDeflate;
    try {
      deflate = browserPngDeflate();
    } catch {
      return {
        ok: false,
        error: 'This browser cannot write compressed PNGs.',
        reason: 'encode_unsupported' as FailureReason,
      };
    }

    const written = await encodeIndexedPng({ width, height, indices, palette }, deflate);
    if (!written.ok) {
      return { ok: false, error: written.error, reason: 'unknown' as FailureReason };
    }
    return { ok: true, bytes: written.bytes, width, height };
  };
}
