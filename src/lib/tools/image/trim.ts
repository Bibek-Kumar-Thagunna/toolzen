/**
 * ============================================================================
 * CONTENT BOUNDS — where the ink actually is
 * ============================================================================
 * Given RGBA pixels, find the smallest rectangle that still contains
 * everything that is not background.
 *
 * ── Why a signature tool needs this and a photo tool does not ─────────────
 * Exam and application portals ask for a signature under a hard byte ceiling,
 * commonly 20 KB. People produce that file by signing a sheet of A4 and
 * photographing it, so the picture that arrives is 3000×4000 pixels of which
 * perhaps 8% is the signature and the rest is paper.
 *
 * Compressing that to 20 KB by quality and scale alone destroys it: every
 * pixel of blank paper costs the same as a pixel of ink, so the budget is
 * spent almost entirely on nothing. Cropping to the ink first means the same
 * 20 KB is spent on the part that has to stay legible, and the result is
 * usually the difference between an accepted upload and a rejected one.
 *
 * That is a genuine behavioural difference, which is the bar the variant tools
 * in this codebase are held to — not a preset in a box.
 *
 * ── Why "not white" is not the test ───────────────────────────────────────
 * Paper photographed under a room light is not #FFFFFF. It is a grey-beige
 * that drifts across the sheet, often by more than 30 levels from one corner
 * to the other, and a fixed threshold either keeps the whole page (threshold
 * too tight) or eats the thin end of a pen stroke (too loose).
 *
 * So the background is measured rather than assumed: the median of the four
 * corners is taken as the paper colour, and a pixel counts as content when it
 * differs from that by more than `tolerance`. A dark scan on a light desk and
 * a light signature on dark paper both work, because the corners describe
 * whichever one it is.
 *
 * ── Why the result is padded ──────────────────────────────────────────────
 * A crop that touches the ink exactly reads as a mistake — descenders look
 * clipped even when every pixel is present. A small margin proportional to the
 * content restores the impression of a deliberate crop, and it also protects
 * against the tolerance having shaved a pale edge pixel.
 *
 * Pure, so it is tested under `node --test`; the pixels come from
 * `readPixels` in the one module that needs a browser.
 * ============================================================================
 */
import type { Size } from './dimensions.ts';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsOptions {
  /**
   * How far a channel may drift from the measured background before the pixel
   * counts as content. In 0–255 levels.
   *
   * 32 is deliberately generous. Under-cropping leaves some paper, which costs
   * a few hundred bytes; over-cropping removes part of the signature, which
   * costs the user their application. The two errors are not symmetric, so the
   * threshold leans towards keeping too much.
   */
  tolerance?: number;
  /** Margin to add back, as a fraction of the content box. */
  padding?: number;
}

const DEFAULT_TOLERANCE = 32;
const DEFAULT_PADDING = 0.04;

/** Median of four, without sorting an array for every channel. */
function median4(a: number, b: number, c: number, d: number): number {
  const lo1 = Math.min(a, b);
  const hi1 = Math.max(a, b);
  const lo2 = Math.min(c, d);
  const hi2 = Math.max(c, d);
  // Average the two middle values, which for four samples is the median.
  return (Math.max(lo1, lo2) + Math.min(hi1, hi2)) / 2;
}

/**
 * The background colour, taken as the median of the four corner pixels.
 *
 * Median rather than mean because one corner is frequently not paper at all —
 * a thumb, a shadow, the edge of the desk — and a mean would drag the whole
 * estimate towards it. A median of four survives one bad corner intact.
 */
function backgroundAt(data: Uint8ClampedArray, size: Size): [number, number, number] {
  const { width, height } = size;
  const at = (x: number, y: number): number => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const channel = (offset: number): number =>
    median4(
      data[(corners[0] ?? 0) + offset] ?? 0,
      data[(corners[1] ?? 0) + offset] ?? 0,
      data[(corners[2] ?? 0) + offset] ?? 0,
      data[(corners[3] ?? 0) + offset] ?? 0,
    );
  return [channel(0), channel(1), channel(2)];
}

/**
 * The smallest padded rectangle containing every non-background pixel.
 *
 * Returns the full frame when nothing stands out from the background — a blank
 * scan, or a picture whose corners happen to be the subject. Returning the
 * whole image is the safe failure: the caller compresses a slightly larger
 * picture, rather than a one-pixel crop of nothing.
 *
 * Fully transparent pixels are background regardless of their colour. A PNG
 * signature exported with a cut-out background stores arbitrary RGB under
 * alpha 0, and reading those as content would defeat the crop entirely.
 */
export function contentBounds(
  data: Uint8ClampedArray,
  size: Size,
  opts: BoundsOptions = {},
): Bounds {
  const { width, height } = size;
  const whole: Bounds = { x: 0, y: 0, width, height };
  if (width < 1 || height < 1 || data.length < width * height * 4) return whole;

  const tolerance = Math.max(0, opts.tolerance ?? DEFAULT_TOLERANCE);
  const [bgR, bgG, bgB] = backgroundAt(data, size);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const at = row + x * 4;
      if ((data[at + 3] ?? 0) < 8) continue;
      const dr = Math.abs((data[at] ?? 0) - bgR);
      const dg = Math.abs((data[at + 1] ?? 0) - bgG);
      const db = Math.abs((data[at + 2] ?? 0) - bgB);
      if (dr <= tolerance && dg <= tolerance && db <= tolerance) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return whole;

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const pad = Math.max(0, opts.padding ?? DEFAULT_PADDING);
  const padX = Math.round(contentWidth * pad);
  const padY = Math.round(contentHeight * pad);

  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  return {
    x,
    y,
    width: Math.min(width - x, contentWidth + padX * 2),
    height: Math.min(height - y, contentHeight + padY * 2),
  };
}

/** Whether a crop is worth performing at all, as a fraction of the original area. */
export function isWorthCropping(bounds: Bounds, size: Size, minSaving = 0.08): boolean {
  const before = size.width * size.height;
  if (before <= 0) return false;
  const after = bounds.width * bounds.height;
  return after > 0 && (before - after) / before >= minSaving;
}
