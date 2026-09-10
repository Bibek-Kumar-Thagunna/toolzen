/**
 * A small PDF 1.7 writer, built for one job: putting images on pages.
 *
 * Writing this rather than reaching for a PDF library is a deliberate trade. A
 * JPEG is already DCT-compressed, and a PDF can carry that exact bitstream as a
 * `/DCTDecode` stream — so image-to-PDF needs *no* image processing at all. The
 * bytes are copied through untouched, the result is lossless by construction and
 * barely bigger than the inputs, and the page that does it downloads no library.
 * A general PDF library would do the same thing after several hundred kilobytes
 * of code for features this route never uses.
 *
 * What it emits: header, indirect objects, a cross-reference table with real byte
 * offsets, a trailer with `/Size`, `/Root`, `/Info` and `/ID`, and `%%EOF`. The
 * offsets are the part that has to be exactly right, and the tests check them
 * with `qpdf --check` and by re-parsing the table.
 *
 * Compression is injected rather than imported so this file stays isomorphic:
 * the browser passes a `Deflate` backed by `CompressionStream`, the tests pass
 * one backed by `node:zlib`, and neither is baked in. JPEG pages need no
 * compression at all.
 */

import { jpegColourSpace, parseJpeg } from './jpeg.ts';
import type { PageSize, Placement } from './pages.ts';

/** Raw deflate-compress bytes to zlib format (RFC 1950), which is what `/FlateDecode` expects. */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface PdfImageSource {
  /** `jpeg` copies the bitstream in verbatim; `raw` compresses samples. */
  kind: 'jpeg' | 'raw';
  /** A whole JPEG file, or tightly packed 8-bit samples in row order. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Channels per pixel. Required for `raw`; read from the header for `jpeg`. */
  components?: 1 | 3 | 4;
  /** Raw RGBA only: the fourth channel becomes a soft mask. */
  hasAlpha?: boolean;
  /** Force the `/Decode` inversion a CMYK JPEG needs. Detected for `jpeg`. */
  decodeInverted?: boolean;
}

export interface PdfPageSpec {
  size: PageSize;
  image: PdfImageSource;
  placement: Placement;
}

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  /** Timestamp for `/CreationDate` and `/ModDate`. Defaults to now. */
  producedAt?: Date;
}

export type PdfResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * Limits, chosen so the tab survives rather than to be tidy.
 *
 * Every page's image is held in memory at once, so a runaway loop turns into a
 * dead tab rather than an error message. 500 pages is far more than the "scan a
 * contract" case needs, and 500 MB is around where browsers start refusing to
 * hand over a single Blob. The page-size cap is Acrobat's own long-standing
 * limit: 14400 points is 200 inches, and beyond it readers quietly disagree
 * about what they are looking at.
 */
const MAX_PAGES = 500;
const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const MAX_PAGE_POINTS = 14400;

type Part = string | Uint8Array;

/**
 * PDF syntax is bytes, not text. Every string this file builds is plain ASCII —
 * anything else is hex-escaped first — so a byte-per-character encode is exact
 * and needs no `TextEncoder`.
 */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function partLength(part: Part): number {
  return part.length;
}

function joinParts(parts: readonly Part[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    const chunk = typeof part === 'string' ? latin1(part) : part;
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * A number as PDF writes them: no exponent, no more precision than a printer
 * could use.
 *
 * `String(1e-7)` is `"1e-7"`, which is not valid PDF syntax and makes a reader
 * reject the page. Four decimal places of a point is a ten-thousandth of an
 * inch, well under any imaging device's resolution.
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10000) / 10000;
  if (Number.isInteger(rounded)) return String(rounded === 0 ? 0 : rounded);
  return rounded.toFixed(4).replace(/0+$/, '');
}

function isPlainAscii(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

/**
 * A PDF text string.
 *
 * Printable ASCII goes in a literal string with `\`, `(` and `)` escaped —
 * unbalanced brackets in a title would otherwise end the string early and
 * corrupt the rest of the file. Anything else becomes UTF-16BE in a hex string
 * with a byte-order mark, which is how PDF carries non-Latin text and how a
 * reader knows to expect it. Hex avoids escaping entirely, so a title in Greek
 * or Japanese cannot break the syntax.
 */
function pdfString(value: string): string {
  if (isPlainAscii(value)) {
    let out = '';
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      out += ch === '\\' || ch === '(' || ch === ')' ? `\\${ch}` : ch;
    }
    return `(${out})`;
  }
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i += 1) {
    hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/**
 * A PDF date: `D:YYYYMMDDHHmmSS+00'00'`.
 *
 * Always written in UTC with an explicit `+00'00'` offset rather than the local
 * clock. A PDF date with no offset is ambiguous, and the local offset would leak
 * roughly where the person making the file is — which is not information a
 * "convert my images" tool should be putting in a document they might send on.
 */
function pdfDate(when: Date): string {
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return (
    `D:${pad(when.getUTCFullYear(), 4)}${pad(when.getUTCMonth() + 1, 2)}${pad(when.getUTCDate(), 2)}` +
    `${pad(when.getUTCHours(), 2)}${pad(when.getUTCMinutes(), 2)}${pad(when.getUTCSeconds(), 2)}+00'00'`
  );
}

/**
 * The 16 bytes of `/ID`, derived from the finished body.
 *
 * PDF only asks that two unrelated documents be unlikely to share an ID; readers
 * use it to recognise revisions of the same file. Deriving it from the content
 * rather than from a random source makes the whole output reproducible — the same
 * images and metadata always produce a byte-identical PDF — which is what makes
 * "did this tool change my file?" answerable. Four FNV-1a hashes with different
 * starting values give the 16 bytes; a strided sample keeps it fast on a large
 * document, since this is an identifier and not a checksum.
 */
function documentId(body: Uint8Array, seed: string): string {
  const state = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const feed = (byte: number): void => {
    for (let k = 0; k < 4; k += 1) state[k] = Math.imul(state[k] ^ byte, 16777619);
  };
  for (let i = 0; i < 4; i += 1) feed((body.length >>> (i * 8)) & 0xff);
  const stride = Math.max(1, Math.floor(body.length / 65536));
  for (let i = 0; i < body.length; i += stride) feed(body[i]);
  for (let i = 0; i < seed.length; i += 1) feed(seed.charCodeAt(i) & 0xff);
  return state.map((value) => (value >>> 0).toString(16).padStart(8, '0').toUpperCase()).join('');
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isCountable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

interface PreparedImage {
  width: number;
  height: number;
  colourSpace: string;
  filter: string;
  data: Uint8Array;
  decodeInverted: boolean;
  /** Already-compressed grayscale soft mask, or null when the image is opaque. */
  alpha: Uint8Array | null;
}

type PreparedResult = { ok: true; image: PreparedImage } | { ok: false; error: string };

function colourSpaceFor(components: 1 | 3 | 4): string {
  return components === 1 ? '/DeviceGray' : components === 3 ? '/DeviceRGB' : '/DeviceCMYK';
}

const DEFLATE_FAILED =
  'The images could not be compressed, so the PDF was not made. Reloading the page and trying again usually clears this.';

async function compress(bytes: Uint8Array, deflate: Deflate): Promise<Uint8Array | null> {
  try {
    const out = await deflate(bytes);
    return out.length > 0 || bytes.length === 0 ? out : null;
  } catch {
    return null;
  }
}

/** Turn one source image into the stream and dictionary entries a page needs. */
async function prepareImage(image: PdfImageSource, deflate: Deflate): Promise<PreparedResult> {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || !isCountable(image.width) || !isCountable(image.height)) {
    return fail(
      'One of the images has no width or height, so there is nothing to put on the page. It is probably an empty or damaged file.',
    );
  }
  if (image.bytes.length === 0) {
    return fail('One of the images is an empty file — there are no pixels in it to place on a page.');
  }

  if (image.kind === 'jpeg') {
    return prepareJpeg(image);
  }
  return prepareRaw(image, deflate);
}

/**
 * JPEG: the bitstream goes in exactly as it arrived.
 *
 * The header is re-read here even though the caller has usually already parsed
 * it, because a mismatch between the declared size and the real size is not a
 * cosmetic problem — the reader would stretch the picture to whatever the
 * dictionary claims. The most common cause is a phone photo whose Exif rotation
 * flag makes a browser report the two dimensions the other way round, so the
 * message says so.
 */
function prepareJpeg(image: PdfImageSource): PreparedResult {
  const parsed = parseJpeg(image.bytes);
  let components = image.components;
  let decodeInverted = image.decodeInverted;

  if (parsed.ok) {
    if (parsed.info.width !== image.width || parsed.info.height !== image.height) {
      return fail(
        `This JPEG is ${parsed.info.width} × ${parsed.info.height} pixels but was described as ${image.width} × ${image.height}, so it would come out stretched. If it is a phone photo, it carries a rotation flag that has to be applied to the pixels before it can go in a PDF.`,
      );
    }
    if (components === undefined) components = parsed.info.components;
    if (decodeInverted === undefined) decodeInverted = jpegColourSpace(parsed.info).needsInvertedDecode;
  } else if (components === undefined) {
    return fail(parsed.error);
  }

  return {
    ok: true,
    image: {
      width: image.width,
      height: image.height,
      colourSpace: colourSpaceFor(components ?? 3),
      filter: '/DCTDecode',
      data: image.bytes,
      decodeInverted: decodeInverted === true,
      alpha: null,
    },
  };
}

/**
 * Raw samples: deflated, and split in two when there is transparency.
 *
 * PDF has no transparent colour channel on an image. Transparency is a separate
 * grayscale image in `/SMask`, where 0 is invisible and 255 is solid, so RGBA
 * becomes an RGB image plus a one-channel mask — which is also why the mask is
 * built by de-interleaving rather than by re-encoding anything.
 */
async function prepareRaw(image: PdfImageSource, deflate: Deflate): Promise<PreparedResult> {
  const components = image.components;
  if (components === undefined) {
    return fail('These pixels arrived without saying how many colour channels they have, so they cannot be placed.');
  }
  const pixels = image.width * image.height;
  const expected = pixels * components;
  if (image.bytes.length !== expected) {
    return fail(
      `These pixels do not add up: ${image.width} × ${image.height} at ${components} channel${components === 1 ? '' : 's'} each needs ${expected} bytes, but ${image.bytes.length} were supplied.`,
    );
  }
  if (image.hasAlpha && components !== 4) {
    return fail(
      'This image is marked as having transparency, but transparency needs four channels per pixel (red, green, blue and how see-through it is) and it only has ' +
        `${components}.`,
    );
  }

  if (image.hasAlpha) {
    const rgb = new Uint8Array(pixels * 3);
    const mask = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i += 1) {
      rgb[i * 3] = image.bytes[i * 4];
      rgb[i * 3 + 1] = image.bytes[i * 4 + 1];
      rgb[i * 3 + 2] = image.bytes[i * 4 + 2];
      mask[i] = image.bytes[i * 4 + 3];
    }
    const colour = await compress(rgb, deflate);
    const alpha = colour === null ? null : await compress(mask, deflate);
    if (colour === null || alpha === null) return fail(DEFLATE_FAILED);
    return {
      ok: true,
      image: {
        width: image.width,
        height: image.height,
        colourSpace: '/DeviceRGB',
        filter: '/FlateDecode',
        data: colour,
        decodeInverted: false,
        alpha,
      },
    };
  }

  const data = await compress(image.bytes, deflate);
  if (data === null) return fail(DEFLATE_FAILED);
  return {
    ok: true,
    image: {
      width: image.width,
      height: image.height,
      colourSpace: colourSpaceFor(components),
      filter: '/FlateDecode',
      data,
      decodeInverted: image.decodeInverted === true,
      alpha: null,
    },
  };
}

/**
 * An upper bound on the finished file, without compressing anything.
 *
 * Raw pixels are counted uncompressed, because how well deflate does depends
 * entirely on the picture — a screenshot shrinks tenfold, a photograph barely at
 * all. Over-estimating is the right direction for a guard: it refuses a job that
 * would have just fit rather than running out of memory halfway through one that
 * never would.
 */
export function estimatePdfBytes(pages: PdfPageSpec[]): number {
  const counted = new Set<Uint8Array>();
  let total = 2048; // header, catalogue, page tree, info dictionary, xref, trailer
  for (const page of pages) {
    total += 512; // page object, content stream, two xref rows
    if (counted.has(page.image.bytes)) continue;
    counted.add(page.image.bytes);
    total += 320 + page.image.bytes.length;
  }
  return total;
}

const NO_COMPRESSION_STREAM =
  'This browser cannot compress data, which this needs. Chrome, Edge, Firefox and Safari have all supported it since 2023 — updating the browser will fix it.';

/**
 * A `Deflate` backed by the platform's own compressor.
 *
 * `CompressionStream('deflate')` produces zlib-wrapped output (RFC 1950), which
 * is what `/FlateDecode` reads; `'deflate-raw'` would produce a headerless stream
 * that PDF readers reject. Node 22 has the same global, so this is not a
 * browser-only path and nothing here touches `window`.
 */
export function browserDeflate(): Deflate {
  if (typeof CompressionStream === 'undefined') throw new Error(NO_COMPRESSION_STREAM);
  return async (bytes: Uint8Array): Promise<Uint8Array> => {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    // Write and read concurrently. Awaiting the write first deadlocks on
    // anything larger than the stream's buffer, because nothing is draining it.
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
    return joinParts(chunks, total);
  };
}

/**
 * The four high bytes on the second line mark the file as containing binary
 * data, so tools that move files around do not "helpfully" translate line
 * endings and corrupt every stream in the document.
 */
const BINARY_COMMENT = new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/**
 * `/Decode` arrays that complement every channel, one per colour space.
 *
 * The array has to have two numbers per channel. Emitting the four-channel
 * version for an RGB image is invalid PDF, so it is looked up by colour space
 * rather than assumed to be CMYK.
 */
const DECODE_INVERTED: Readonly<Record<string, string>> = {
  '/DeviceGray': '[1 0]',
  '/DeviceRGB': '[1 0 1 0 1 0]',
  '/DeviceCMYK': '[1 0 1 0 1 0 1 0]',
};

/**
 * A stream object. `/Length` is written directly as a number rather than as a
 * reference to another object — the indirect form exists for writers that stream
 * output before knowing the size, and we always know the size. One less object,
 * one less thing to get wrong.
 */
function streamObject(dict: string, data: Uint8Array): Part[] {
  const head = dict === '' ? `<< /Length ${data.length} >>` : `<< ${dict} /Length ${data.length} >>`;
  return [`${head}\nstream\n`, data, '\nendstream'];
}

/**
 * Everything about an image that changes the XObject it produces.
 *
 * Two pages holding the same `bytes` share one XObject, but only if they also
 * agree on how to interpret them — the same JPEG described once as CMYK and once
 * as inverted CMYK is two different images and has to stay two objects.
 */
function imageSignature(image: PdfImageSource): string {
  return [
    image.kind,
    image.width,
    image.height,
    image.components ?? '-',
    image.hasAlpha === true,
    image.decodeInverted ?? '-',
  ].join('|');
}

/**
 * Build the PDF.
 *
 * The shape of the work: reserve an object number for everything, fill in the
 * bodies, then serialise once while recording where each object started. Those
 * recorded positions *are* the cross-reference table, and a reader that finds a
 * wrong one gives up on the file — which is why they are measured rather than
 * predicted.
 */
export async function writePdf(
  pages: PdfPageSpec[],
  opts: { deflate: Deflate; meta?: PdfMeta },
): Promise<PdfResult> {
  if (pages.length === 0) {
    return fail('There are no images to turn into a PDF yet. Add at least one and try again.');
  }
  if (pages.length > MAX_PAGES) {
    return fail(
      `That is ${pages.length} pages, and this can build ${MAX_PAGES} at a time. Split the images into smaller batches and join the PDFs afterwards.`,
    );
  }
  const projected = estimatePdfBytes(pages);
  if (projected > MAX_OUTPUT_BYTES) {
    return fail(
      `These images would make a PDF of roughly ${Math.round(projected / (1024 * 1024))} MB, which is more than the ${Math.round(MAX_OUTPUT_BYTES / (1024 * 1024))} MB this can build in one go. Try fewer images at a time.`,
    );
  }
  for (let index = 0; index < pages.length; index += 1) {
    const { size, placement } = pages[index];
    if (!isCountable(size.width) || !isCountable(size.height)) {
      return fail(`Page ${index + 1} has no size, so nothing could be drawn on it.`);
    }
    if (size.width > MAX_PAGE_POINTS || size.height > MAX_PAGE_POINTS) {
      return fail(
        `Page ${index + 1} would be ${Math.round(size.width / 72)} × ${Math.round(size.height / 72)} inches, and PDF readers stop at 200 inches. Choose a page size such as A4 instead of matching the image exactly.`,
      );
    }
    if (!isCountable(placement.width) || !isCountable(placement.height)) {
      return fail(`The image on page ${index + 1} has been given no room on the page, so it would be invisible.`);
    }
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) {
      return fail(`The image on page ${index + 1} has no position on the page.`);
    }
  }

  const objects: (Part[] | null)[] = [];
  const reserve = (): number => {
    objects.push(null);
    return objects.length;
  };
  const put = (id: number, body: Part[]): void => {
    objects[id - 1] = body;
  };

  // The catalogue and the page tree are numbered first so that object 1 is the
  // document root, which is what anyone opening the file in a text editor expects.
  const catalogId = reserve();
  const pagesId = reserve();

  const emitImage = (prepared: PreparedImage): number => {
    const maskId = prepared.alpha ? reserve() : 0;
    const imageId = reserve();
    const size = `/Width ${prepared.width} /Height ${prepared.height}`;
    if (prepared.alpha) {
      put(
        maskId,
        streamObject(
          `/Type /XObject /Subtype /Image ${size} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          prepared.alpha,
        ),
      );
    }
    let dict = `/Type /XObject /Subtype /Image ${size} /ColorSpace ${prepared.colourSpace} /BitsPerComponent 8 /Filter ${prepared.filter}`;
    const decode = DECODE_INVERTED[prepared.colourSpace];
    if (prepared.decodeInverted && decode) dict += ` /Decode ${decode}`;
    if (prepared.alpha) dict += ` /SMask ${maskId} 0 R`;
    put(imageId, streamObject(dict, prepared.data));
    return imageId;
  };

  const cache = new Map<Uint8Array, { signature: string; id: number }[]>();
  const kids: string[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const { size, image, placement } = pages[index];
    const signature = imageSignature(image);
    const seen = cache.get(image.bytes) ?? [];
    const known = seen.find((entry) => entry.signature === signature);
    let imageId = known ? known.id : 0;
    if (!known) {
      const prepared = await prepareImage(image, opts.deflate);
      if (!prepared.ok) return fail(`Page ${index + 1}: ${prepared.error}`);
      imageId = emitImage(prepared.image);
      seen.push({ signature, id: imageId });
      cache.set(image.bytes, seen);
    }

    // `re W n` clips to the sheet, so an image scaled to cover the page cannot
    // paint into the bleed area. `cm` is the placement: a 6-number matrix
    // `[a b c d e f]` where a and d scale and e and f translate. A PDF image
    // XObject is drawn into the unit square, so the width and height of the
    // picture *are* the scale factors, and x and y are the bottom-left corner —
    // bottom-left, not top-left, which is the bug this comment exists to prevent.
    const content =
      `q\n0 0 ${num(size.width)} ${num(size.height)} re W n\n` +
      `${num(placement.width)} 0 0 ${num(placement.height)} ${num(placement.x)} ${num(placement.y)} cm\n` +
      '/Im0 Do\nQ\n';

    const contentId = reserve();
    put(contentId, streamObject('', latin1(content)));
    const pageId = reserve();
    put(pageId, [
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(size.width)} ${num(size.height)}]` +
        ` /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    ]);
    kids.push(`${pageId} 0 R`);
  }

  put(catalogId, [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`]);
  put(pagesId, [`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`]);

  // The information dictionary. Only what the caller supplied goes in: a tool
  // that quietly stamps a name into every file people make is adding a tracker,
  // not a feature. `/Producer` names the code rather than the product on purpose
  // — the brand lives in one file and this is not it.
  const meta = opts.meta ?? {};
  const when = meta.producedAt instanceof Date && !Number.isNaN(meta.producedAt.getTime()) ? meta.producedAt : new Date();
  const info: string[] = [];
  if (meta.title !== undefined && meta.title !== '') info.push(`/Title ${pdfString(meta.title)}`);
  if (meta.author !== undefined && meta.author !== '') info.push(`/Author ${pdfString(meta.author)}`);
  if (meta.subject !== undefined && meta.subject !== '') info.push(`/Subject ${pdfString(meta.subject)}`);
  if (meta.keywords !== undefined && meta.keywords !== '') info.push(`/Keywords ${pdfString(meta.keywords)}`);
  if (meta.creator !== undefined && meta.creator !== '') info.push(`/Creator ${pdfString(meta.creator)}`);
  info.push('/Producer (image-to-pdf writer)');
  info.push(`/CreationDate ${pdfString(pdfDate(when))}`);
  info.push(`/ModDate ${pdfString(pdfDate(when))}`);
  const infoId = reserve();
  put(infoId, [`<< ${info.join(' ')} >>`]);

  const parts: Part[] = [];
  let offset = 0;
  const emit = (part: Part): void => {
    parts.push(part);
    offset += partLength(part);
  };

  emit('%PDF-1.7\n');
  emit(BINARY_COMMENT);

  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    const body = objects[i];
    if (!body) {
      return fail('Something went wrong while building the PDF and it was not finished. Please try again.');
    }
    offsets.push(offset);
    emit(`${i + 1} 0 obj\n`);
    for (const part of body) emit(part);
    emit('\nendobj\n');
  }

  const body = joinParts(parts, offset);
  const startxref = offset;
  const id = documentId(body, `${pages.length}|${pdfDate(when)}|${meta.title ?? ''}`);

  // The cross-reference table. Every row is exactly 20 bytes — ten digits of
  // offset, a space, five digits of generation number, a space, the in-use flag
  // and a two-byte line ending — because readers are allowed to seek straight to
  // `startxref + 20 * n` instead of parsing. Object 0 is always the head of the
  // free list, at generation 65535.
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`;
  for (const at of offsets) tail += `${String(at).padStart(10, '0')} 00000 n\r\n`;
  tail +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R` +
    ` /ID [<${id}> <${id}>] >>\nstartxref\n${startxref}\n%%EOF\n`;

  const tailBytes = latin1(tail);
  const out = new Uint8Array(body.length + tailBytes.length);
  out.set(body, 0);
  out.set(tailBytes, body.length);
  return { ok: true, bytes: out };
}
