/**
 * ============================================================================
 * COLOUR QUANTIZATION
 * ============================================================================
 * Reducing an image to a small palette — the step that makes "compress PNG"
 * mean something.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * PNG is lossless, so re-encoding one through a browser canvas cannot make it
 * meaningfully smaller: it is looking for a tidier way to describe pixels it is
 * not allowed to change, and any encoder worth the name has already found it.
 * That is why a "PNG compressor" built on `canvas.toBlob` routinely hands back
 * a *larger* file than it was given.
 *
 * The saving in a PNG comes from somewhere else: storing 256 colours in a
 * palette and one index per pixel instead of three or four bytes per pixel.
 * A screenshot or a flat graphic loses nothing visible and typically drops by
 * 60 to 80 per cent. A photograph loses real gradient detail, which is why the
 * tool says so rather than quietly doing it.
 *
 * This is the same technique the well-known PNG compression services use.
 *
 * ── Median cut, not k-means ───────────────────────────────────────────────
 * Median cut splits the colour cube repeatedly along the widest axis of the
 * most populous box. It is O(n log k), deterministic, and needs no iteration
 * count or convergence check — all of which matters when the budget is "does
 * not lock up a phone browser". k-means gives slightly better palettes for
 * substantially more time and a nondeterministic result.
 *
 * ── Alpha is a fourth axis, not a special case ────────────────────────────
 * Splitting on alpha alongside red, green and blue means a cut-out logo gets
 * palette entries for its soft edge rather than a hard one, and it costs one
 * extra comparison per split. Fully transparent pixels collapse into a single
 * entry naturally, because their box has zero extent on every axis.
 *
 * ── Floyd–Steinberg, optional ─────────────────────────────────────────────
 * Without dithering, a smooth sky becomes visible bands. Error diffusion trades
 * those bands for fine noise, which compresses slightly worse but looks far
 * better on anything photographic. It is off for flat graphics, where it would
 * add noise to areas that quantized perfectly.
 * ============================================================================
 */

export interface PaletteEntry {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface QuantizeOptions {
  /** Palette size, 2–256. */
  colors: number;
  /** Diffuse the error into neighbouring pixels. Better for photographs. */
  dither?: boolean;
}

export interface QuantizeResult {
  palette: PaletteEntry[];
  /** One palette index per pixel, row-major. */
  indices: Uint8Array;
}

const MAX_COLORS = 256;
const MIN_COLORS = 2;

/**
 * Pixels sampled when choosing the palette.
 *
 * The palette only has to be representative, and every pixel is mapped against
 * it afterwards regardless. Sampling caps the cost of the expensive half on a
 * 50-megapixel image without changing the result in any way a person can see:
 * a stride is taken across the whole image rather than a corner of it, so a
 * colour that appears anywhere still gets a vote.
 */
const SAMPLE_TARGET = 300_000;

interface Box {
  /** Indices into the sample array, [start, end). */
  start: number;
  end: number;
  /** Inclusive bounds per channel. */
  min: [number, number, number, number];
  max: [number, number, number, number];
}

/** Widest channel of a box, and how wide it is. */
function widestAxis(box: Box): { axis: 0 | 1 | 2 | 3; extent: number } {
  let axis: 0 | 1 | 2 | 3 = 0;
  let extent = -1;
  for (let c = 0 as 0 | 1 | 2 | 3; c < 4; c = (c + 1) as 0 | 1 | 2 | 3) {
    const span = box.max[c] - box.min[c];
    if (span > extent) {
      extent = span;
      axis = c;
    }
  }
  return { axis, extent };
}

function measure(samples: Uint8Array, start: number, end: number): Pick<Box, 'min' | 'max'> {
  const min: [number, number, number, number] = [255, 255, 255, 255];
  const max: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = start; i < end; i += 1) {
    const at = i * 4;
    for (let c = 0; c < 4; c += 1) {
      const value = samples[at + c] as number;
      if (value < (min[c] as number)) min[c] = value;
      if (value > (max[c] as number)) max[c] = value;
    }
  }
  return { min, max };
}

/** Sort one slice of the sample array by a single channel, in place. */
function sortSlice(samples: Uint8Array, start: number, end: number, axis: number): void {
  const count = end - start;
  const view = new Uint8Array(count * 4);
  view.set(samples.subarray(start * 4, end * 4));

  const order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => (view[a * 4 + axis] as number) - (view[b * 4 + axis] as number));

  for (let i = 0; i < count; i += 1) {
    const from = (order[i] as number) * 4;
    const to = (start + i) * 4;
    samples[to] = view[from] as number;
    samples[to + 1] = view[from + 1] as number;
    samples[to + 2] = view[from + 2] as number;
    samples[to + 3] = view[from + 3] as number;
  }
}

function averageColor(samples: Uint8Array, start: number, end: number): PaletteEntry {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const count = end - start;
  for (let i = start; i < end; i += 1) {
    const at = i * 4;
    r += samples[at] as number;
    g += samples[at + 1] as number;
    b += samples[at + 2] as number;
    a += samples[at + 3] as number;
  }
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
    a: Math.round(a / count),
  };
}

/**
 * Every distinct colour, if there are no more than `limit` of them.
 *
 * Returns null as soon as the image proves to have more, so a photograph costs
 * a partial scan rather than a set with a million entries in it.
 */
function distinctColors(
  rgba: Uint8ClampedArray | Uint8Array,
  limit: number,
): PaletteEntry[] | null {
  const seen = new Map<number, PaletteEntry>();
  const pixelCount = Math.floor(rgba.length / 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const at = i * 4;
    const r = rgba[at] as number;
    const g = rgba[at + 1] as number;
    const b = rgba[at + 2] as number;
    const a = rgba[at + 3] as number;
    const key = (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
    if (!seen.has(key)) {
      if (seen.size >= limit) return null;
      seen.set(key, { r, g, b, a });
    }
  }
  return [...seen.values()];
}

/**
 * Where to cut a sorted box.
 *
 * The median index is the starting point, but cutting exactly there can land in
 * the middle of a run of identical values — which produces two boxes holding
 * the same colour, and therefore two identical palette entries. Both are wasted,
 * and on an image with a large flat area most of the palette goes that way.
 *
 * So the cut moves to the nearest position where the value on the split axis
 * actually changes. One exists whenever the box has any extent on that axis,
 * which is the only case this is called in.
 */
function splitPoint(samples: Uint8Array, box: Box, axis: number): number {
  const median = box.start + Math.floor((box.end - box.start) / 2);
  const valueAt = (i: number): number => samples[i * 4 + axis] as number;

  for (let offset = 0; offset < box.end - box.start; offset += 1) {
    const forward = median + offset;
    if (forward > box.start && forward < box.end && valueAt(forward) !== valueAt(forward - 1)) {
      return forward;
    }
    const back = median - offset;
    if (back > box.start && back < box.end && valueAt(back) !== valueAt(back - 1)) {
      return back;
    }
  }
  return median;
}

/**
 * Choose a palette by median cut.
 *
 * Exported for its own test: the palette is the half of this module where a
 * mistake is visible in the output rather than merely slow.
 */
export function buildPalette(rgba: Uint8ClampedArray | Uint8Array, colors: number): PaletteEntry[] {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return [{ r: 0, g: 0, b: 0, a: 0 }];

  /*
   * The exact case first. A screenshot, a logo or a diagram very often holds
   * fewer distinct colours than the palette has room for, and then median cut
   * is not merely unnecessary — it is worse than nothing, because every entry
   * it produces is the *average* of a box and a box that straddles two runs of
   * identical pixels returns a colour that was never in the image.
   *
   * Listing the colours instead is exact, and it is the common case for the
   * images this whole path exists to compress.
   */
  const exact = distinctColors(rgba, colors);
  if (exact !== null) return exact;

  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_TARGET));
  const sampleCount = Math.ceil(pixelCount / stride);
  const samples = new Uint8Array(sampleCount * 4);
  for (let i = 0; i < sampleCount; i += 1) {
    const from = Math.min(pixelCount - 1, i * stride) * 4;
    samples[i * 4] = rgba[from] as number;
    samples[i * 4 + 1] = rgba[from + 1] as number;
    samples[i * 4 + 2] = rgba[from + 2] as number;
    samples[i * 4 + 3] = rgba[from + 3] as number;
  }

  const first: Box = { start: 0, end: sampleCount, ...measure(samples, 0, sampleCount) };
  const boxes: Box[] = [first];

  while (boxes.length < colors) {
    // Split the box that is widest on any axis. Splitting the most *populous*
    // box instead is the other common choice and it wastes entries on large
    // areas of near-identical colour — a white page background eats half the
    // palette that way.
    let target = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i] as Box;
      if (box.end - box.start < 2) continue;
      const { extent } = widestAxis(box);
      if (extent > best) {
        best = extent;
        target = i;
      }
    }
    // Every remaining box is a single colour: the image has fewer distinct
    // colours than the palette allows, which is a success, not a failure.
    if (target === -1) break;

    const box = boxes[target] as Box;
    const { axis } = widestAxis(box);
    sortSlice(samples, box.start, box.end, axis);
    const middle = splitPoint(samples, box, axis);

    const left: Box = { start: box.start, end: middle, ...measure(samples, box.start, middle) };
    const right: Box = { start: middle, end: box.end, ...measure(samples, middle, box.end) };
    boxes.splice(target, 1, left, right);
  }

  // Two boxes can still average to the same colour on an image with very few
  // distinct values. A duplicate entry is a wasted slot and, at the boundary
  // between bit depths, an entirely wasted bit per pixel.
  const unique = new Map<number, PaletteEntry>();
  for (const box of boxes) {
    const entry = averageColor(samples, box.start, box.end);
    const key = (((entry.r << 24) | (entry.g << 16) | (entry.b << 8) | entry.a) >>> 0);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

/** Squared distance in RGBA space. Square roots are not needed to compare. */
function distance(
  r: number,
  g: number,
  b: number,
  a: number,
  entry: PaletteEntry,
): number {
  const dr = r - entry.r;
  const dg = g - entry.g;
  const db = b - entry.b;
  const da = a - entry.a;
  // Alpha is weighted heavily: putting a transparent pixel in an opaque
  // palette entry is far more visible than a small hue shift.
  return dr * dr + dg * dg + db * db + da * da * 4;
}

function nearest(palette: PaletteEntry[], r: number, g: number, b: number, a: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const d = distance(r, g, b, a, palette[i] as PaletteEntry);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Reduce an image to a palette and an index per pixel.
 *
 * `width` is needed only for dithering, which has to know where a row ends
 * before it pushes error sideways into the next pixel.
 */
export function quantize(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: QuantizeOptions,
): QuantizeResult {
  const colors = Math.max(MIN_COLORS, Math.min(MAX_COLORS, Math.round(opts.colors)));
  const palette = buildPalette(rgba, colors);
  const pixelCount = width * height;
  const indices = new Uint8Array(pixelCount);

  if (opts.dither !== true) {
    // Exact colours repeat constantly — a flat background is millions of hits
    // on one key — so the cache turns the common case into a map lookup.
    const cache = new Map<number, number>();
    for (let i = 0; i < pixelCount; i += 1) {
      const at = i * 4;
      const r = rgba[at] as number;
      const g = rgba[at + 1] as number;
      const b = rgba[at + 2] as number;
      const a = rgba[at + 3] as number;
      const key = (r << 24) | (g << 16) | (b << 8) | a;
      const hit = cache.get(key);
      if (hit !== undefined) {
        indices[i] = hit;
        continue;
      }
      const index = nearest(palette, r, g, b, a);
      cache.set(key, index);
      indices[i] = index;
    }
    return { palette, indices };
  }

  // Floyd–Steinberg. The error buffer is float, and it is the whole image
  // rather than two rows: the arithmetic is clearer and a 4-byte float per
  // channel is cheap next to the RGBA data already in memory.
  const error = new Float32Array(pixelCount * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const at = i * 4;
      const r = clamp255((rgba[at] as number) + (error[i * 3] as number));
      const g = clamp255((rgba[at + 1] as number) + (error[i * 3 + 1] as number));
      const b = clamp255((rgba[at + 2] as number) + (error[i * 3 + 2] as number));
      const a = rgba[at + 3] as number;

      const index = nearest(palette, r, g, b, a);
      indices[i] = index;
      const chosen = palette[index] as PaletteEntry;

      const er = r - chosen.r;
      const eg = g - chosen.g;
      const eb = b - chosen.b;

      // 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right.
      const spread = (target: number, weight: number): void => {
        error[target * 3] = (error[target * 3] as number) + er * weight;
        error[target * 3 + 1] = (error[target * 3 + 1] as number) + eg * weight;
        error[target * 3 + 2] = (error[target * 3 + 2] as number) + eb * weight;
      };
      if (x + 1 < width) spread(i + 1, 7 / 16);
      if (y + 1 < height) {
        if (x > 0) spread(i + width - 1, 3 / 16);
        spread(i + width, 5 / 16);
        if (x + 1 < width) spread(i + width + 1, 1 / 16);
      }
    }
  }

  return { palette, indices };
}

/**
 * How many distinct colours an image actually contains, counted up to a cap.
 *
 * Used to decide whether quantizing is worth offering at all: an image that
 * already has 40 colours cannot be improved by reducing it to 256, and telling
 * somebody their screenshot compressed by 0% is better done before the work
 * than after it. Counting stops at the cap because the only question is
 * "more than this?", and a photograph would otherwise fill a set with millions
 * of entries to answer it.
 */
export function countColors(rgba: Uint8ClampedArray | Uint8Array, cap = 4096): number {
  const seen = new Set<number>();
  const pixelCount = Math.floor(rgba.length / 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const at = i * 4;
    seen.add(
      (((rgba[at] as number) << 24) |
        ((rgba[at + 1] as number) << 16) |
        ((rgba[at + 2] as number) << 8) |
        (rgba[at + 3] as number)) >>>
        0,
    );
    if (seen.size >= cap) return cap;
  }
  return seen.size;
}
