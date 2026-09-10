/**
 * ============================================================================
 * IMAGE CODEC — the one engine that cannot run outside a browser
 * ============================================================================
 * Decode a file into pixels, scale or crop those pixels, encode them back out.
 * Six tools sit on top of this (compressor, resizer, cropper and the three
 * format converters), plus the image half of image-to-pdf.
 *
 * ── Why this file has no test, and why that is contained ────────────────────
 * Every other engine in `src/lib/tools` is a pure function with a `.test.ts`
 * beside it that runs under `node --test`. This one needs `createImageBitmap`,
 * a canvas and a real encoder, none of which exist in Node without pulling in
 * a native module. Rather than accept an untested blind spot, the *decisions*
 * were moved out: which formats a browser can write (`format.ts`), what a
 * target size should be and when it must be clamped (`dimensions.ts`), and
 * where a crop rectangle lands (`crop.ts`) are all pure, all tested, and all
 * imported here. What is left in this file is glue — allocate, draw, hand back
 * a Blob — which is the part a unit test could only mock anyway.
 *
 * ── The honesty problem this file exists to solve ──────────────────────────
 * `canvas.toBlob(cb, 'image/webp')` does not fail on a browser without a WebP
 * encoder. It silently hands back a PNG. A "PNG to WebP" tool built on the
 * naive call would therefore offer a file named `photo.webp` that is a PNG
 * inside — a fake conversion, and exactly the kind of claim §35 forbids. So
 * every encode here checks `blob.type` against what was asked for and fails
 * loudly instead, and {@link canEncodeFormat} lets a UI hide an option it
 * cannot honour before the user picks it.
 *
 * ── Failures carry a code, not just a sentence ─────────────────────────────
 * The house convention is `{ ok: false, error: string }` with a sentence for
 * the user. This module adds `reason`, drawn from the analytics vocabulary, so
 * a tool can fire `processing_failed` with a stable code without matching on
 * prose. The import is type-only: no analytics code is reachable from here.
 * ============================================================================
 */
import type { FailureReason } from '../../analytics.ts';
import { CANVAS_LIMITS, clampToMaxPixels, normaliseSize, resizeSteps } from './dimensions.ts';
import type { Size } from './dimensions.ts';
import { canEncodeTo, mimeForFormat } from './format.ts';
import type { ImageFormat } from './format.ts';

/** The three formats a browser is ever able to write. Mirrors `BROWSER_ENCODABLE`. */
export type EncodableFormat = 'jpeg' | 'png' | 'webp';

export interface CodecFailure {
  ok: false;
  /** Stable code for analytics and for branching. */
  reason: FailureReason;
  /** A sentence written for the person holding the file. */
  error: string;
}

function fail(reason: FailureReason, error: string): CodecFailure {
  return { ok: false, reason, error };
}

const CANCELLED = 'Cancelled.';
const NO_BROWSER =
  'This tool needs to run in a browser tab. Reload the page and try again — nothing was sent anywhere.';

function aborted(signal?: AbortSignal): boolean {
  return signal !== undefined && signal.aborted;
}

/**
 * A decoded picture, plus the one thing callers must not forget.
 *
 * `close()` matters more than it looks. An `ImageBitmap` holds pixels outside
 * the JavaScript heap — a 12-megapixel photo is ~48MB of it — and the garbage
 * collector will not reclaim that promptly, so a user converting a folder of
 * photos one after another can exhaust memory while the heap looks healthy. The
 * element fallback has the same problem in a different shape: its object URL
 * pins the whole file until revoked. One method covers both, and it is
 * idempotent so a `finally` block can call it without checking.
 */
export interface DecodedImage {
  /** Anything a canvas can draw. Both branches satisfy `CanvasImageSource`. */
  readonly source: ImageBitmap | HTMLImageElement;
  readonly width: number;
  readonly height: number;
  close(): void;
}

export type DecodeResult = { ok: true; image: DecodedImage } | CodecFailure;

export type EncodeResult =
  | { ok: true; blob: Blob; format: EncodableFormat; size: Size; clamped: boolean }
  | CodecFailure;

/** A source rectangle, in source pixels. Matches `crop.ts`'s `Rect`. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* ───────────────────────────── decode ───────────────────────────────────── */

/**
 * Turn a file into drawable pixels.
 *
 * Two paths, tried in order. `createImageBitmap` is the right one: it decodes
 * off the main thread, so a 20MP photo does not freeze the page mid-scroll.
 * When it throws — an old engine, or a format it declines even though the
 * `<img>` tag would take it — the fallback is an `HTMLImageElement`, which is
 * slower and blocks, but decodes anything the browser can display at all,
 * including SVG.
 *
 * `imageOrientation: 'from-image'` is passed explicitly rather than left to the
 * default. The default changed mid-spec, so on some engines a photo taken in
 * portrait comes back rotated and on others it does not. Getting this wrong is
 * not subtle: every phone photo in the tool would appear sideways.
 */
export async function decodeImage(
  file: Blob,
  opts: { signal?: AbortSignal } = {},
): Promise<DecodeResult> {
  if (aborted(opts.signal)) return fail('cancelled', CANCELLED);
  if (!(file instanceof Blob) || file.size === 0) {
    return fail('corrupt_input', 'That file is empty, so there is nothing to open.');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (aborted(opts.signal)) {
        bitmap.close();
        return fail('cancelled', CANCELLED);
      }
      if (bitmap.width < 1 || bitmap.height < 1) {
        bitmap.close();
        return fail('corrupt_input', 'That image has no width or height, so it cannot be opened.');
      }
      let closed = false;
      return {
        ok: true,
        image: {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close() {
            if (closed) return;
            closed = true;
            bitmap.close();
          },
        },
      };
    } catch {
      // Fall through. The element path decodes strictly more formats.
    }
  }

  return decodeViaElement(file, opts.signal);
}

async function decodeViaElement(file: Blob, signal?: AbortSignal): Promise<DecodeResult> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return fail('unknown', NO_BROWSER);
  }

  const url = URL.createObjectURL(file);
  const element = new Image();
  // An object URL is same-origin, so the canvas stays untainted and `toBlob`
  // works. This would not hold for a remote URL, which is one more reason
  // nothing here ever fetches.
  element.decoding = 'sync';

  const loaded = await new Promise<boolean>((resolve) => {
    element.onload = () => resolve(true);
    element.onerror = () => resolve(false);
    element.src = url;
  });

  if (!loaded) {
    URL.revokeObjectURL(url);
    return fail(
      'corrupt_input',
      'This file could not be opened as an image. It may be damaged, or saved in a format this browser does not read.',
    );
  }
  if (aborted(signal)) {
    URL.revokeObjectURL(url);
    return fail('cancelled', CANCELLED);
  }

  const width = element.naturalWidth;
  const height = element.naturalHeight;
  if (width < 1 || height < 1) {
    URL.revokeObjectURL(url);
    // The realistic cause is an SVG with no `width`/`height` and no `viewBox`:
    // it is a valid file with no intrinsic size, and a canvas cannot guess one.
    return fail(
      'corrupt_input',
      'This image does not say how large it is. If it is an SVG, open it in an editor and give it a width and height, then try again.',
    );
  }

  let closed = false;
  return {
    ok: true,
    image: {
      source: element,
      width,
      height,
      close() {
        if (closed) return;
        closed = true;
        URL.revokeObjectURL(url);
      },
    },
  };
}

/* ───────────────────────── canvas plumbing ──────────────────────────────── */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function isOffscreen(canvas: AnyCanvas): canvas is OffscreenCanvas {
  return typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas;
}

/**
 * Whether `OffscreenCanvas` is usable *including* `convertToBlob`. Detected
 * rather than assumed: Safari shipped the constructor a full release before the
 * method, so `typeof OffscreenCanvas === 'function'` alone would pick a canvas
 * that can draw and cannot export. Memoised because the answer cannot change.
 */
let offscreenUsable: boolean | undefined;

function canUseOffscreen(): boolean {
  if (offscreenUsable !== undefined) return offscreenUsable;
  offscreenUsable = false;
  if (typeof OffscreenCanvas === 'function') {
    try {
      const probe = new OffscreenCanvas(1, 1);
      offscreenUsable = typeof probe.convertToBlob === 'function' && probe.getContext('2d') !== null;
    } catch {
      offscreenUsable = false;
    }
  }
  return offscreenUsable;
}

function makeCanvas(size: Size): AnyCanvas | null {
  const { width, height } = normaliseSize(size);
  if (width < 1 || height < 1) return null;
  if (canUseOffscreen()) {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Out of memory for a canvas that large. The element path may still cope.
    }
  }
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  } catch {
    return null;
  }
}

function context2d(canvas: AnyCanvas): AnyContext | null {
  // `alpha: true` unconditionally. Whether transparency survives is decided per
  // output format below; a context without an alpha channel would black out a
  // transparent PNG even when the target format supports one.
  // The two branches read identically and are not redundant: `getContext` has a
  // different return type on each class, and TypeScript refuses to resolve a
  // call against a union of overload sets. Narrowing first is the only way to
  // get a typed context without an `as` cast.
  const ctx = isOffscreen(canvas)
    ? canvas.getContext('2d', { alpha: true })
    : canvas.getContext('2d', { alpha: true });
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

async function canvasToBlob(
  canvas: AnyCanvas,
  mime: string,
  quality: number | undefined,
): Promise<Blob | null> {
  if (isOffscreen(canvas)) {
    try {
      return await canvas.convertToBlob(
        quality === undefined ? { type: mime } : { type: mime, quality },
      );
    } catch {
      return null;
    }
  }
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mime, quality);
    } catch {
      resolve(null);
    }
  });
}

/* ───────────────────────────── encode ───────────────────────────────────── */

export interface EncodeOptions {
  format: EncodableFormat;
  /** 0–1. Ignored for PNG, which is lossless. */
  quality?: number;
  /** Output size. Defaults to the size of the region being taken. */
  target?: Size;
  /** The part of the source to use. Defaults to all of it. */
  region?: Region;
  /**
   * Painted underneath the image when the output format has no alpha channel.
   * Defaults to white. Without this a transparent PNG saved as JPEG comes back
   * with black where the transparency was, which looks like corruption.
   */
  background?: string;
  /**
   * Quarter turns clockwise. Restricted to multiples of 90 on purpose: those
   * are the only rotations that map a rectangle onto a rectangle, so there is
   * never a triangle of empty canvas to fill and no resampling — the pixels are
   * the same pixels, in a different order. An arbitrary angle is a different
   * feature with different results (a bigger canvas, interpolated edges) and it
   * should not hide behind the same option.
   */
  rotate?: 0 | 90 | 180 | 270;
  /** Mirror left-to-right, applied after the rotation. */
  flipHorizontal?: boolean;
  /** Mirror top-to-bottom, applied after the rotation. */
  flipVertical?: boolean;
  signal?: AbortSignal;
}

/** JPEG is the only browser-writable format with no alpha channel. */
function needsFlatten(format: EncodableFormat): boolean {
  return format === 'jpeg';
}

function clampRegion(region: Region, image: { width: number; height: number }): Region {
  const x = Math.max(0, Math.min(Math.floor(region.x), image.width));
  const y = Math.max(0, Math.min(Math.floor(region.y), image.height));
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.floor(region.width), image.width - x)),
    height: Math.max(0, Math.min(Math.floor(region.height), image.height - y)),
  };
}

/**
 * Draw the image — optionally a sub-rectangle of it, optionally at a new size —
 * and encode the result.
 *
 * A large reduction is drawn as a chain of halvings from {@link resizeSteps}
 * rather than one call, because a single big downscale aliases: it samples about
 * one source pixel in ten and throws the rest away, so fine detail turns to
 * shimmer. That chain is most of why output from the resizer looks sharp.
 */
export async function encodeImage(
  image: DecodedImage,
  opts: EncodeOptions,
): Promise<EncodeResult> {
  if (aborted(opts.signal)) return fail('cancelled', CANCELLED);
  if (!canEncodeTo(opts.format as ImageFormat)) {
    return fail('encode_unsupported', 'This browser cannot save that format.');
  }

  const region = clampRegion(
    opts.region ?? { x: 0, y: 0, width: image.width, height: image.height },
    image,
  );
  if (region.width < 1 || region.height < 1) {
    return fail('invalid_input', 'The selected area is empty. Drag out a larger area and try again.');
  }

  const requested = normaliseSize(opts.target ?? { width: region.width, height: region.height });
  const { size: target, clamped } = clampToMaxPixels(requested);

  const chain = resizeSteps({ width: region.width, height: region.height }, target);

  let canvas = makeCanvas(chain[0]);
  let ctx = canvas === null ? null : context2d(canvas);
  if (canvas === null || ctx === null) {
    return fail(
      'out_of_memory',
      `This picture is too large for the browser to work on here (${CANVAS_LIMITS.maxDimension} pixels per side is the ceiling). Try a smaller size, or close some other tabs and try again.`,
    );
  }

  // First pass takes the region out of the source; later passes halve the
  // canvas into itself, which is why the same canvas is reused throughout.
  if (needsFlatten(opts.format)) {
    // Filled *before* the image is drawn, and only on the first canvas: the
    // picture then composites over the colour, and every later pass sees fully
    // opaque pixels. Filling at the end would paint over the picture; not
    // filling at all is what makes transparent PNGs come back with black edges
    // when saved as JPEG.
    ctx.fillStyle = opts.background ?? '#ffffff';
    ctx.fillRect(0, 0, chain[0].width, chain[0].height);
  }
  ctx.drawImage(
    image.source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    chain[0].width,
    chain[0].height,
  );

  for (let step = 1; step < chain.length; step += 1) {
    if (aborted(opts.signal)) return fail('cancelled', CANCELLED);
    const from = chain[step - 1];
    const to = chain[step];
    const next = makeCanvas(to);
    const nextCtx = next === null ? null : context2d(next);
    if (next === null || nextCtx === null) {
      return fail('out_of_memory', 'The browser ran out of room while resizing this picture.');
    }
    nextCtx.drawImage(canvas, 0, 0, from.width, from.height, 0, 0, to.width, to.height);
    canvas = next;
    ctx = nextCtx;
  }

  if (aborted(opts.signal)) return fail('cancelled', CANCELLED);

  /*
   * Orientation, as a final pass rather than folded into the first draw.
   *
   * Doing it here costs one extra canvas and buys a pipeline that stays
   * readable: the region logic, the flatten fill and the halving chain above
   * all continue to work in source orientation, and nothing had to learn about
   * swapped axes. The alternative — rotating during the first `drawImage` —
   * means every subsequent step, every clamp and every returned size has to
   * account for the swap, which is where the off-by-one-axis bugs live.
   *
   * At multiples of 90 the destination is the same rectangle with its sides
   * possibly exchanged, so there is no uncovered corner and no resampling.
   */
  const rotate = opts.rotate ?? 0;
  const flipH = opts.flipHorizontal === true;
  const flipV = opts.flipVertical === true;
  let finalSize = target;

  if (rotate !== 0 || flipH || flipV) {
    const quarterTurn = rotate === 90 || rotate === 270;
    finalSize = quarterTurn
      ? { width: target.height, height: target.width }
      : { width: target.width, height: target.height };

    const oriented = makeCanvas(finalSize);
    const orientedCtx = oriented === null ? null : context2d(oriented);
    if (oriented === null || orientedCtx === null) {
      return fail('out_of_memory', 'The browser ran out of room while rotating this picture.');
    }

    if (needsFlatten(opts.format)) {
      orientedCtx.fillStyle = opts.background ?? '#ffffff';
      orientedCtx.fillRect(0, 0, finalSize.width, finalSize.height);
    }

    // Move the origin to the centre, turn and mirror there, then draw the
    // source centred on it. Composing about the centre is what keeps the
    // picture in frame — rotating about (0,0) swings it off the canvas.
    orientedCtx.translate(finalSize.width / 2, finalSize.height / 2);
    if (rotate !== 0) orientedCtx.rotate((rotate * Math.PI) / 180);
    if (flipH || flipV) orientedCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    orientedCtx.drawImage(canvas, -target.width / 2, -target.height / 2);
    orientedCtx.setTransform(1, 0, 0, 1, 0, 0);

    canvas = oriented;
    ctx = orientedCtx;
  }

  const mime = mimeForFormat(opts.format as ImageFormat);
  const quality = opts.format === 'png' ? undefined : clampQuality(opts.quality);
  const blob = await canvasToBlob(canvas, mime, quality);

  if (blob === null || blob.size === 0) {
    return fail(
      'unknown',
      'The browser could not save this image. Try a smaller size, or a different format.',
    );
  }

  /*
   * The check this whole module is built around.
   *
   * `canvas.toBlob(cb, 'image/webp')` on a browser with no WebP encoder does
   * not fail — it quietly returns a PNG. Shipping that would mean a converter
   * that hands back a file named `.webp` containing a PNG, which is a fake
   * conversion, not a bug with a workaround. Comparing the Blob's own type
   * against what was asked for is the only reliable detection, and refusing is
   * the only honest response.
   */
  if (blob.type !== mime) {
    return fail(
      'encode_unsupported',
      `This browser cannot save ${FORMAT_LABEL[opts.format]} files. Chrome, Edge, Firefox and Safari 16 or newer all can — or pick a different output format below.`,
    );
  }

  return { ok: true, blob, format: opts.format, size: finalSize, clamped };
}

const FORMAT_LABEL: Record<EncodableFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
};

/**
 * Quality into the 0–1 range the canvas API expects.
 *
 * Out-of-range values are not an error to report: a slider that produced 1.2
 * should still save something sensible, and the platform's own behaviour for an
 * invalid value is to ignore it and use its default — which differs per browser
 * and is the inconsistency this avoids. 0.82 is the default because it is the
 * point where JPEG artefacts stop being visible on photographs at 100% zoom.
 */
function clampQuality(quality: number | undefined): number {
  if (quality === undefined || !Number.isFinite(quality)) return 0.82;
  return Math.min(1, Math.max(0.01, quality));
}

/* ─────────────────────── capability probing ─────────────────────────────── */

const encodeSupport = new Map<EncodableFormat, Promise<boolean>>();

/**
 * Whether this browser can genuinely write `format`, established by encoding a
 * 1×1 image and looking at what came back.
 *
 * The point is to let a UI hide or disable an output format it cannot honour
 * *before* the user picks it, rather than accepting a file, working, and then
 * apologising. It costs one 1×1 encode per format per page load, memoised —
 * including the in-flight promise, so ten simultaneous callers share one probe.
 *
 * Returns a promise rather than a boolean because `toBlob` is asynchronous.
 * There is no synchronous way to ask this question, and the alternative —
 * hardcoding a browser matrix — would be wrong within a release.
 */
export function canEncodeFormat(format: EncodableFormat): Promise<boolean> {
  const cached = encodeSupport.get(format);
  if (cached !== undefined) return cached;
  const probe = probeEncode(format);
  encodeSupport.set(format, probe);
  return probe;
}

async function probeEncode(format: EncodableFormat): Promise<boolean> {
  const canvas = makeCanvas({ width: 1, height: 1 });
  if (canvas === null) return false;
  const ctx = context2d(canvas);
  if (ctx === null) return false;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1, 1);
  const mime = mimeForFormat(format as ImageFormat);
  const blob = await canvasToBlob(canvas, mime, format === 'png' ? undefined : 0.8);
  return blob !== null && blob.type === mime;
}

/* ───────────────────────────── raw pixels ───────────────────────────────── */

export type PixelsResult = { ok: true; data: Uint8ClampedArray; size: Size } | CodecFailure;

/**
 * Around 30 megapixels. Four bytes a pixel means this is already a 120MB
 * allocation, which is as far as a phone will go without the tab being killed —
 * and being killed is indistinguishable, to the user, from the site breaking.
 */
const MAX_RAW_PIXELS = 30_000_000;

/**
 * RGBA samples in row order, for the one consumer that needs pixels rather than
 * a file: the lossless `raw` path in `pdf/writer.ts`, where re-encoding a
 * screenshot as JPEG would visibly smear text.
 */
export function readPixels(image: DecodedImage, target?: Size): PixelsResult {
  const wanted = normaliseSize(target ?? { width: image.width, height: image.height });
  const { size } = clampToMaxPixels(wanted, MAX_RAW_PIXELS);

  const canvas = makeCanvas(size);
  const ctx = canvas === null ? null : context2d(canvas);
  if (canvas === null || ctx === null) {
    return fail('out_of_memory', 'This picture is too large to read pixel-by-pixel in the browser.');
  }

  ctx.drawImage(image.source, 0, 0, image.width, image.height, 0, 0, size.width, size.height);
  try {
    const data = ctx.getImageData(0, 0, size.width, size.height).data;
    return { ok: true, data, size };
  } catch {
    // `getImageData` throws SecurityError on a tainted canvas. Everything here
    // is drawn from a Blob the user chose, so this should be unreachable — but
    // an unreachable throw still needs an answer that is not a stack trace.
    return fail('unknown', 'The browser would not hand back the pixels for this image.');
  }
}

/* ──────────────────────── encode to a size budget ───────────────────────── */

export interface BudgetOptions extends Omit<EncodeOptions, 'quality'> {
  /** The ceiling the output must come in under, in bytes. */
  maxBytes: number;
  /** Refuse to go below this quality rather than return mush. Default 0.4. */
  minQuality?: number;
}

export type BudgetResult =
  | {
      ok: true;
      blob: Blob;
      format: EncodableFormat;
      size: Size;
      clamped: boolean;
      /** The quality that was actually used, for display. */
      quality: number;
      attempts: number;
    }
  | CodecFailure;

/** Attempts in the search. Six halvings resolve quality to about ±0.01. */
const BUDGET_ATTEMPTS = 6;

/**
 * "Get this under 200 KB" — a binary search over JPEG/WebP quality.
 *
 * There is no formula for this. Compressed size depends on the content: a flat
 * screenshot at quality 0.6 may be a tenth the size of a leafy photograph at the
 * same setting, so the only way to hit a budget is to encode, measure, and
 * adjust. Six attempts on a phone is roughly a second for a large photo, which
 * is why the tool shows progress rather than pretending it is instant.
 *
 * When even the floor quality will not fit, this fails and says what the
 * smallest achievable size was. That is the honest answer: the alternative —
 * quietly dropping to quality 0.05 — returns a file that technically meets the
 * request and is useless.
 */
export async function encodeWithinBudget(
  image: DecodedImage,
  opts: BudgetOptions,
): Promise<BudgetResult> {
  const maxBytes = Math.floor(opts.maxBytes);
  if (!Number.isFinite(maxBytes) || maxBytes < 1024) {
    return fail('invalid_input', 'Choose a target size of at least 1 KB.');
  }

  // PNG is lossless and has no quality dial, so there is nothing to search.
  // Saying so is more useful than an empty progress bar.
  if (opts.format === 'png') {
    const once = await encodeImage(image, { ...opts, quality: undefined });
    if (!once.ok) return once;
    if (once.blob.size > maxBytes) {
      return fail(
        'encode_unsupported',
        `PNG has no quality setting to trade away, and this comes out at ${Math.round(once.blob.size / 1024)} KB. To go smaller, reduce the width, or save as JPEG or WebP instead.`,
      );
    }
    return { ...once, quality: 1, attempts: 1 };
  }

  const floor = clampQuality(opts.minQuality ?? 0.4);
  let low = floor;
  let high = 1;
  let best: { blob: Blob; size: Size; clamped: boolean; quality: number } | null = null;
  let attempts = 0;

  for (let i = 0; i < BUDGET_ATTEMPTS; i += 1) {
    if (aborted(opts.signal)) return fail('cancelled', CANCELLED);
    const quality = i === 0 ? high : (low + high) / 2;
    const attempt = await encodeImage(image, { ...opts, quality });
    attempts += 1;
    if (!attempt.ok) return attempt;

    const bytes = attempt.blob.size;

    if (bytes <= maxBytes) {
      // Fits. Keep it and try for better quality in the upper half.
      best = { blob: attempt.blob, size: attempt.size, clamped: attempt.clamped, quality };
      low = quality;
      // The first attempt is full quality; if that already fits, stop.
      if (i === 0) break;
    } else {
      high = quality;
      if (high <= floor) break;
    }
  }

  if (best === null) {
    // Nothing in the search fitted, but the search never lands exactly on the
    // floor — it converges towards it. So measure the floor properly before
    // quoting a number: a message that says "the smallest at 40% quality is
    // 260 KB" should be reporting 40%, not 41.9%.
    if (aborted(opts.signal)) return fail('cancelled', CANCELLED);
    const atFloor = await encodeImage(image, { ...opts, quality: floor });
    attempts += 1;
    if (!atFloor.ok) return atFloor;
    if (atFloor.blob.size <= maxBytes) {
      return {
        ok: true,
        blob: atFloor.blob,
        format: opts.format,
        size: atFloor.size,
        clamped: atFloor.clamped,
        quality: floor,
        attempts,
      };
    }
    return fail(
      'encode_unsupported',
      `The smallest this gets at ${Math.round(floor * 100)}% quality is about ${Math.round(atFloor.blob.size / 1024)} KB, which is still over your ${Math.round(maxBytes / 1024)} KB target. Reducing the width as well will get you there.`,
    );
  }

  return {
    ok: true,
    blob: best.blob,
    format: opts.format,
    size: best.size,
    clamped: best.clamped,
    quality: best.quality,
    attempts,
  };
}
