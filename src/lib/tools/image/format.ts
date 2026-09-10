/**
 * What an image really is, decided from its bytes alone.
 *
 * A file name is a label someone typed; the bytes are the truth. Every tool that
 * touches an image starts here: the "this is actually a PNG" notice on an upload,
 * the per-tool `accepts` check, and the dimensions shown before anything has been
 * decoded all come out of `sniffImage`.
 *
 * Two rules shaped this file.
 *
 * It is pure and isomorphic: no `document`, no `canvas`, no `fetch`, no `Buffer` —
 * nothing but the bytes handed in. Browser canvas work lives elsewhere. Everything
 * decidable from a header is decided here, where it can be unit-tested in Node
 * against real files from real encoders.
 *
 * Every read is bounds-checked. These bytes came from a stranger's upload, so a
 * header claiming a 4 GB chunk, a length that points backwards, or a file that
 * stops mid-sentence has to produce a shrug and a useful note — never an exception,
 * never a read past the end. Where something cannot be known it is `null`, because
 * an invented width is worse than an admitted gap.
 *
 * Two helpers that used to live here now come from `src/lib/files/`: byte
 * formatting and filename sanitising are needed by the PDF and text tools too,
 * and importing them from this module would have pulled every signature table
 * below into bundles that contain no images. Both are re-exported, so existing
 * callers and tests are unaffected.
 */
import { humanBytes } from '../../files/bytes.ts';
import { safeBaseName, splitName } from '../../files/name.ts';

export { humanBytes };

export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'avif'
  | 'heic'
  | 'tiff'
  | 'ico'
  | 'svg'
  | 'unknown';

export interface Sniffed {
  format: ImageFormat;
  /** The MIME type these bytes deserve, whatever the upload claimed. */
  mime: string;
  /** Canonical extension, no leading dot. 'jpg' for JPEG, the way people write it. */
  extension: string;
  /** Pixel dimensions, or null when the header does not say and guessing would lie. */
  width: number | null;
  height: number | null;
  /** null means the format allows transparency but this header cannot settle it. */
  hasAlpha: boolean | null;
  animated: boolean | null;
  /** One or two plain sentences for the person who uploaded the file. */
  note: string;
}

const FORMAT_MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  tiff: 'image/tiff',
  // 'image/x-icon' is the type browsers and servers actually use, even though
  // 'image/vnd.microsoft.icon' is the registered one.
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  unknown: 'application/octet-stream',
};

const FORMAT_EXTENSION: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  avif: 'avif',
  heic: 'heic',
  tiff: 'tiff',
  ico: 'ico',
  svg: 'svg',
  unknown: 'bin',
};

/** How each format is written in a sentence: 'WebP', not 'webp'. */
const FORMAT_LABEL: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  avif: 'AVIF',
  heic: 'HEIC',
  tiff: 'TIFF',
  ico: 'ICO',
  svg: 'SVG',
  unknown: 'an unrecognised format',
};

/**
 * Every MIME type we have seen in the wild for these formats.
 *
 * Browsers, phones and old servers all disagree: Internet Explorer sent
 * `image/pjpeg`, Windows sends `image/x-ms-bmp`, and plenty of code invents
 * `image/jpg` (which has never been a real type). They all mean something we can
 * open, so they all map.
 */
const MIME_ALIASES: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/png': 'png',
  'image/x-png': 'png',
  'image/apng': 'png',
  'image/vnd.mozilla.apng': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/avif': 'avif',
  'image/avif-sequence': 'avif',
  'image/heic': 'heic',
  'image/heic-sequence': 'heic',
  'image/heif': 'heic',
  'image/heif-sequence': 'heic',
  'image/tiff': 'tiff',
  'image/tif': 'tiff',
  'image/x-tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/ico': 'ico',
  'image/icon': 'ico',
  'image/svg+xml': 'svg',
  'image/svg': 'svg',
};

/**
 * Extensions people actually type, including the ones that are the same format
 * under another name. `.jpg` and `.jpeg` are one format, which is why a `.jpg`
 * holding a JPEG must never be reported as a mismatch.
 */
const EXTENSION_ALIASES: Record<string, ImageFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  jfif: 'jpeg',
  jif: 'jpeg',
  png: 'png',
  apng: 'png',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  dib: 'bmp',
  avif: 'avif',
  avifs: 'avif',
  heic: 'heic',
  heics: 'heic',
  heif: 'heic',
  hif: 'heic',
  tif: 'tiff',
  tiff: 'tiff',
  ico: 'ico',
  svg: 'svg',
};

/** The MIME type to serve bytes of this format as. */
export function mimeForFormat(format: ImageFormat): string {
  return FORMAT_MIME[format] ?? FORMAT_MIME.unknown;
}

/** The extension to save this format as, with no leading dot. */
export function extensionForFormat(format: ImageFormat): string {
  return FORMAT_EXTENSION[format] ?? FORMAT_EXTENSION.unknown;
}

/**
 * A declared MIME type turned into a format, or 'unknown' if we do not know it.
 *
 * Parameters are dropped (`image/svg+xml; charset=utf-8` is still SVG) and the
 * lookup is case-insensitive, because a claimed type is only ever a hint — the
 * bytes decide.
 */
export function formatFromMime(mime: string): ImageFormat {
  if (typeof mime !== 'string') return 'unknown';
  const normalised = mime.split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[normalised] ?? 'unknown';
}

/** The last dot-segment of a name, lowercased, with no leading dot. '' if there is none. */
function extensionOf(fileName: string): string {
  if (typeof fileName !== 'string') return '';
  const lastSeparator = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const segment = lastSeparator >= 0 ? fileName.slice(lastSeparator + 1) : fileName;
  const dot = segment.lastIndexOf('.');
  // `dot > 0` so that a dotfile ('.png') is a name, not an extension.
  return dot > 0 ? segment.slice(dot + 1).toLowerCase() : '';
}

/** What a file name claims to be, or 'unknown' for no extension or one we do not know. */
function formatFromExtension(extension: string): ImageFormat {
  return EXTENSION_ALIASES[extension] ?? 'unknown';
}

// -- reading bytes safely -----------------------------------------------------
//
// Every reader below answers -1 when the bytes it needs are not all there, which
// no real width, height, length or offset can ever be. Callers check for it. This
// is the whole defence against a truncated or hostile header, so it is worth the
// repetition.

/** One byte, or -1 past the end. */
function byteAt(bytes: Uint8Array, offset: number): number {
  return offset >= 0 && offset < bytes.length ? bytes[offset] : -1;
}

function u16be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) return -1;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) return -1;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 3 > bytes.length) return -1;
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  // `>>> 0` because the shift makes a signed 32-bit int, and a PNG width of
  // 0x80000000 would otherwise come out negative.
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return ((bytes[offset + 3] << 24) | (bytes[offset + 2] << 16) | (bytes[offset + 1] << 8) | bytes[offset]) >>> 0;
}

/** ASCII at a fixed offset, for the four-letter tags these formats are full of. */
function tagAt(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.length) return '';
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (offset < 0 || offset + signature.length > bytes.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * A dimension we are willing to print. A header that says zero, a negative
 * number or something absurd gets `null` and a note instead — every caller
 * treats `null` as "unknown", and none of them can be fooled by it.
 */
function dim(value: number): number | null {
  return Number.isInteger(value) && value > 0 && value <= 0x7fffffff ? value : null;
}

type SniffedDetail = Partial<Omit<Sniffed, 'format' | 'mime' | 'extension'>>;

/**
 * Build a result. The mime and extension always follow the format, so no parser
 * can accidentally report a PNG as `image/jpeg`, and anything a parser leaves out
 * is `null` rather than a plausible-looking default.
 */
function sniffResult(format: ImageFormat, detail: SniffedDetail): Sniffed {
  return {
    format,
    mime: mimeForFormat(format),
    extension: extensionForFormat(format),
    width: detail.width ?? null,
    height: detail.height ?? null,
    hasAlpha: detail.hasAlpha ?? null,
    animated: detail.animated ?? null,
    note: detail.note ?? '',
  };
}

// -- JPEG ---------------------------------------------------------------------

/**
 * Start Of Frame markers: the only ones carrying the real dimensions.
 *
 * SOF0/1 are sequential, SOF2 progressive, SOF3 lossless, and 5-7 / 9-11 / 13-15
 * are the differential, arithmetic-coded and hierarchical variants nobody makes
 * any more but which are still legal JPEG with a frame header in the same shape.
 * 0xC4 (DHT), 0xC8 (JPG) and 0xCC (DAC) sit inside that range and are *not*
 * frame headers, which is why this is a list and not a range check.
 */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** The progressive subset of those, the ones that render in blurry-to-sharp passes. */
const JPEG_PROGRESSIVE_MARKERS = new Set([0xc2, 0xc6, 0xca, 0xce]);

/**
 * JPEG: `FF D8 FF` — Start Of Image followed by the first marker's own 0xFF.
 *
 * The dimensions are not at a fixed offset. A JPEG is a chain of segments, each
 * `FF <marker> <big-endian length including those two length bytes> <payload>`,
 * and the thumbnail, colour profile, quantisation and Huffman tables all come
 * first. So we walk: skip each segment by its declared length until a frame
 * header turns up, and stop at Start Of Scan, after which the bytes are entropy
 * -coded pixel data and no longer a segment chain.
 *
 * Two details bite people. Any number of 0xFF fill bytes may sit between
 * segments, so the 0xFF run is skipped rather than counted. And a length below 2
 * cannot include its own two bytes, so it is corruption, not a segment.
 */
function sniffJpeg(bytes: Uint8Array): Sniffed {
  let width: number | null = null;
  let height: number | null = null;
  let progressive = false;
  let components = -1;
  let truncated = false;
  let offset = 2;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      // A marker has to start here. It does not, so the chain is broken; hunting
      // for the next plausible 0xFF would only invent an answer.
      truncated = true;
      break;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) {
      truncated = true;
      break;
    }
    const marker = bytes[offset];
    offset += 1;
    // Standalone markers with no payload: another SOI, TEM, and the restart markers.
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break; // End Of Image
    if (marker === 0xda) break; // Start Of Scan: pixel data from here on
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) {
      truncated = true;
      break;
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      // Frame header: length, 1 byte sample precision, height, width, component count.
      height = dim(u16be(bytes, offset + 3));
      width = dim(u16be(bytes, offset + 5));
      components = byteAt(bytes, offset + 7);
      progressive = JPEG_PROGRESSIVE_MARKERS.has(marker);
      break;
    }
    offset += length;
  }

  return sniffResult('jpeg', {
    width,
    height,
    // JPEG has no alpha channel at all. Anything transparent in the original was
    // flattened onto a background when it was saved, usually a white one.
    hasAlpha: false,
    animated: false,
    note: jpegNote(width, progressive, components, truncated),
  });
}

function jpegNote(width: number | null, progressive: boolean, components: number, truncated: boolean): string {
  if (width === null) {
    return truncated
      ? 'A JPEG, but it stops before the header that holds its size — the file looks truncated. It may still be worth trying.'
      : 'A JPEG whose header does not state its size, which is unusual but not fatal.';
  }
  const kind = progressive
    ? 'A progressive JPEG: it is stored in passes, so it appears rough and then sharpens as it loads.'
    : 'A baseline JPEG, the ordinary kind that every program on earth can open.';
  const colour =
    components === 1
      ? ' It is greyscale.'
      : components === 4
        ? ' It stores four channels (CMYK), which is a print colour space — browsers handle it inconsistently.'
        : '';
  return kind + colour + ' JPEG has no transparency, so anything see-through was flattened when it was saved.';
}

// -- PNG ----------------------------------------------------------------------

/** `89 P N G \r \n 1A \n` — chosen so that a text-mode transfer visibly corrupts it. */
const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG colour types 0, 2, 3, 4 and 6. There is no 1 or 5. */
const PNG_COLOUR_NAMES: Record<number, string> = {
  0: 'greyscale',
  2: 'truecolour',
  3: 'a palette',
  4: 'greyscale with transparency',
  6: 'truecolour with transparency',
};

/**
 * PNG: the eight-byte signature, then IHDR at a fixed offset, then a chunk chain.
 *
 * IHDR is always the first chunk, so width, height, bit depth and colour type sit
 * at known offsets. Transparency and animation do not: `tRNS` gives a palette
 * image its see-through entry, and `acTL` is what makes a PNG an APNG. Both are
 * required to appear before the first `IDAT`, so the walk stops there — which also
 * means we never march through the pixel data of a 40 MB file to learn nothing.
 *
 * The chain is walked by declared length (4 length + 4 type + data + 4 CRC), never
 * by scanning for the four letters, because 'acTL' can occur inside compressed
 * pixel data by coincidence and a scan would report a still image as animated.
 */
function sniffPng(bytes: Uint8Array): Sniffed {
  const width = dim(u32be(bytes, 16));
  const height = dim(u32be(bytes, 20));
  const bitDepth = byteAt(bytes, 24);
  const colourType = byteAt(bytes, 25);
  const interlaced = byteAt(bytes, 28) === 1;
  const hasIhdr = tagAt(bytes, 12, 4) === 'IHDR';
  let hasTrns = false;
  let apngFrames = 0;

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = tagAt(bytes, offset + 4, 4);
    // A chunk length above 2^31 - 1 is forbidden by the spec and cannot be held
    // in memory here anyway.
    if (length < 0 || length > 0x7fffffff || type === '') break;
    if (type === 'tRNS') hasTrns = true;
    if (type === 'acTL') apngFrames = Math.max(u32be(bytes, offset + 8), 0);
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }

  const hasAlpha = colourType < 0 ? null : colourType === 4 || colourType === 6 || hasTrns;
  return sniffResult('png', {
    width,
    height,
    hasAlpha,
    animated: apngFrames > 0,
    note: pngNote(width, bitDepth, colourType, interlaced, hasTrns, apngFrames, hasIhdr),
  });
}

function pngNote(
  width: number | null,
  bitDepth: number,
  colourType: number,
  interlaced: boolean,
  hasTrns: boolean,
  apngFrames: number,
  hasIhdr: boolean,
): string {
  if (width === null) {
    return hasIhdr
      ? 'A PNG whose header is cut short before the size — the file looks truncated.'
      : 'A PNG signature with no header behind it. The file is truncated or damaged.';
  }
  const colour = PNG_COLOUR_NAMES[colourType] ?? 'an unknown colour type';
  // PNG's legal depths are 1, 2, 4, 8 and 16, and 8 is the only one spoken with a
  // leading vowel — "an 8-bit PNG", but "a 16-bit PNG".
  const parts = [`${bitDepth === 8 ? 'An' : 'A'} ${bitDepth}-bit PNG using ${colour}.`];
  if (apngFrames > 0) {
    parts.push(
      `It is an APNG with ${apngFrames} frames — animated PNGs play in every current browser, but most image editors only show the first frame.`,
    );
  }
  if (hasTrns && colourType === 3) parts.push('One palette entry is transparent.');
  if (interlaced) parts.push('It is interlaced (Adam7), so it appears blurry then sharpens while loading.');
  return parts.join(' ');
}

// -- GIF ----------------------------------------------------------------------

/**
 * GIF: `GIF87a` or `GIF89a`, then the logical screen size little-endian.
 *
 * Animation means a second image descriptor, and finding one honestly means
 * walking the block structure: a byte 0x2C appears constantly inside LZW pixel
 * data, so searching for it would call half the still GIFs on the internet
 * animated. The walk is: optional global colour table (its size is packed into
 * three bits of byte 10), then blocks — 0x21 extension (a label plus a chain of
 * length-prefixed sub-blocks), 0x2C image (a 9-byte descriptor, an optional local
 * colour table, then a sub-block chain), 0x3B trailer.
 *
 * Transparency comes from the graphic control extension's low flag bit. GIF
 * transparency is one bit per pixel: a pixel is either fully there or fully gone,
 * which is why GIF edges look jagged over a coloured background.
 */
function sniffGif(bytes: Uint8Array): Sniffed {
  const version = tagAt(bytes, 3, 3);
  const width = dim(u16le(bytes, 6));
  const height = dim(u16le(bytes, 8));
  const packed = byteAt(bytes, 10);

  let offset = 13;
  if (packed >= 0 && (packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1));

  let frames = 0;
  let transparent = false;
  let sawTrailer = false;
  let damaged = packed < 0;

  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (block === 0x21) {
      const label = byteAt(bytes, offset + 1);
      const blockSize = byteAt(bytes, offset + 2);
      // Graphic control extension: its first sub-block is 4 bytes, and bit 0 of
      // the packed field says a palette entry is to be treated as transparent.
      if (label === 0xf9 && blockSize >= 4 && (byteAt(bytes, offset + 3) & 0x01) === 1) transparent = true;
      const next = skipGifSubBlocks(bytes, offset + 2);
      if (next < 0) {
        damaged = true;
        break;
      }
      offset = next;
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      const localPacked = byteAt(bytes, offset + 9);
      if (localPacked < 0) {
        damaged = true;
        break;
      }
      let next = offset + 10;
      if ((localPacked & 0x80) !== 0) next += 3 * (1 << ((localPacked & 0x07) + 1));
      next += 1; // LZW minimum code size, then the pixel data sub-block chain
      next = skipGifSubBlocks(bytes, next);
      if (next < 0) {
        damaged = true;
        break;
      }
      offset = next;
      continue;
    }
    // Anything else here is not a block introducer, so the structure is broken.
    damaged = true;
    break;
  }

  const incomplete = damaged || !sawTrailer;
  return sniffResult('gif', {
    width,
    height,
    // A frame we could not reach might have carried transparency, so an
    // incomplete walk over a file with none found so far cannot answer.
    hasAlpha: transparent ? true : incomplete ? null : false,
    animated: frames > 1,
    note: gifNote(width, version, frames, transparent, incomplete),
  });
}

/**
 * Walk a chain of length-prefixed sub-blocks and answer the offset just past its
 * zero terminator, or -1 if it runs off the end of the file.
 */
function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset];
    if (size === 0) return offset + 1;
    offset += 1 + size;
  }
  return -1;
}

function gifNote(
  width: number | null,
  version: string,
  frames: number,
  transparent: boolean,
  incomplete: boolean,
): string {
  if (width === null) return 'A GIF whose header is too short to hold a size. The file is truncated.';
  const parts: string[] = [];
  if (frames > 1) parts.push(`An animated GIF with ${frames} frames.`);
  else parts.push(`A GIF${version === '87a' ? ' in the original 1987 flavour' : ''}, a single still frame.`);
  parts.push('GIF is limited to 256 colours per frame, so photographs come out banded.');
  if (transparent) parts.push('It has transparency, though only the hard-edged kind: a pixel is either there or not.');
  if (incomplete) parts.push('The block structure ends early, so this file may be truncated.');
  return parts.join(' ');
}

// -- WebP ---------------------------------------------------------------------

/** The VP8 keyframe start code, immediately after the 3-byte frame tag. */
const WEBP_VP8_SYNC: readonly number[] = [0x9d, 0x01, 0x2a];

/**
 * WebP: `RIFF` at 0, `WEBP` at 8, then RIFF chunks — a four-letter tag, a
 * little-endian size, the payload, and a pad byte when that size is odd.
 *
 * There are three ways a WebP can state its size, and a tool that reads only one
 * of them will report nothing for a third of real files:
 *
 * - `VP8 ` is lossy VP8. Skip the 3-byte frame tag, check the `9D 01 2A` sync
 *   code, then two 16-bit values whose low 14 bits are width and height. The top
 *   two bits are upscaling hints, not size.
 * - `VP8L` is lossless, and packs its header as a bit stream, LSB first: 14 bits
 *   of width-1, 14 of height-1, one alpha-used bit, three of version. Reading the
 *   little-endian 32-bit word after the 0x2F signature byte lines all of that up.
 * - `VP8X` is the extended form used by animated and alpha-plus-lossy files. Its
 *   canvas size is two 24-bit minus-one values, and its flag byte carries ANIM
 *   (0x02) and ALPHA (0x10).
 *
 * Minus-one encoding is why an empty-looking WebP still reports 1x1 rather than 0.
 */
function sniffWebp(bytes: Uint8Array): Sniffed {
  let width: number | null = null;
  let height: number | null = null;
  let fromCanvas = false;
  let animated = false;
  let alphaFlag: boolean | null = null;
  let lossyFrame = false;
  let kind = '';
  let frames = 0;

  // The RIFF size at offset 4 covers everything after it. Trusting it over the
  // real length would let a lying header send the walk past the end, so take
  // whichever is smaller.
  const riffSize = u32le(bytes, 4);
  const end = riffSize >= 0 ? Math.min(bytes.length, 8 + riffSize) : bytes.length;

  let offset = 12;
  while (offset + 8 <= end) {
    const fourcc = tagAt(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    if (fourcc === '' || size < 0) break;
    const payload = offset + 8;

    if (fourcc === 'VP8X') {
      const flags = byteAt(bytes, payload);
      if (flags >= 0) {
        if ((flags & 0x02) !== 0) animated = true;
        alphaFlag = (flags & 0x10) !== 0;
      }
      const canvasWidth = u24le(bytes, payload + 4);
      const canvasHeight = u24le(bytes, payload + 7);
      if (canvasWidth >= 0 && canvasHeight >= 0) {
        width = dim(canvasWidth + 1);
        height = dim(canvasHeight + 1);
        fromCanvas = true;
      }
    } else if (fourcc === 'VP8 ') {
      if (kind === '') kind = 'lossy';
      if (matches(bytes, payload + 3, WEBP_VP8_SYNC)) {
        // A lossy VP8 keyframe has three planes and no fourth: transparency in a
        // lossy WebP always arrives in a separate ALPH chunk. So a readable frame
        // with no ALPH beside it is opaque, and that is worth saying rather than
        // shrugging at.
        lossyFrame = true;
        if (!fromCanvas) {
          const rawWidth = u16le(bytes, payload + 6);
          const rawHeight = u16le(bytes, payload + 8);
          if (rawWidth >= 0) width = dim(rawWidth & 0x3fff);
          if (rawHeight >= 0) height = dim(rawHeight & 0x3fff);
        }
      }
    } else if (fourcc === 'VP8L') {
      if (kind === '') kind = 'lossless';
      const header = byteAt(bytes, payload) === 0x2f ? u32le(bytes, payload + 1) : -1;
      if (header >= 0) {
        if (!fromCanvas) {
          width = dim((header & 0x3fff) + 1);
          height = dim(((header >>> 14) & 0x3fff) + 1);
        }
        // Bit 28 is alpha_is_used, which an encoder clears only when every pixel
        // is fully opaque. It is a definite no, so record it as one — but never
        // over a yes already found in VP8X or ALPH.
        if (((header >>> 28) & 0x01) === 1) alphaFlag = true;
        else if (alphaFlag === null) alphaFlag = false;
      }
    } else if (fourcc === 'ANIM') {
      animated = true;
    } else if (fourcc === 'ANMF') {
      frames += 1;
    } else if (fourcc === 'ALPH') {
      // Lossy plus alpha: the transparency rides in its own chunk beside VP8.
      alphaFlag = true;
    }
    offset = payload + size + (size % 2);
  }

  // ALPH is allowed to come after VP8 in the chunk order, so this is settled once
  // the whole file has been walked rather than inside the branch.
  if (alphaFlag === null && lossyFrame) alphaFlag = false;

  return sniffResult('webp', {
    width,
    height,
    hasAlpha: alphaFlag,
    animated,
    note: webpNote(width, kind, animated, frames, alphaFlag),
  });
}

function webpNote(
  width: number | null,
  kind: string,
  animated: boolean,
  frames: number,
  alpha: boolean | null,
): string {
  if (width === null) {
    return 'A WebP container we could not read a size from — it is truncated, or holds a sub-format this reader does not know.';
  }
  const parts: string[] = [];
  if (animated) {
    parts.push(
      frames > 0
        ? `An animated WebP with ${frames} frames — the modern replacement for an animated GIF, and far smaller.`
        : 'An animated WebP, the modern replacement for an animated GIF.',
    );
  } else if (kind === 'lossless') {
    parts.push('A lossless WebP: pixel-exact, like a PNG but smaller.');
  } else if (kind === 'lossy') {
    parts.push('A lossy WebP: sized like a JPEG at similar quality, often smaller.');
  } else {
    parts.push('A WebP.');
  }
  if (alpha === true) parts.push('It has real, gradual transparency.');
  return parts.join(' ');
}

// -- BMP ----------------------------------------------------------------------

/**
 * BMP: `BM`, then a 14-byte file header, then a DIB header whose first field is
 * its own length — which is how you tell the two shapes apart.
 *
 * 12 is the 1990 BITMAPCOREHEADER with 16-bit dimensions. 40 and up
 * (BITMAPINFOHEADER, V4, V5) use signed 32-bit ones, and a negative height is a
 * legal way of saying the rows are stored top-down instead of bottom-up. The
 * picture is the same either way, so the absolute value is the height, and the
 * oddity goes in the note.
 */
function sniffBmp(bytes: Uint8Array): Sniffed {
  const headerSize = u32le(bytes, 14);
  let width: number | null = null;
  let rawHeight = 0;
  let bitCount = -1;
  let compression = -1;
  let alphaMask = -1;

  if (headerSize === 12) {
    width = dim(u16le(bytes, 18));
    const stored = u16le(bytes, 20);
    rawHeight = stored < 0 ? 0 : signed16(stored);
    bitCount = u16le(bytes, 24);
    // The 1990 header has no compression field because it had no compression:
    // these pixels are always stored raw.
    compression = 0;
  } else if (headerSize >= 40) {
    const storedWidth = u32le(bytes, 18);
    const storedHeight = u32le(bytes, 22);
    width = storedWidth < 0 ? null : dim(storedWidth | 0);
    rawHeight = storedHeight < 0 ? 0 : storedHeight | 0;
    bitCount = u16le(bytes, 28);
    compression = u32le(bytes, 30);
    // V4 (108) and V5 (124) headers name the alpha bits explicitly. 56-byte
    // headers are the same up to that field, so the mask is readable there too.
    if (headerSize >= 56) alphaMask = u32le(bytes, 14 + 52);
  }

  const topDown = rawHeight < 0;
  const height = dim(Math.abs(rawHeight));
  let hasAlpha: boolean | null = false;
  if (bitCount === 32 || bitCount === 16) {
    if (alphaMask >= 0) hasAlpha = alphaMask !== 0;
    else if (compression === 6) hasAlpha = true; // BI_ALPHABITFIELDS
    else if (bitCount === 32) hasAlpha = null; // the fourth byte is undefined here
  }

  return sniffResult('bmp', {
    width,
    height,
    hasAlpha,
    animated: false,
    note: bmpNote(width, headerSize, bitCount, compression, topDown, hasAlpha),
  });
}

function signed16(value: number): number {
  return value > 0x7fff ? value - 0x10000 : value;
}

function bmpNote(
  width: number | null,
  headerSize: number,
  bitCount: number,
  compression: number,
  topDown: boolean,
  hasAlpha: boolean | null,
): string {
  if (width === null) {
    return headerSize < 0
      ? 'A BMP signature with no header behind it — the file is truncated.'
      : 'A BMP with a header shape this reader does not know, so its size cannot be trusted.';
  }
  const parts = [`A ${bitCount > 0 ? `${bitCount}-bit ` : ''}BMP.`];
  if (compression === 0 || compression === 3) {
    parts.push('BMP stores pixels uncompressed, which is why these files are so much larger than a PNG of the same image.');
  }
  if (headerSize === 12) parts.push('It uses the original 1990 header, so it is a very old file or from very old software.');
  if (topDown) parts.push('Its rows are stored top-down, signalled by a negative height — legal, but unusual.');
  if (hasAlpha === null) {
    parts.push('Each pixel has a fourth byte that this header does not describe: in some files it is transparency, in others unused padding.');
  }
  return parts.join(' ');
}

// -- ISO base media (AVIF and HEIC) -------------------------------------------

/**
 * `ftyp` at offset 4 means an ISO base media file: AVIF, HEIC, and also MP4 and
 * friends, which are not still images at all. The brands say which.
 */
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
/** Brands whose files are sequences rather than one still picture. */
const SEQUENCE_BRANDS = new Set(['avis', 'msf1', 'hevc', 'hevx', 'heis']);

interface IsoBox {
  type: string;
  /** First byte of the box, where its size field is. */
  start: number;
  /** One past its last byte, clamped to what we actually hold. */
  end: number;
  /** First byte after the header, where the payload starts. */
  content: number;
}

/**
 * Walk the boxes between two offsets, in order.
 *
 * A box is a 32-bit size (covering the header as well), a four-letter type, then
 * its payload. Size 1 means the real size is a 64-bit value after the type; size 0
 * means "to the end of the file". A size below the header length would leave the
 * walk standing still, so it stops — that is the loop-forever case a malformed
 * upload would otherwise buy.
 */
function eachIsoBox(bytes: Uint8Array, start: number, end: number, visit: (box: IsoBox) => void): void {
  let offset = start;
  while (offset + 8 <= end) {
    const declared = u32be(bytes, offset);
    const type = tagAt(bytes, offset + 4, 4);
    if (declared < 0 || type === '') return;
    let size = declared;
    let header = 8;
    if (declared === 1) {
      const high = u32be(bytes, offset + 8);
      const low = u32be(bytes, offset + 12);
      // A box bigger than 4 GB cannot be in a Uint8Array we were handed, so there
      // is nothing useful to read inside it.
      if (high !== 0 || low < 0) return;
      size = low;
      header = 16;
    } else if (declared === 0) {
      size = end - offset;
    }
    if (size < header) return;
    visit({ type, start: offset, end: Math.min(offset + size, end), content: offset + header });
    offset += size;
  }
}

/** The image size box: version and flags, then two 32-bit dimensions. */
function readIspe(bytes: Uint8Array, box: IsoBox): { width: number | null; height: number | null } {
  return {
    width: dim(u32be(bytes, box.content + 4)),
    height: dim(u32be(bytes, box.content + 8)),
  };
}

/** The primary item box: which item in the file is the picture you meant. */
function readPitm(bytes: Uint8Array, box: IsoBox): number {
  const version = byteAt(bytes, box.content);
  if (version < 0) return -1;
  return version >= 1 ? u32be(bytes, box.content + 4) : u16be(bytes, box.content + 4);
}

/**
 * The item-property association box: for each item, which of `ipco`'s children
 * describe it. Indices are 1-based into `ipco`, and are 7-bit unless flag bit 0
 * says they are 15-bit. The top bit of each is "essential", not part of the index.
 */
function readIpma(bytes: Uint8Array, box: IsoBox, into: Map<number, number[]>): void {
  const version = byteAt(bytes, box.content);
  const lowFlagByte = byteAt(bytes, box.content + 3);
  if (version < 0 || lowFlagByte < 0) return;
  const wideIds = version >= 1;
  const wideIndices = (lowFlagByte & 0x01) === 1;
  const entries = u32be(bytes, box.content + 4);
  let offset = box.content + 8;
  for (let entry = 0; entry < entries && offset < box.end; entry += 1) {
    const itemId = wideIds ? u32be(bytes, offset) : u16be(bytes, offset);
    offset += wideIds ? 4 : 2;
    const count = byteAt(bytes, offset);
    offset += 1;
    if (itemId < 0 || count < 0) return;
    const indices: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = wideIndices ? u16be(bytes, offset) : byteAt(bytes, offset);
      if (value < 0) return;
      indices.push(wideIndices ? value & 0x7fff : value & 0x7f);
      offset += wideIndices ? 2 : 1;
    }
    into.set(itemId, indices);
  }
}

/**
 * AVIF and HEIC: the same container, told apart by brand.
 *
 * Nothing here is at a fixed offset. The size lives in an `ispe` box nested
 * `meta` > `iprp` > `ipco`, and a file may hold several — a thumbnail, an alpha
 * plane, an HDR gain map — so the right one is found through `pitm` (which item is
 * the picture) and `ipma` (which properties belong to that item). When those two
 * are missing or unreadable and more than one candidate remains, the note says
 * which one was taken instead of pretending there was only ever one.
 */
function sniffIsoBmff(bytes: Uint8Array): Sniffed {
  const ftypSize = u32be(bytes, 0);
  const ftypEnd = ftypSize > 8 ? Math.min(ftypSize, bytes.length) : bytes.length;
  const major = tagAt(bytes, 8, 4);
  // Brands are case-sensitive in the spec, but every brand we test for is
  // lowercase, so folding case here only ever helps.
  const brands = major === '' ? [] : [major.toLowerCase()];
  for (let offset = 16; offset + 4 <= ftypEnd && brands.length < 32; offset += 4) {
    const brand = tagAt(bytes, offset, 4);
    if (brand !== '') brands.push(brand.toLowerCase());
  }

  const isAvif = brands.some((brand) => AVIF_BRANDS.has(brand));
  const isHeic = brands.some((brand) => HEIC_BRANDS.has(brand));
  if (!isAvif && !isHeic) {
    return sniffResult('unknown', {
      note:
        major === ''
          ? 'An ISO media container too short to say what it holds.'
          : `An ISO media container branded "${major}". That is the MP4 family — video or audio, not a still image.`,
    });
  }
  const format: ImageFormat = isAvif ? 'avif' : 'heic';

  const properties: IsoBox[] = [];
  const associations = new Map<number, number[]>();
  let primaryItem = -1;
  let sawMovie = false;

  eachIsoBox(bytes, 0, bytes.length, (top) => {
    if (top.type === 'moov') sawMovie = true;
    if (top.type !== 'meta') return;
    // `meta` is a full box: four bytes of version and flags come before its children.
    eachIsoBox(bytes, top.content + 4, top.end, (inMeta) => {
      if (inMeta.type === 'pitm') primaryItem = readPitm(bytes, inMeta);
      if (inMeta.type !== 'iprp') return;
      eachIsoBox(bytes, inMeta.content, inMeta.end, (inIprp) => {
        if (inIprp.type === 'ipma') readIpma(bytes, inIprp, associations);
        if (inIprp.type !== 'ipco') return;
        eachIsoBox(bytes, inIprp.content, inIprp.end, (property) => {
          properties.push(property);
        });
      });
    });
  });

  let chosen: IsoBox | null = null;
  let ambiguous = false;
  let channels = -1;
  for (const index of associations.get(primaryItem) ?? []) {
    const property = properties[index - 1];
    if (!property) continue;
    if (property.type === 'ispe' && chosen === null) chosen = property;
    // `pixi` counts the channels the primary image stores. Three or one means no
    // alpha is hiding in it; AVIF and HEIC keep transparency in a separate item.
    if (property.type === 'pixi' && channels < 0) channels = byteAt(bytes, property.content + 4);
  }
  if (chosen === null) {
    const candidates = properties.filter((property) => property.type === 'ispe');
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else if (candidates.length > 1) {
      ambiguous = true;
      for (const candidate of candidates) {
        const size = readIspe(bytes, candidate);
        const best = chosen === null ? null : readIspe(bytes, chosen);
        const area = (size.width ?? 0) * (size.height ?? 0);
        const bestArea = best === null ? -1 : (best.width ?? 0) * (best.height ?? 0);
        if (area > bestArea) chosen = candidate;
      }
    }
  }

  const size = chosen === null ? { width: null, height: null } : readIspe(bytes, chosen);
  // An auxiliary item declaring the alpha URN is how both formats say "there is
  // transparency in here". Without one, a 1- or 3-channel primary settles it.
  const hasAuxAlpha = properties.some(
    (property) =>
      property.type === 'auxC' &&
      tagAt(bytes, property.content, Math.min(property.end - property.content, 96)).includes('auxiliary:alpha'),
  );
  const animated = sawMovie || brands.some((brand) => SEQUENCE_BRANDS.has(brand));

  return sniffResult(format, {
    width: size.width,
    height: size.height,
    hasAlpha: hasAuxAlpha ? true : channels === 1 || channels === 3 ? false : null,
    animated,
    note: isoNote(format, size.width, ambiguous, animated),
  });
}

function isoNote(format: ImageFormat, width: number | null, ambiguous: boolean, animated: boolean): string {
  const parts: string[] = [];
  parts.push(
    format === 'avif'
      ? 'An AVIF. It compresses far harder than JPEG at the same quality, and Chrome, Firefox and Safari all display it.'
      : 'A HEIC, which is what an iPhone saves by default. No browser will display it, so converting to JPEG or WebP is usually the point.',
  );
  if (animated) parts.push('It holds a sequence of images rather than one still frame.');
  if (width === null) {
    parts.push(
      'Its dimensions are nested inside the container in a layout this reader could not follow, so they are not shown rather than guessed at.',
    );
  } else if (ambiguous) {
    parts.push('It describes several images and does not say which is the main one, so the largest is shown.');
  }
  return parts.join(' ');
}

// -- TIFF ---------------------------------------------------------------------

/**
 * TIFF: `II 2A 00` for little-endian, `MM 00 2A` for big — the byte order is
 * declared by the file, and every number in it, including the offsets, follows.
 *
 * After the 8-byte header comes an offset to the first image file directory: a
 * count, then 12-byte entries of tag, type, count, and either the value itself or
 * an offset to it. Width and height are tags 0x0100 and 0x0101, and they may be
 * stored as SHORT or LONG in the same file — libtiff writes LONG, cameras often
 * write SHORT — so the type has to be honoured rather than assumed.
 */
function sniffTiff(bytes: Uint8Array): Sniffed {
  const little = bytes[0] === 0x49;
  const read16 = little ? u16le : u16be;
  const read32 = little ? u32le : u32be;
  const version = read16(bytes, 2);
  const order = little ? 'little-endian (Intel)' : 'big-endian (Motorola)';

  if (version === 43) {
    // BigTIFF: same idea, 64-bit offsets, an entirely different entry layout.
    return sniffResult('tiff', {
      animated: false,
      note: `A BigTIFF (${order}), the 64-bit variant used for files over 4 GB. Its directory layout differs, so its size is not read here.`,
    });
  }

  const directory = read32(bytes, 4);
  if (directory < 8 || directory + 2 > bytes.length) {
    return sniffResult('tiff', {
      animated: false,
      note: `A TIFF (${order}) whose directory offset points outside the file — it is truncated or damaged.`,
    });
  }

  const entries = read16(bytes, directory);
  let width: number | null = null;
  let height: number | null = null;
  let bits = -1;
  let samples = -1;
  let extraSamples = -2; // -2 = the tag was absent, -1 = present but unreadable

  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    const tag = read16(bytes, entry);
    const type = read16(bytes, entry + 2);
    const count = read32(bytes, entry + 4);
    const value = tiffValue(bytes, entry + 8, type, count, read16, read32);
    if (tag === 0x0100) width = dim(value);
    else if (tag === 0x0101) height = dim(value);
    else if (tag === 0x0102) bits = value;
    else if (tag === 0x0115) samples = value;
    else if (tag === 0x0152) extraSamples = value;
  }

  // A non-zero offset here chains to a second directory: a multi-page TIFF, the
  // way faxes and scanners store several images in one file.
  const nextDirectory = entries > 0 ? read32(bytes, directory + 2 + entries * 12) : 0;
  const multiPage = nextDirectory > 0;

  let hasAlpha: boolean | null;
  if (extraSamples >= 1) hasAlpha = true; // 1 = premultiplied alpha, 2 = plain alpha
  else if (extraSamples === 0) hasAlpha = false; // present, but "unspecified data"
  else if (samples >= 4) hasAlpha = null; // a fourth channel nobody described
  else hasAlpha = false;

  return sniffResult('tiff', {
    width,
    height,
    hasAlpha,
    // Multi-page is not animation: the pages are separate pictures, and nothing
    // plays them in sequence.
    animated: false,
    note: tiffNote(width, order, bits, samples, multiPage),
  });
}

/** The byte width of the TIFF field types small enough to hold a dimension. */
const TIFF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4 };

/**
 * The first value of a directory entry, wherever it is kept.
 *
 * An entry has four bytes for its value. When the value fits, it is right there;
 * when it does not, those four bytes are an offset to it instead. This is not a
 * rare corner: an RGB TIFF's BitsPerSample is three SHORTs, six bytes, so it is
 * always out of line — and reading the entry directly would report the offset
 * (134, in a file libtiff wrote) as the bit depth.
 *
 * Multi-value tags give up their first value, which is what every tag read here
 * wants: BitsPerSample is per channel and the channels match.
 */
function tiffValue(
  bytes: Uint8Array,
  offset: number,
  type: number,
  count: number,
  read16: (bytes: Uint8Array, offset: number) => number,
  read32: (bytes: Uint8Array, offset: number) => number,
): number {
  const size = TIFF_TYPE_SIZES[type];
  if (size === undefined || count < 1) return -1;
  let at = offset;
  if (size * count > 4) {
    const pointer = read32(bytes, offset);
    if (pointer < 0 || pointer + size > bytes.length) return -1;
    at = pointer;
  }
  if (type === 1 || type === 2) return byteAt(bytes, at); // BYTE, ASCII
  if (type === 3) return read16(bytes, at); // SHORT
  return read32(bytes, at); // LONG
}

function tiffNote(width: number | null, order: string, bits: number, samples: number, multiPage: boolean): string {
  if (width === null) {
    return `A TIFF (${order}) whose first directory does not state a size. It may be truncated, or a camera raw file wearing a TIFF header.`;
  }
  const parts = [`A TIFF, ${order}.`];
  if (bits > 8) parts.push(`It stores ${bits} bits per channel, more than a screen can show and more than a JPEG can keep.`);
  if (samples === 1) parts.push('It is single-channel: greyscale, or a scanned document.');
  if (multiPage) parts.push('It holds more than one page — only the first is described here.');
  parts.push('No browser displays TIFF, so it usually needs converting before it is any use on the web.');
  return parts.join(' ');
}

// -- ICO ----------------------------------------------------------------------

/** `00 00 01 00`: two reserved zero bytes, then the type 1 for an icon. */
const ICO_SIGNATURE: readonly number[] = [0x00, 0x00, 0x01, 0x00];

/**
 * ICO: a directory of images, each entry 16 bytes, the first at offset 6.
 *
 * The stored width and height are single bytes, so 256 does not fit — it is
 * written as 0, which is the one place in these formats where zero means
 * something. Modern icons hold a whole PNG per entry; when they do, that PNG is
 * the better authority, since it can state a size the directory cannot express
 * and it says outright whether there is an alpha channel.
 */
function sniffIco(bytes: Uint8Array): Sniffed {
  const count = u16le(bytes, 4);
  if (count <= 0) {
    return sniffResult('ico', { animated: false, note: 'An icon file with no images listed in it. It is empty or truncated.' });
  }

  const firstWidth = byteAt(bytes, 6);
  const firstHeight = byteAt(bytes, 7);
  const bitCount = u16le(bytes, 12);
  const dataSize = u32le(bytes, 14);
  const dataOffset = u32le(bytes, 18);

  let width = firstWidth < 0 ? null : dim(firstWidth === 0 ? 256 : firstWidth);
  let height = firstHeight < 0 ? null : dim(firstHeight === 0 ? 256 : firstHeight);
  let embeddedPng = false;
  let hasAlpha: boolean | null = bitCount === 32 ? true : null;

  if (dataOffset > 0 && dataSize > 0 && dataOffset + dataSize <= bytes.length && matches(bytes, dataOffset, PNG_SIGNATURE)) {
    embeddedPng = true;
    const inner = sniffPng(bytes.subarray(dataOffset, dataOffset + dataSize));
    if (inner.width !== null) width = inner.width;
    if (inner.height !== null) height = inner.height;
    if (inner.hasAlpha !== null) hasAlpha = inner.hasAlpha;
  }

  // Every entry's size, for the note. The sizes in an icon are what people want
  // to know: one 16x16 is a favicon, a stack up to 256x256 is an application icon.
  let largestArea = 0;
  let largest = '';
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const entryWidth = byteAt(bytes, entry);
    const entryHeight = byteAt(bytes, entry + 1);
    if (entryWidth < 0 || entryHeight < 0) break;
    const pixelWidth = entryWidth === 0 ? 256 : entryWidth;
    const pixelHeight = entryHeight === 0 ? 256 : entryHeight;
    if (pixelWidth * pixelHeight > largestArea) {
      largestArea = pixelWidth * pixelHeight;
      largest = `${pixelWidth}x${pixelHeight}`;
    }
  }

  const parts = [count === 1 ? 'An icon holding one image.' : `An icon holding ${count} images at different sizes.`];
  if (count > 1) {
    parts.push(`The size shown is the first entry; the largest in the file is ${largest}.`);
  }
  if (embeddedPng) {
    parts.push(
      hasAlpha === true
        ? 'Its images are PNGs, so it has proper soft-edged transparency.'
        : 'Its images are stored as PNGs rather than the old bitmap-and-mask form.',
    );
  } else if (hasAlpha === null) {
    parts.push('Older icons carry a one-bit mask rather than an alpha channel, so whether it has transparency cannot be read from the header alone.');
  }
  return sniffResult('ico', { width, height, hasAlpha, animated: false, note: parts.join(' ') });
}

// -- SVG ----------------------------------------------------------------------

/**
 * How much of a file we will decode as text while looking for an `<svg>` root:
 * enough for any licence-comment preamble a drawing program emits, small enough
 * that rejecting a 50 MB upload costs nothing.
 */
const SVG_SCAN_BYTES = 65536;

/**
 * The head of the file as text. `TextDecoder` never throws in its default mode —
 * bytes that are not valid in the encoding become replacement characters — so
 * binary files simply fail the `<svg` test below rather than blowing up.
 */
function decodeTextPrefix(bytes: Uint8Array): string {
  let label = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  try {
    return new TextDecoder(label).decode(bytes.subarray(0, Math.min(bytes.length, SVG_SCAN_BYTES)));
  } catch {
    return '';
  }
}

function skipSpace(text: string, start: number): number {
  let offset = start;
  while (offset < text.length && /\s/.test(text.charAt(offset))) offset += 1;
  return offset;
}

/**
 * The end of a doctype, counting brackets: an internal subset (`<!DOCTYPE svg [
 * ... ]>`) is allowed to contain `>` characters, so the first one is not
 * necessarily the end of the declaration.
 */
function endOfDoctype(text: string, start: number): number {
  let depth = 0;
  for (let offset = start; offset < text.length; offset += 1) {
    const character = text.charAt(offset);
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === '>' && depth <= 0) return offset + 1;
  }
  return -1;
}

/**
 * SVG is the only format here with no magic number, so it is tested last and by
 * structure: an optional byte-order mark, then any mix of whitespace, an XML
 * declaration, comments and a doctype, and then the root element has to be
 * `<svg`. Insisting on the *root* element is what keeps an HTML page containing
 * an inline `<svg>` from being mistaken for an image.
 *
 * Returns null when this is not an SVG, so the caller can carry on.
 */
function sniffSvg(bytes: Uint8Array): Sniffed | null {
  const text = decodeTextPrefix(bytes);
  let offset = skipSpace(text, 0);
  // Bounded: each pass consumes a whole prologue item, and 64 of them is already
  // far more than any real file has.
  for (let pass = 0; pass < 64; pass += 1) {
    if (text.startsWith('<?', offset)) {
      const end = text.indexOf('?>', offset);
      if (end < 0) return null;
      offset = end + 2;
    } else if (text.startsWith('<!--', offset)) {
      const end = text.indexOf('-->', offset);
      if (end < 0) return null;
      offset = end + 3;
    } else if (text.slice(offset, offset + 9).toLowerCase() === '<!doctype') {
      const end = endOfDoctype(text, offset);
      if (end < 0) return null;
      offset = end;
    } else {
      break;
    }
    offset = skipSpace(text, offset);
  }

  const head = text.slice(offset, offset + 5).toLowerCase();
  if (!head.startsWith('<svg')) return null;
  // `<svgfoo` is a different element. A colon is allowed because a namespaced
  // root (`<svg:svg>`) is still an SVG.
  if (head.length > 4 && !/[\s/>:]/.test(head.charAt(4))) return null;

  const close = text.indexOf('>', offset);
  const rootTag = close < 0 ? text.slice(offset) : text.slice(offset, close + 1);
  const width = svgLength(attributeValue(rootTag, 'width'));
  const height = svgLength(attributeValue(rootTag, 'height'));
  const viewBox = attributeValue(rootTag, 'viewBox');
  const relative = width === null && attributeValue(rootTag, 'width') !== null;

  const parts = ['A vector image: it is drawing instructions, not pixels, so it stays sharp at any size.'];
  if (width !== null && height !== null) {
    parts.push('The file states a default size, but nothing is bound by it.');
  } else if (relative) {
    parts.push('Its size is given as a proportion of whatever it is placed in, so it has no fixed pixel size.');
  } else if (viewBox !== null) {
    parts.push('It has only a viewBox and no fixed width or height, so it scales to any size you draw it at.');
  } else {
    parts.push('It states no size at all, so anything displaying it will pick one.');
  }

  return sniffResult('svg', {
    width,
    height,
    // An SVG paints onto nothing: whatever it does not cover stays transparent.
    hasAlpha: true,
    // SVG can animate through SMIL elements or CSS anywhere in the document, and
    // the root tag cannot say whether it does. Better admitted than guessed.
    animated: null,
    note: parts.join(' '),
  });
}

/**
 * One attribute out of an opening tag. The leading whitespace requirement is what
 * keeps a search for `width` from matching `stroke-width`, and the alternatives
 * cover double quotes, single quotes and the unquoted form.
 *
 * The unquoted form stops at a slash as well as at whitespace and `>`, because
 * `<svg width=37 height=91/>` would otherwise hand back "91/" — a self-closing
 * tag's slash is punctuation, not part of the value. No attribute read here ever
 * legitimately contains one.
 */
function attributeValue(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>/]+))`, 'i');
  const found = pattern.exec(tag);
  if (!found) return null;
  return found[2] ?? found[3] ?? found[4] ?? null;
}

/**
 * An SVG length in pixels, but only when it is honestly one: a bare number or a
 * `px` value. Percentages, `em`, `pt` and the rest depend on context we do not
 * have, and reporting them as pixels would be a lie in a number's clothing.
 */
function svgLength(value: string | null): number | null {
  if (value === null) return null;
  const found = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(?:px)?\s*$/i.exec(value);
  return found ? dim(Math.round(Number(found[1]))) : null;
}

// -- the front door -----------------------------------------------------------

const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];

/**
 * `II` or `MM` is not enough on its own — plenty of files start with two capital
 * letters. The magic number is the byte order *and* the version word 42.
 */
function isTiffHeader(bytes: Uint8Array): boolean {
  if (byteAt(bytes, 0) === 0x49 && byteAt(bytes, 1) === 0x49) {
    const version = u16le(bytes, 2);
    return version === 42 || version === 43;
  }
  if (byteAt(bytes, 0) === 0x4d && byteAt(bytes, 1) === 0x4d) {
    const version = u16be(bytes, 2);
    return version === 42 || version === 43;
  }
  return false;
}

/** What to say about bytes that are not an image, when we can tell what they are. */
function unknownNote(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    return `Only ${bytes.length} byte${bytes.length === 1 ? '' : 's'} here, which is too little to identify anything. An upload cut short looks like this.`;
  }
  if (tagAt(bytes, 0, 4) === '%PDF') {
    return 'This is a PDF, not an image. The PDF tools will take it as it is, or it can be converted to images page by page.';
  }
  if (byteAt(bytes, 0) === 0x50 && byteAt(bytes, 1) === 0x4b) {
    return 'These bytes are a zip archive — a .docx or .xlsx, perhaps, since those are zips inside. There is no image here.';
  }
  if (byteAt(bytes, 0) === 0x1f && byteAt(bytes, 1) === 0x8b) {
    return 'This is gzip-compressed. If it is an .svgz, it has to be decompressed before anything can read it as an image.';
  }
  return 'These bytes match no image format this tool knows. If it ought to be an image, it may be damaged or only partly uploaded.';
}

/**
 * Identify an image from its bytes.
 *
 * The order is deliberate: long, specific signatures first, then the two-byte and
 * structural cases. `BM` is only two bytes and SVG has no signature at all, so
 * both are tried after everything that can be established beyond doubt.
 *
 * Never throws, whatever it is handed.
 */
export function sniffImage(bytes: Uint8Array): Sniffed {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
    return sniffResult('unknown', { note: 'There are no bytes here to look at — the file is empty.' });
  }
  if (matches(bytes, 0, PNG_SIGNATURE)) return sniffPng(bytes);
  if (matches(bytes, 0, JPEG_SIGNATURE)) return sniffJpeg(bytes);
  const gifVersion = tagAt(bytes, 3, 3);
  if (tagAt(bytes, 0, 3) === 'GIF' && (gifVersion === '87a' || gifVersion === '89a')) return sniffGif(bytes);
  if (tagAt(bytes, 0, 4) === 'RIFF' && tagAt(bytes, 8, 4) === 'WEBP') return sniffWebp(bytes);
  if (tagAt(bytes, 4, 4) === 'ftyp') return sniffIsoBmff(bytes);
  if (isTiffHeader(bytes)) return sniffTiff(bytes);
  if (matches(bytes, 0, ICO_SIGNATURE)) return sniffIco(bytes);
  if (byteAt(bytes, 0) === 0x42 && byteAt(bytes, 1) === 0x4d) return sniffBmp(bytes);
  const svg = sniffSvg(bytes);
  if (svg !== null) return svg;
  return sniffResult('unknown', { note: unknownNote(bytes) });
}

// -- the renamed-file warning -------------------------------------------------

/**
 * Does the name (or the type the browser claimed) disagree with the bytes?
 *
 * This exists to be reassuring. Renaming a PNG to .jpg is something people do all
 * the time, often because a website demanded a "jpg" upload, and none of our tools
 * mind: they read the bytes. So the message explains, tells them it will still
 * work, and never suggests they have done something wrong.
 *
 * Deliberately silent in three cases: when we could not identify the bytes (we are
 * in no position to accuse), when the extension is only a spelling variant of the
 * same format (`.jpg` and `.jpeg`, `.tif` and `.tiff`), and when the name is right
 * but the browser's MIME type is wrong — that last one is the operating system's
 * fault, not the user's, and nothing they can act on.
 */
export function isFormatMismatch(
  fileName: string,
  mime: string,
  sniffed: Sniffed,
): { mismatch: boolean; message: string | null } {
  const agreed = { mismatch: false, message: null };
  if (!sniffed || sniffed.format === 'unknown') return agreed;

  const actual = sniffed.format;
  const extension = extensionOf(fileName);
  const claimedByName = formatFromExtension(extension);
  const claimedByMime = formatFromMime(mime);

  if (claimedByName !== 'unknown' && claimedByName !== actual) {
    return {
      mismatch: true,
      message: `${shortName(fileName)} is ${withArticle(actual)}, despite the .${extension} name. Nothing is wrong with the file — we read the bytes rather than the name, so it will be treated as ${withArticle(actual)} and work normally.`,
    };
  }
  if (claimedByName === 'unknown' && claimedByMime !== 'unknown' && claimedByMime !== actual) {
    return {
      mismatch: true,
      message: `This file arrived labelled as ${withArticle(claimedByMime)}, but the bytes inside are ${withArticle(actual)}. We read the bytes, not the label, so it will be treated as ${withArticle(actual)} and work normally.`,
    };
  }
  return agreed;
}

/** Formats whose spoken name starts with a vowel sound. */
const AN_FORMATS = new Set<ImageFormat>(['avif', 'ico', 'svg']);

function withArticle(format: ImageFormat): string {
  return `${AN_FORMATS.has(format) ? 'an' : 'a'} ${FORMAT_LABEL[format]}`;
}

/** The name as it is safe and sensible to quote back in a sentence. */
function shortName(fileName: string): string {
  if (typeof fileName !== 'string' || fileName === '') return 'This file';
  const lastSeparator = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const segment = (lastSeparator >= 0 ? fileName.slice(lastSeparator + 1) : fileName).replace(
    /[\u0000-\u001f\u007f]/g,
    '',
  );
  const trimmed = Array.from(segment).slice(0, 60).join('');
  return trimmed === '' ? 'This file' : `"${trimmed}"`;
}

// -- naming the file we hand back ---------------------------------------------

/**
 * The name to save a converted file under: the original, minus its old extension,
 * plus `suffix`, plus the extension the new format deserves.
 *
 * The safety work — a name is never a path, control characters and the characters
 * Windows forbids go, leading dots go, MS-DOS device names are altered, the base
 * is capped by code point — is done by `src/lib/files/name.ts`, which is shared
 * with every other category and tested there. What is image-specific, and stays
 * here, is the fallback: bytes we could not identify keep the extension the file
 * arrived with, because renaming a perfectly good file to `.bin` is worse than
 * admitting we did not recognise it, and a picture whose name sanitises away to
 * nothing becomes `image` rather than `file`.
 *
 * Unicode letters are left alone throughout. Someone whose photo is called
 * "写真.png" or "vacaciones 🏖.png" should get their own name back, not a
 * transliteration and not "image".
 */
export function outputFileName(inputName: string, format: ImageFormat, opts?: { suffix?: string }): string {
  const { base, extension: previousExtension } = splitName(inputName);
  const safeBase = safeBaseName(base, { suffix: opts?.suffix, fallback: 'image' });
  const extension =
    format === 'unknown' && previousExtension !== '' ? previousExtension : extensionForFormat(format);
  return `${safeBase}.${extension}`;
}

// -- sizes and savings --------------------------------------------------------

/**
 * The before-and-after line printed under a converted or compressed image.
 *
 * `percent` is a whole number of percent of the *original* size, which is the
 * only reading of "43% smaller" that people expect. It is rounded, so a change
 * too small to round to 1% is reported as `same` rather than as `0% smaller` —
 * that would read like a bug.
 *
 * A larger result gets a sentence that explains rather than apologises. Growing
 * is usually correct: a photo already saved as a tight JPEG will get bigger as a
 * PNG, because PNG is lossless and has no way to throw detail away.
 */
export function savingsSummary(
  before: number,
  after: number,
): { deltaBytes: number; percent: number; direction: 'smaller' | 'larger' | 'same'; sentence: string } {
  const from = Number.isFinite(before) && before > 0 ? Math.round(before) : 0;
  const to = Number.isFinite(after) && after > 0 ? Math.round(after) : 0;
  const deltaBytes = from - to;
  // Without an original size there is no percentage to give, and inventing one
  // (100%? 0%?) would be worse than saying only what is known.
  if (from === 0) {
    return {
      deltaBytes,
      percent: 0,
      direction: 'same',
      sentence: to === 0 ? 'Nothing to compare yet.' : `${humanBytes(to)} — no original size to compare against.`,
    };
  }
  const percent = Math.round((Math.abs(deltaBytes) / from) * 100);
  if (deltaBytes === 0 || percent === 0) {
    return {
      deltaBytes,
      percent: 0,
      direction: 'same',
      sentence: 'Same size — there was nothing left to save.',
    };
  }
  if (deltaBytes > 0) {
    return {
      deltaBytes,
      percent,
      direction: 'smaller',
      sentence: `${percent}% smaller — saved ${humanBytes(deltaBytes)}`,
    };
  }
  return {
    deltaBytes,
    percent,
    direction: 'larger',
    sentence: `${percent}% larger — this image was already well compressed`,
  };
}

// -- what a browser can actually write ----------------------------------------

/**
 * The formats a browser can encode, and therefore the only ones a browser-side
 * "convert to…" list may offer.
 *
 * This is `canvas.toBlob`'s guarantee, not a wish list. The HTML specification
 * requires `image/png` and asks for `image/jpeg`; every current engine also
 * writes `image/webp`. Everything else — AVIF, HEIC, TIFF, ICO, animated GIF —
 * can be *read* by the browser but not written by it, which is exactly the
 * asymmetry that makes a converter promise more than it can do.
 *
 * SVG is missing for a different reason: it is not pixels. Turning a photo into
 * an SVG would mean tracing it, which is a different tool with different results,
 * not a re-encode.
 */
export const BROWSER_ENCODABLE: readonly ImageFormat[] = ['jpeg', 'png', 'webp'];

/** Whether a browser-side tool can write this format at all. */
export function canEncodeTo(format: ImageFormat): boolean {
  return BROWSER_ENCODABLE.includes(format);
}
