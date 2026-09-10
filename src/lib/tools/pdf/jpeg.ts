/**
 * A JPEG marker-segment reader — just enough of the format to embed a JPEG in a
 * PDF without touching a single pixel.
 *
 * Why this exists: a PDF can carry a JPEG bitstream *verbatim* as a
 * `/DCTDecode` stream. No decode, no re-encode, no quality loss, and the output
 * file is barely larger than the input. To write that stream we only need four
 * facts — width, height, how many colour channels, and whether the channels are
 * stored inverted — and all four live in the header segments. So we read the
 * header and copy the rest.
 *
 * Isomorphic: plain `Uint8Array` in, plain object out. No DOM, no Node, no
 * decoding, so it is the same code on a server and in a worker.
 */

export interface JpegInfo {
  /** Pixels, from the SOF segment. Ignores any Exif rotation. */
  width: number;
  height: number;
  /** 1 = grayscale, 3 = YCbCr (shown as RGB), 4 = CMYK or YCCK. */
  components: 1 | 3 | 4;
  /** Sample precision. Always 8 for a JPEG any PDF reader will open. */
  bitsPerComponent: number;
  /** Progressive scan. Embeds fine; worth reporting because some readers are slow with it. */
  progressive: boolean;
  /** The transform byte of an APP14 `Adobe` segment, or null when there is none. */
  adobeTransform: number | null;
  /** The Exif orientation tag value 1-8, or null when the file has no Exif. */
  hasExifOrientation: number | null;
  /** How many APP2 `ICC_PROFILE` chunks the file carries. */
  iccChunks: number;
}

export type JpegResult = { ok: true; info: JpegInfo } | { ok: false; error: string };

export interface JpegColourSpace {
  pdfName: '/DeviceGray' | '/DeviceRGB' | '/DeviceCMYK';
  needsInvertedDecode: boolean;
}

const NOT_JPEG =
  'That does not look like a JPEG. JPEG files start with a specific pair of bytes and this one does not, so it is probably a PNG, a HEIC photo or something else renamed to .jpg.';

const TRUNCATED =
  'This JPEG stops in the middle of its own header, so it is incomplete. Try downloading or exporting it again.';

const CORRUPT =
  'This JPEG’s internal structure is damaged, so its size and colours cannot be read. Try re-saving it from the app that made it.';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Frame headers, split by what a PDF reader can actually do with them.
 *
 * `/DCTDecode` is libjpeg-shaped: baseline (C0), extended sequential (C1) and
 * progressive (C2) all decode everywhere. The rest are real JPEG variants that
 * almost nothing supports — arithmetic coding was patent-encumbered for years,
 * and lossless JPEG is a different algorithm that shares only the file wrapper.
 * C4 is the Huffman table marker, C8 is reserved and CC is the arithmetic
 * conditioning table; none of the three is a frame header, which is the mistake
 * that makes naive parsers read garbage dimensions.
 */
const SOF_SUPPORTED = new Set([0xc0, 0xc1, 0xc2]);
const SOF_ARITHMETIC = new Set([0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const SOF_LOSSLESS = new Set([0xc3, 0xc7, 0xcb, 0xcf]);
const SOF_ANY = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** `Adobe`, the APP14 signature. */
const ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65];
/** `Exif\0\0`, the APP1 signature. */
const EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
/** `ICC_PROFILE\0`, the APP2 signature. */
const ICC = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * The Exif orientation tag, dug out of an APP1 segment.
 *
 * This matters more than it looks. A browser drawing the photo applies the
 * rotation; embedding the bitstream in a PDF does not, because `/DCTDecode`
 * knows nothing about Exif. So a phone photo that looks upright on screen can
 * land sideways in the PDF unless the caller either rotates the pixels or sets
 * the page up to match. Reporting the tag is how the caller finds out.
 *
 * The payload is a whole TIFF header: byte order, magic 42, offset to the first
 * directory, then 12-byte entries. Every read is bounds-checked, because Exif
 * blocks written by dead camera firmware are a well-known source of nonsense
 * offsets.
 */
function readExifOrientation(payload: Uint8Array): number | null {
  if (!startsWith(payload, EXIF)) return null;
  const tiff = payload.subarray(EXIF.length);
  if (tiff.length < 12) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;

  const u16 = (at: number): number =>
    little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1];
  // Multiply rather than shift for the top byte: `x << 24` goes negative.
  const u32 = (at: number): number =>
    little
      ? tiff[at] + tiff[at + 1] * 0x100 + tiff[at + 2] * 0x10000 + tiff[at + 3] * 0x1000000
      : tiff[at] * 0x1000000 + tiff[at + 1] * 0x10000 + tiff[at + 2] * 0x100 + tiff[at + 3];

  if (u16(2) !== 0x2a) return null;
  const directory = u32(4);
  if (directory < 8 || directory + 2 > tiff.length) return null;
  const entries = u16(directory);
  for (let i = 0; i < entries; i += 1) {
    const at = directory + 2 + i * 12;
    if (at + 12 > tiff.length) return null;
    if (u16(at) !== 0x0112) continue;
    const type = u16(at + 2);
    const value = type === 4 ? u32(at + 8) : u16(at + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/**
 * Read a JPEG's header segments.
 *
 * The walk is the whole job: from just after the start-of-image marker, every
 * segment is `FF <marker>` followed by a big-endian length that *includes its
 * own two bytes*. A run of `FF` bytes before a marker is legal padding and gets
 * skipped. Restart markers and `TEM` carry no length at all. At the
 * start-of-scan marker the entropy-coded pixel data begins, and since we never
 * decode a pixel, that is where we stop.
 */
export function parseJpeg(bytes: Uint8Array): JpegResult {
  if (bytes.length < 4) return fail(bytes.length === 0 ? NOT_JPEG : TRUNCATED);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail(NOT_JPEG);

  let frame: { precision: number; height: number; width: number; components: number } | null = null;
  let progressive = false;
  let adobeTransform: number | null = null;
  let orientation: number | null = null;
  let iccChunks = 0;
  let at = 2;

  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return fail(CORRUPT);
    const marker = bytes[at + 1];

    if (marker === 0xff) {
      at += 1; // fill byte; the real marker is one further on
      continue;
    }
    if (marker === 0x00) return fail(CORRUPT); // a stuffed byte cannot appear here
    if (marker === 0xd9) break; // end of image, before any scan
    if (marker === 0xda) break; // start of scan: pixel data from here
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // markers that carry no payload
      continue;
    }

    if (at + 4 > bytes.length) return fail(TRUNCATED);
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return fail(CORRUPT);
    const end = at + 2 + length;
    if (end > bytes.length) return fail(TRUNCATED);
    const payload = bytes.subarray(at + 4, end);

    if (SOF_ANY.has(marker)) {
      if (SOF_ARITHMETIC.has(marker)) {
        return fail(
          'This JPEG uses arithmetic coding, an old option that most PDF readers cannot open. Re-save it as a normal JPEG and it will work.',
        );
      }
      if (SOF_LOSSLESS.has(marker)) {
        return fail(
          'This is a lossless JPEG, which is a different format sharing the same file extension. PDF readers cannot show it. Re-save it as a normal JPEG or a PNG.',
        );
      }
      if (!SOF_SUPPORTED.has(marker)) {
        return fail(
          'This JPEG is stored in an unusual multi-stage form that PDF readers cannot show. Re-save it as a normal JPEG and it will work.',
        );
      }
      if (payload.length < 6) return fail(CORRUPT);
      const components = payload[5];
      if (payload.length < 6 + components * 3) return fail(CORRUPT);
      // Height comes before width. Swapping them is the most common bug in a
      // hand-written JPEG reader and produces a plausible-looking wrong answer.
      frame = {
        precision: payload[0],
        height: (payload[1] << 8) | payload[2],
        width: (payload[3] << 8) | payload[4],
        components,
      };
      progressive = marker === 0xc2;
    } else if (marker === 0xee && payload.length >= 12 && startsWith(payload, ADOBE)) {
      // 'Adobe' + 2-byte version + two 2-byte flag words + the transform byte.
      adobeTransform = payload[11];
    } else if (marker === 0xe1 && orientation === null) {
      orientation = readExifOrientation(payload);
    } else if (marker === 0xe2 && startsWith(payload, ICC)) {
      iccChunks += 1;
    }

    at = end;
  }

  if (!frame) {
    return fail(
      bytes.length < 128
        ? TRUNCATED
        : 'This JPEG never says how large the image is, so it cannot be placed on a page. The file is damaged.',
    );
  }
  if (frame.width < 1 || frame.height < 1) {
    return fail('This JPEG claims to have no width or height, so there is nothing to place on a page.');
  }
  if (frame.precision !== 8) {
    return fail(
      `This JPEG stores ${frame.precision} bits of detail per colour, not the usual 8. PDF readers disagree about how to show those, so the result would look wrong on someone else’s screen. Re-save it as a standard 8-bit JPEG.`,
    );
  }
  if (frame.components !== 1 && frame.components !== 3 && frame.components !== 4) {
    return fail(
      `This JPEG has ${frame.components} colour channels, which is not one of the three combinations PDF understands (grey, colour, or print CMYK). Re-save it as a normal colour JPEG.`,
    );
  }

  return {
    ok: true,
    info: {
      width: frame.width,
      height: frame.height,
      components: frame.components,
      bitsPerComponent: frame.precision,
      progressive,
      adobeTransform,
      hasExifOrientation: orientation,
      iccChunks,
    },
  };
}

/**
 * Which PDF colour space the embedded bitstream is in, and whether its samples
 * are stored upside down.
 *
 * The inversion is the part that catches people out. Adobe applications write
 * CMYK JPEGs with every sample complemented — 0 means full ink, not none — and
 * they mark the file with an APP14 `Adobe` segment. libjpeg keeps that
 * convention on the way out, so a PDF that embeds such a stream as plain
 * `/DeviceCMYK` renders as a photographic negative: white skies go black. The
 * fix is one array in the image dictionary, `/Decode [1 0 1 0 1 0 1 0]`, which
 * tells the reader to complement each channel back. Presence of the APP14
 * segment is the signal, whatever its transform byte says — transform 2 means
 * the data is YCCK rather than CMYK, which `/DCTDecode` already unpicks on its
 * own, and it is still stored inverted.
 *
 * Grey and three-channel files need nothing: `/DCTDecode` hands back grey
 * samples for one component and does the YCbCr-to-RGB conversion for three.
 */
export function jpegColourSpace(info: JpegInfo): JpegColourSpace {
  if (info.components === 1) return { pdfName: '/DeviceGray', needsInvertedDecode: false };
  if (info.components === 3) return { pdfName: '/DeviceRGB', needsInvertedDecode: false };
  return { pdfName: '/DeviceCMYK', needsInvertedDecode: info.adobeTransform !== null };
}
