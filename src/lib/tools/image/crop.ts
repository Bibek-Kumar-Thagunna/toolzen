/**
 * The geometry behind cropping, rotating and flipping: rectangles that stay
 * inside the picture, hold a ratio when asked, and never turn inside out.
 *
 * This is the layer an interactive cropper is built on, and it is deliberately
 * pure — no `document`, no `canvas`, no pointer events. A drag arrives here as
 * two numbers, and what comes back is the rectangle to draw. That is what makes
 * the awkward cases (dragging the west handle past the east edge, dragging a
 * locked 16:9 selection into a corner, dragging 3000px when the picture is 800px
 * wide) testable thousands of times a second instead of by hand.
 *
 * Every returned rectangle satisfies all of these at once:
 *   - whole pixels;
 *   - `x`, `y` ≥ 0 and `x + width` ≤ bounds, `y + height` ≤ bounds;
 *   - `width` and `height` positive, and at least `minSize` where the bounds
 *     allow it — the bounds win, since a rectangle outside the picture is worse
 *     than a small one.
 */

import { aspectRatio, normaliseSize, toPixel } from './dimensions.ts';
import type { Size } from './dimensions.ts';

/** A crop box in pixels, measured from the top-left of the picture. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which grip is being dragged. `move` slides the whole rectangle. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

/** Where a crop sits when it is smaller than the picture in one direction. */
export type CropAnchor = 'centre' | 'top' | 'bottom' | 'left' | 'right';

/** The default smallest crop, in pixels. Small enough to be useful, large enough to grab. */
const DEFAULT_MIN_SIZE = 16;

/**
 * A position, rounded half up. Unlike a dimension, 0 is a perfectly good answer:
 * a crop flush against the left edge has `x === 0`.
 */
function toOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value + 0.5);
}

/** A drag distance. Nonsense becomes no movement rather than a NaN rectangle. */
function toDelta(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Clamp, and if the window is empty prefer the low end — bounds beat minimums. */
function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  if (value < low) return low;
  return value > high ? high : value;
}

/**
 * Pull a rectangle onto whole pixels and inside the picture.
 *
 * The order matters: the size is capped to the picture first, then the position
 * is clamped to what is left. Doing it the other way round would let an oversized
 * rectangle push its own origin negative.
 */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const box = normaliseSize(bounds);
  const width = Math.min(toPixel(rect.width), box.width);
  const height = Math.min(toPixel(rect.height), box.height);
  return {
    x: clamp(toOffset(rect.x), 0, box.width - width),
    y: clamp(toOffset(rect.y), 0, box.height - height),
    width,
    height,
  };
}

/**
 * The whole-pixel size nearest `extent` that holds `ratio`.
 *
 * `extent` is always the shorter side: the height for a landscape ratio, the
 * width for a portrait one. The shorter side is rounded and the longer side is
 * then derived from it, which keeps `width - height × ratio` inside half a pixel.
 * Rounding the longer side first would leave the error at half a pixel *times*
 * the ratio, and on a 21:9 selection that is visible.
 */
function lockedSize(extent: number, ratio: number): Size {
  if (ratio >= 1) {
    const height = toPixel(extent);
    return { width: toPixel(height * ratio), height };
  }
  const width = toPixel(extent);
  return { width, height: toPixel(width / ratio) };
}

/**
 * How large and how small a ratio-locked rectangle may be inside `bounds`.
 *
 * The upper end is worked out from the *other* side, using `floor` so that the
 * derived side in `lockedSize` can never round past the picture edge. The lower
 * end is capped by the upper end, so a picture too small to hold `minSize` at
 * this ratio yields the largest rectangle that does fit rather than one that
 * hangs outside the image.
 */
function extentRange(ratio: number, bounds: Size, minSize: number): { low: number; high: number } {
  const widest =
    ratio >= 1
      ? Math.min(bounds.height, Math.floor(bounds.width / ratio))
      : Math.min(bounds.width, Math.floor(bounds.height * ratio));
  const high = Math.max(1, widest);
  return { low: Math.min(Math.max(1, minSize), high), high };
}

/** A usable `minSize`, whatever the caller passed. */
function resolveMinSize(minSize: number | undefined): number {
  const wanted = typeof minSize === 'number' && Number.isFinite(minSize) ? minSize : DEFAULT_MIN_SIZE;
  return Math.max(1, Math.floor(wanted));
}

/**
 * The largest rectangle of the given ratio that fits, positioned by `anchor`.
 *
 * `ratio` is width ÷ height, so 1 is a square and 16 / 9 is widescreen. A ratio
 * that makes no sense falls back to the picture's own shape, which means the whole
 * picture — the least surprising thing to do with a broken input.
 */
export function cropToRatio(source: Size, ratio: number, anchor: CropAnchor = 'centre'): Rect {
  const src = normaliseSize(source);
  const wanted = Number.isFinite(ratio) && ratio > 0 ? ratio : src.width / src.height;
  const range = extentRange(wanted, src, 1);
  const size = lockedSize(range.high, wanted);
  const width = Math.min(size.width, src.width);
  const height = Math.min(size.height, src.height);

  let x = toOffset((src.width - width) / 2);
  let y = toOffset((src.height - height) / 2);
  if (anchor === 'left') x = 0;
  else if (anchor === 'right') x = src.width - width;
  else if (anchor === 'top') y = 0;
  else if (anchor === 'bottom') y = src.height - height;

  return clampRect({ x, y, width, height }, src);
}

/** The largest rectangle of the given ratio, centred. What a "1:1" button does. */
export function centreCrop(source: Size, ratio: number): Rect {
  return cropToRatio(source, ratio, 'centre');
}

/** Which handles move which edge. `move` appears in none of them. */
const MOVES_LEFT: ReadonlySet<Handle> = new Set<Handle>(['nw', 'w', 'sw']);
const MOVES_RIGHT: ReadonlySet<Handle> = new Set<Handle>(['ne', 'e', 'se']);
const MOVES_TOP: ReadonlySet<Handle> = new Set<Handle>(['nw', 'n', 'ne']);
const MOVES_BOTTOM: ReadonlySet<Handle> = new Set<Handle>(['sw', 's', 'se']);

/**
 * Bring a rectangle up to `minSize` before a drag starts, so a drag can only ever
 * improve matters. The bounds still win, and `clampRect` keeps it inside.
 */
function normaliseRect(rect: Rect, bounds: Size, minSize: number): Rect {
  const width = Math.min(Math.max(toPixel(rect.width), minSize), bounds.width);
  const height = Math.min(Math.max(toPixel(rect.height), minSize), bounds.height);
  return clampRect({ x: rect.x, y: rect.y, width, height }, bounds);
}

/**
 * A free drag: move the edges the handle owns, and clamp each one against its
 * opposite edge and the picture.
 *
 * Clamping against the opposite edge — rather than allowing a swap — is what
 * stops the rectangle turning inside out when the pointer crosses over. Dragging
 * the west grip past the east one parks it `minSize` short and stays there, which
 * is what every cropper worth using does.
 */
function resizeFree(start: Rect, handle: Handle, dx: number, dy: number, bounds: Size, minSize: number): Rect {
  const minWidth = Math.min(minSize, bounds.width);
  const minHeight = Math.min(minSize, bounds.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (MOVES_LEFT.has(handle)) left = clamp(toOffset(left + dx), 0, right - minWidth);
  if (MOVES_RIGHT.has(handle)) right = clamp(toOffset(right + dx), left + minWidth, bounds.width);
  if (MOVES_TOP.has(handle)) top = clamp(toOffset(top + dy), 0, bottom - minHeight);
  if (MOVES_BOTTOM.has(handle)) bottom = clamp(toOffset(bottom + dy), top + minHeight, bounds.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A ratio-locked drag, in four steps: read what the drag asks for, let one axis
 * win, cap the size to what the picture can hold, then place it.
 *
 * The last step is the one that matters. The size is fixed before the position is
 * chosen, and the position is then clamped — so a locked selection dragged into a
 * corner *slides along the edge* at full size instead of jamming or quietly
 * dropping the ratio. Shrinking to fit would fight the person dragging; sliding is
 * what they meant.
 */
function resizeLocked(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: Size,
  minSize: number,
  ratio: number,
): Rect {
  let wantWidth = start.width;
  let wantHeight = start.height;
  if (MOVES_LEFT.has(handle)) wantWidth = start.width - dx;
  if (MOVES_RIGHT.has(handle)) wantWidth = start.width + dx;
  if (MOVES_TOP.has(handle)) wantHeight = start.height - dy;
  if (MOVES_BOTTOM.has(handle)) wantHeight = start.height + dy;

  // On a corner both axes moved, so one has to win: whichever the pointer moved
  // further in, compared fairly by putting the vertical change into width units.
  const movedWidth = Math.abs(wantWidth - start.width);
  const movedHeight = Math.abs(wantHeight - start.height) * ratio;
  const width = movedWidth >= movedHeight ? wantWidth : wantHeight * ratio;

  const range = extentRange(ratio, bounds, minSize);
  const extent = clamp(ratio >= 1 ? width / ratio : width, range.low, range.high);
  const size = lockedSize(extent, ratio);

  const holdRight = MOVES_LEFT.has(handle);
  const holdBottom = MOVES_TOP.has(handle);
  const movesX = holdRight || MOVES_RIGHT.has(handle);
  const movesY = holdBottom || MOVES_BOTTOM.has(handle);
  const centredX = toOffset(start.x + (start.width - size.width) / 2);
  const centredY = toOffset(start.y + (start.height - size.height) / 2);
  const x = holdRight ? start.x + start.width - size.width : movesX ? start.x : centredX;
  const y = holdBottom ? start.y + start.height - size.height : movesY ? start.y : centredY;

  return clampRect({ x, y, width: size.width, height: size.height }, bounds);
}

/**
 * Apply one drag of one handle and return the new rectangle.
 *
 * This is the heart of the interactive cropper, and the contract is absolute: the
 * result never inverts, never leaves the picture, is never smaller than `minSize`
 * (16px unless told otherwise) where the picture allows it, and is always whole
 * pixels. With `lockRatio` the ratio is held to within half a pixel. `move`
 * translates and stops dead at the edges without shrinking.
 *
 * `dx` and `dy` are the total movement since the drag began, not since the last
 * event, so a caller can recompute from the original rectangle on every pointer
 * move and never accumulate rounding error. A `lockRatio` of zero, a negative, or
 * nothing at all means a free drag.
 */
export function resizeRect(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  bounds: Size,
  opts: { lockRatio?: number; minSize?: number } = {},
): Rect {
  const box = normaliseSize(bounds);
  const minSize = resolveMinSize(opts.minSize);
  const start = normaliseRect(rect, box, minSize);
  const stepX = toDelta(dx);
  const stepY = toDelta(dy);
  const lock =
    typeof opts.lockRatio === 'number' && Number.isFinite(opts.lockRatio) && opts.lockRatio > 0
      ? opts.lockRatio
      : null;

  if (handle === 'move') {
    return {
      x: clamp(toOffset(start.x + stepX), 0, box.width - start.width),
      y: clamp(toOffset(start.y + stepY), 0, box.height - start.height),
      width: start.width,
      height: start.height,
    };
  }
  if (lock === null) return resizeFree(start, handle, stepX, stepY, box, minSize);
  return resizeLocked(start, handle, stepX, stepY, box, minSize, lock);
}

/**
 * Turn percentages of the picture into pixels.
 *
 * Percentages are the sane thing to store and to put in a URL: they survive the
 * same crop being applied to a thumbnail and to the full-size original, which
 * pixel coordinates do not.
 */
export function rectFromPercent(percent: Rect, source: Size): Rect {
  const src = normaliseSize(source);
  return clampRect(
    {
      x: (toDelta(percent.x) / 100) * src.width,
      y: (toDelta(percent.y) / 100) * src.height,
      width: (toDelta(percent.width) / 100) * src.width,
      height: (toDelta(percent.height) / 100) * src.height,
    },
    src,
  );
}

/**
 * Turn pixels into percentages of the picture.
 *
 * Kept to four decimal places, which is deliberate: enough that
 * `rectToPercent` → `rectFromPercent` comes back to the same pixel even on a
 * 16000px image, few enough that the numbers stay short in a URL.
 */
export function rectToPercent(rect: Rect, source: Size): Rect {
  const src = normaliseSize(source);
  const inside = clampRect(rect, src);
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return {
    x: round((inside.x / src.width) * 100),
    y: round((inside.y / src.height) * 100),
    width: round((inside.width / src.width) * 100),
    height: round((inside.height / src.height) * 100),
  };
}

/**
 * The canvas size needed to hold the picture after rotating it.
 *
 * Quarter turns are handled by swapping the two numbers, with no trigonometry at
 * all, so 1920 × 1080 rotated 90° is exactly 1080 × 1920 — not 1080.0000000001
 * rounded and hoped for. Every other angle gets the bounding box of the rotated
 * rectangle, which is what a canvas has to allocate to avoid clipping the corners.
 */
export function rotateSize(size: Size, degrees: number): Size {
  const src = normaliseSize(size);
  const raw = Number.isFinite(degrees) ? degrees : 0;
  const turn = ((raw % 360) + 360) % 360;
  if (turn === 0 || turn === 180) return src;
  if (turn === 90 || turn === 270) return { width: src.height, height: src.width };

  const radians = (turn * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: toPixel(src.width * cos + src.height * sin),
    height: toPixel(src.width * sin + src.height * cos),
  };
}

/**
 * Where a crop ends up after the picture is mirrored.
 *
 * Needed because flipping the picture without moving the selection would silently
 * crop a different part of it, which looks like a bug to anyone watching.
 */
export function flipRect(rect: Rect, bounds: Size, axis: 'horizontal' | 'vertical'): Rect {
  const box = normaliseSize(bounds);
  const inside = clampRect(rect, box);
  if (axis === 'horizontal') {
    return { ...inside, x: box.width - (inside.x + inside.width) };
  }
  return { ...inside, y: box.height - (inside.y + inside.height) };
}

/**
 * The ratio buttons a cropper offers. `null` is freeform — no constraint.
 *
 * Kept short on purpose. These are the ones with names people use; anything else
 * is what the freeform option is for.
 */
export const CROP_RATIOS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: 'Freeform', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
  { label: '2:3', value: 2 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '21:9', value: 21 / 9 },
  { label: '5:4', value: 5 / 4 },
];

/**
 * One sentence describing the current selection, for the live readout under a
 * cropper: `1080 × 1080 px (1:1), 28% of the original`.
 *
 * The share of the original is the part people actually want, because it answers
 * "am I throwing away most of my photo?" — and a crop under half a percent reads
 * as `<1%` rather than a misleading `0%`.
 */
export function describeCrop(rect: Rect, source: Size): string {
  const src = normaliseSize(source);
  const width = toPixel(rect.width);
  const height = toPixel(rect.height);
  const share = (width * height) / (src.width * src.height);
  const percent = share >= 0.005 ? `${Math.round(share * 100)}%` : '<1%';
  const { label } = aspectRatio({ width, height });
  return `${width} × ${height} px (${label}), ${percent} of the original`;
}

/**
 * Grow a rectangle out to a ratio, keeping its centre, without leaving the
 * picture.
 *
 * Growing rather than trimming is the point: this runs when someone picks a ratio
 * button with a selection already made, and taking away part of what they had
 * chosen would feel like the tool overruling them. The short side is extended, and
 * only if the picture has no room does the result come back smaller.
 */
export function expandToRatio(rect: Rect, ratio: number, bounds: Size): Rect {
  const box = normaliseSize(bounds);
  const inside = clampRect(rect, box);
  const wanted = Number.isFinite(ratio) && ratio > 0 ? ratio : inside.width / inside.height;

  const tooNarrow = inside.width / inside.height < wanted;
  const width = tooNarrow ? inside.height * wanted : inside.width;
  const range = extentRange(wanted, box, 1);
  const extent = clamp(wanted >= 1 ? width / wanted : width, range.low, range.high);
  const size = lockedSize(extent, wanted);

  return clampRect(
    {
      x: toOffset(inside.x + (inside.width - size.width) / 2),
      y: toOffset(inside.y + (inside.height - size.height) / 2),
      width: size.width,
      height: size.height,
    },
    box,
  );
}
