/**
 * Pure size arithmetic for the image tools: fitting a picture into a box,
 * scaling by percent / width / height / megapixels, naming an aspect ratio, and
 * refusing sizes a browser canvas cannot survive.
 *
 * Nothing here touches `document`, `canvas`, `Image`, `fetch` or the clock. The
 * browser layer asks these functions what size to draw and then draws it, which
 * is what makes every rule below testable without a DOM — and why the same
 * numbers come out of a server render, a client re-render and CI.
 *
 * Two conventions hold throughout:
 *   - Every returned dimension is a whole number of pixels, at least 1, with
 *     halves rounded up. A canvas cannot be 0 pixels wide, so scaling a 1px
 *     column to 40% still returns 1px rather than nothing at all.
 *   - Anything that can fail returns `{ ok: true, ... } | { ok: false, error }`,
 *     where `error` is a sentence written for someone who has never once
 *     thought about pixels.
 */

/** Width and height in whole pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * How a source picture is mapped onto a target box.
 *  - `contain` — fits inside the box, keeps the shape, may leave gaps.
 *  - `cover`   — fills the box, keeps the shape, spills over (a crop follows).
 *  - `fill`    — exactly the box, shape ignored, so the picture stretches.
 *  - `inside`  — `contain`, but never enlarges a picture that already fits.
 *  - `outside` — `cover`, but never shrinks a picture that already covers.
 */
export type FitMode = 'contain' | 'cover' | 'fill' | 'inside' | 'outside';

/** One dimension as a whole number of pixels, never below 1. Halves round up. */
export function toPixel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.floor(value + 0.5);
  return rounded < 1 ? 1 : rounded;
}

/**
 * Snap a size to whole pixels before any arithmetic touches it.
 *
 * Doing this on the way in is what makes the `fitWithin` promises exact: once
 * the source and the box are both integers, rounding the scaled result can never
 * push a `contain` fit past the box, nor leave a `cover` fit short of it.
 */
export function normaliseSize(size: Size): Size {
  return { width: toPixel(size.width), height: toPixel(size.height) };
}

/**
 * The ceiling a browser canvas is trusted up to.
 *
 * Desktop Chrome goes far higher, but mobile Safari hands back a *blank* canvas
 * past roughly these numbers instead of throwing, so a picture that "worked on
 * my laptop" becomes a white rectangle on a phone with no error to catch. 16384
 * pixels per side, and a quarter of the square that implies (~67 megapixels), is
 * the conservative pair that has held up across iOS versions.
 */
export const CANVAS_LIMITS: { maxDimension: number; maxPixels: number; note: string } = {
  maxDimension: 16384,
  maxPixels: (16384 * 16384) / 4,
  note:
    'Conservative ceilings that also hold on mobile Safari, where an oversized ' +
    'canvas comes back blank rather than failing loudly: 16384 pixels per side, ' +
    'and about 67 megapixels in total.',
};

/**
 * Map `source` onto `box` according to `mode`.
 *
 * The four guarantees the tests hold this to, all of them exact rather than
 * approximate because both sides are snapped to whole pixels first:
 *   - `contain` never exceeds the box in either direction.
 *   - `cover` never falls short of the box in either direction.
 *   - `inside` never returns anything larger than the source.
 *   - `outside` never returns anything smaller than the source.
 */
export function fitWithin(source: Size, box: Size, mode: FitMode): Size {
  const src = normaliseSize(source);
  const target = normaliseSize(box);
  if (mode === 'fill') return target;

  const byWidth = target.width / src.width;
  const byHeight = target.height / src.height;
  let scale: number;
  switch (mode) {
    case 'cover':
      scale = Math.max(byWidth, byHeight);
      break;
    case 'inside':
      scale = Math.min(1, byWidth, byHeight);
      break;
    case 'outside':
      scale = Math.max(1, byWidth, byHeight);
      break;
    default:
      scale = Math.min(byWidth, byHeight);
      break;
  }
  return { width: toPixel(src.width * scale), height: toPixel(src.height * scale) };
}

/**
 * Scale by a percentage, where 100 means unchanged.
 *
 * A percentage of zero or less, or anything non-numeric, yields a 1×1 pixel
 * result rather than an error: this sits behind a slider, and a slider that
 * throws is worse than a slider that bottoms out.
 */
export function scaleByPercent(source: Size, percent: number): Size {
  const src = normaliseSize(source);
  const factor = Number.isFinite(percent) && percent > 0 ? percent / 100 : 0;
  return { width: toPixel(src.width * factor), height: toPixel(src.height * factor) };
}

/** Set the width; the height follows from the original shape. */
export function scaleToWidth(source: Size, width: number): Size {
  const src = normaliseSize(source);
  const target = toPixel(width);
  return { width: target, height: toPixel((src.height * target) / src.width) };
}

/** Set the height; the width follows from the original shape. */
export function scaleToHeight(source: Size, height: number): Size {
  const src = normaliseSize(source);
  const target = toPixel(height);
  return { width: toPixel((src.width * target) / src.height), height: target };
}

/**
 * Set whichever side is longer to `edge`.
 *
 * This is the control that makes sense for a mixed batch of portrait and
 * landscape photos: "nothing wider or taller than 2000px" is one number, whereas
 * a fixed width would leave the portraits enormous.
 */
export function scaleToLongestEdge(source: Size, edge: number): Size {
  const src = normaliseSize(source);
  return src.width >= src.height ? scaleToWidth(src, edge) : scaleToHeight(src, edge);
}

/**
 * Scale to a total pixel count, expressed in megapixels, keeping the shape.
 *
 * "Under 2 megapixels" is how upload limits are usually written, and it is not
 * the same question as a width. The naive `sqrt(target / current)` scale lands
 * off target once both sides are rounded to integers, so each axis is tried as
 * the driving one and nudged a few pixels either way; the pair whose pixel count
 * is closest wins. For ordinary photographic shapes that lands inside 1% of the
 * request. A freakish shape — a 10 × 100000 strip — cannot: one pixel of width
 * there is 100000 pixels of area, and integers are all we have.
 */
export function scaleToMegapixels(source: Size, megapixels: number): Size {
  const src = normaliseSize(source);
  const wanted = Number.isFinite(megapixels) ? megapixels * 1_000_000 : 0;
  const target = Math.max(1, wanted);
  const scale = Math.sqrt(target / (src.width * src.height));
  const idealWidth = toPixel(src.width * scale);
  const idealHeight = toPixel(src.height * scale);

  let best: Size = { width: idealWidth, height: idealHeight };
  let bestError = Number.POSITIVE_INFINITY;
  for (let nudge = -3; nudge <= 3; nudge += 1) {
    const candidates = [
      scaleToWidth(src, idealWidth + nudge),
      scaleToHeight(src, idealHeight + nudge),
    ];
    for (const candidate of candidates) {
      const error = Math.abs(candidate.width * candidate.height - target);
      if (error < bestError) {
        best = candidate;
        bestError = error;
      }
    }
  }
  return best;
}

/**
 * The ratios people have a name for.
 *
 * Checked before the plain whole-number reduction, because a 2560 × 1600 screen
 * is universally called 16:10 even though the smallest reduction of those two
 * numbers is 8:5. Nobody says 8:5.
 *
 * Portrait ultrawide (9:21) is deliberately absent. It is the same value as 3:7,
 * so including it would relabel a literal 3 × 7 pixel image as "9:21", and no
 * one describes a tall sliver that way.
 */
const NAMED_RATIOS: ReadonlyArray<{ w: number; h: number; label: string }> = [
  { w: 1, h: 1, label: '1:1' },
  { w: 5, h: 4, label: '5:4' },
  { w: 4, h: 5, label: '4:5' },
  { w: 4, h: 3, label: '4:3' },
  { w: 3, h: 4, label: '3:4' },
  { w: 3, h: 2, label: '3:2' },
  { w: 2, h: 3, label: '2:3' },
  { w: 16, h: 10, label: '16:10' },
  { w: 10, h: 16, label: '10:16' },
  { w: 16, h: 9, label: '16:9' },
  { w: 9, h: 16, label: '9:16' },
  { w: 21, h: 9, label: '21:9' },
  { w: 2, h: 1, label: '2:1' },
  { w: 1, h: 2, label: '1:2' },
];

/** How close to a named ratio still counts as that ratio, with a `≈` in front. */
const NEAR_MISS = 0.005;

/** Largest whole number dividing both. Plain Euclid; both arguments are ≥ 1. */
function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * The width ÷ height value, plus the label to print next to it.
 *
 * The label is decided in four steps, in this order:
 *   1. An exact named ratio wins: 1920×1080 is "16:9", 2560×1600 is "16:10".
 *      Matched by cross-multiplying integers, so no float ever decides equality.
 *   2. Otherwise reduce by the greatest common divisor and use that when both
 *      halves are 50 or less: 3×7 stays "3:7".
 *   3. Otherwise, if the value is within 0.5% of a named ratio, say so with a
 *      leading `≈`. This is the common case in practice — a phone camera gives
 *      exactly 4:3 at 4032×3024, but the moment someone crops by hand they get
 *      1000×999, and "≈1:1" is the truthful and useful thing to show.
 *   4. Otherwise fall back to a decimal, "1.76:1".
 */
export function aspectRatio(size: Size): { ratio: number; label: string } {
  const src = normaliseSize(size);
  const ratio = src.width / src.height;

  for (const named of NAMED_RATIOS) {
    if (src.width * named.h === src.height * named.w) return { ratio, label: named.label };
  }

  const divisor = greatestCommonDivisor(src.width, src.height);
  const reducedWidth = src.width / divisor;
  const reducedHeight = src.height / divisor;
  if (reducedWidth <= 50 && reducedHeight <= 50) {
    return { ratio, label: `${reducedWidth}:${reducedHeight}` };
  }

  for (const named of NAMED_RATIOS) {
    const value = named.w / named.h;
    if (Math.abs(ratio - value) / value <= NEAR_MISS) return { ratio, label: `≈${named.label}` };
  }

  return { ratio, label: `${ratio.toFixed(2)}:1` };
}

/**
 * Bring a size down under the pixel budget and the per-side limit, keeping the
 * shape, and say whether anything had to give.
 *
 * This is the function that stops a 20000 × 20000 PNG from killing a phone tab.
 * Decoding one is survivable; allocating a canvas for it is not, and the failure
 * mode is the whole tab going away rather than an exception we could report. So
 * the picture is quietly reduced to something drawable and the caller is told,
 * which is the difference between a tool that works on the phone in your pocket
 * and one that only works on the machine it was written on.
 *
 * Every intermediate size is derived from the original width, never from the
 * previous step, so repeated rounding cannot let the shape drift.
 */
export function clampToMaxPixels(
  size: Size,
  maxPixels: number = CANVAS_LIMITS.maxPixels,
): { size: Size; clamped: boolean } {
  const src = normaliseSize(size);
  const budget =
    Number.isFinite(maxPixels) && maxPixels >= 1 ? Math.floor(maxPixels) : CANVAS_LIMITS.maxPixels;

  let out = src;
  if (out.width > CANVAS_LIMITS.maxDimension || out.height > CANVAS_LIMITS.maxDimension) {
    const side = CANVAS_LIMITS.maxDimension;
    out = fitWithin(src, { width: side, height: side }, 'inside');
  }
  // Each pass either lands under the budget or strictly narrows the candidate, so
  // this terminates; in practice it settles in two or three passes.
  while (out.width * out.height > budget && out.width > 1) {
    const factor = Math.sqrt(budget / (out.width * out.height));
    const proposed = Math.min(out.width - 1, toPixel(out.width * factor));
    out = scaleToWidth(src, Math.max(1, proposed));
    if (out.width === 1 && out.height === 1) break;
  }
  return { size: out, clamped: out.width !== src.width || out.height !== src.height };
}

/**
 * The chain of sizes a large downscale should be drawn through, in order,
 * finishing exactly on `target`.
 *
 * This exists because a single large `drawImage` downscale aliases badly. Going
 * from 4000px straight to 400px samples roughly one source pixel in ten and
 * discards the rest, so hair, brickwork and text turn into shimmer and jaggies.
 * Halving repeatedly averages every pixel on the way down, and that multi-pass
 * chain is the whole reason the output looks sharp instead of cheap.
 *
 * Each returned size is at most twice the next, which is the point: a 2×
 * reduction is the largest step the browser's own filtering handles cleanly.
 * When the target is already at least half the source there is nothing to gain,
 * so the answer is `[target]` and the caller draws once.
 */
export function resizeSteps(source: Size, target: Size): Size[] {
  const src = normaliseSize(source);
  const end = normaliseSize(target);
  const steps: Size[] = [];

  let current = src;
  while (current.width > end.width * 2 || current.height > end.height * 2) {
    current = {
      width: Math.max(end.width, toPixel(current.width / 2)),
      height: Math.max(end.height, toPixel(current.height / 2)),
    };
    steps.push(current);
  }

  const last = steps[steps.length - 1];
  if (!last || last.width !== end.width || last.height !== end.height) steps.push(end);
  return steps;
}

/**
 * Check a requested output size before anything is drawn, and say plainly what
 * is wrong when something is.
 *
 * Rejects fractional pixels, zero, negatives, and anything past the canvas
 * limits. With `lockAspect` the shape of the original is kept: a missing side is
 * worked out from it, and a pair that would distort the picture is pulled back to
 * the largest matching size that fits, with a warning saying so.
 *
 * `allowUpscale` defaults to true and only warns. Set it to false and an
 * enlargement is refused outright, because enlarging cannot add detail that was
 * never captured. That is honesty about what the tool can do, not a limitation of
 * it — every "AI upscale" is a guess, and this tool does not guess.
 */
export function validateTarget(
  source: Size,
  target: Partial<Size>,
  opts: { lockAspect?: boolean; allowUpscale?: boolean } = {},
): { ok: true; size: Size; warnings: string[] } | { ok: false; error: string } {
  const src = normaliseSize(source);
  const lockAspect = opts.lockAspect ?? false;
  const allowUpscale = opts.allowUpscale ?? true;
  const warnings: string[] = [];

  const wantWidth = target.width;
  const wantHeight = target.height;
  if (wantWidth === undefined && wantHeight === undefined) {
    return { ok: false, error: 'Enter a width or a height so we know what size you want.' };
  }

  const fields = [
    ['width', wantWidth],
    ['height', wantHeight],
  ] as const;
  for (const [name, value] of fields) {
    if (value === undefined) continue;
    if (!Number.isFinite(value)) return { ok: false, error: `The ${name} needs to be a number.` };
    if (!Number.isInteger(value)) {
      return { ok: false, error: `The ${name} has to be a whole number of pixels, and ${value} is not.` };
    }
    if (value <= 0) return { ok: false, error: `The ${name} has to be at least 1 pixel.` };
    if (value > CANVAS_LIMITS.maxDimension) {
      return {
        ok: false,
        error: `The ${name} cannot be more than ${CANVAS_LIMITS.maxDimension} pixels — past that, browsers on some phones hand back a blank picture.`,
      };
    }
  }

  let size: Size;
  if (wantWidth !== undefined && wantHeight !== undefined) {
    size = { width: wantWidth, height: wantHeight };
    if (lockAspect) {
      const kept = fitWithin(src, size, 'contain');
      if (kept.width !== size.width || kept.height !== size.height) {
        warnings.push(
          `Kept the original shape, so the result is ${kept.width} × ${kept.height} pixels rather than ${size.width} × ${size.height}.`,
        );
      }
      size = kept;
    } else {
      const before = src.width / src.height;
      const after = size.width / size.height;
      if (Math.abs(after - before) / before > 0.01) {
        warnings.push('This changes the shape of the picture, so it will look stretched.');
      }
    }
  } else if (wantWidth !== undefined) {
    size = scaleToWidth(src, wantWidth);
  } else if (wantHeight !== undefined) {
    size = scaleToHeight(src, wantHeight);
  } else {
    return { ok: false, error: 'Enter a width or a height so we know what size you want.' };
  }

  // A side worked out from the original shape can overshoot even when the number
  // that was typed did not: 100 × 10000 asked for 16384 wide is 1.6 million tall.
  if (size.width > CANVAS_LIMITS.maxDimension || size.height > CANVAS_LIMITS.maxDimension) {
    return {
      ok: false,
      error: `Keeping the original shape at that size works out to ${size.width} × ${size.height} pixels, which is past the ${CANVAS_LIMITS.maxDimension} pixel limit a browser can draw.`,
    };
  }
  if (size.width * size.height > CANVAS_LIMITS.maxPixels) {
    const asked = ((size.width * size.height) / 1_000_000).toFixed(1);
    const limit = (CANVAS_LIMITS.maxPixels / 1_000_000).toFixed(0);
    return {
      ok: false,
      error: `That works out to ${asked} megapixels. Anything over about ${limit} megapixels can come back blank on a phone, so please pick a smaller size.`,
    };
  }

  const enlarging = size.width > src.width || size.height > src.height;
  if (enlarging && !allowUpscale) {
    return {
      ok: false,
      error: `The original is only ${src.width} × ${src.height} pixels. Making it ${size.width} × ${size.height} cannot add detail that was never captured, so it would only look blurry.`,
    };
  }
  if (enlarging) {
    warnings.push(
      `This is larger than the original ${src.width} × ${src.height} pixels, so it will look softer — enlarging cannot add detail that was never captured.`,
    );
  }
  return { ok: true, size, warnings };
}

/**
 * Sizes worth offering as one click, grouped the way a person would look for
 * them. `group` + `name` is unique, which is what lets a UI use it as a key.
 *
 * Deliberately not exhaustive. Every entry here is a size someone actually has to
 * hit — an upload that gets rejected, or a banner that gets cropped by the site
 * it is posted to — rather than every size a platform has ever documented.
 */
export const PRESETS: ReadonlyArray<{ group: string; name: string; size: Size; note?: string }> = [
  // Social. The ones that get silently cropped if you guess.
  { group: 'social', name: 'Instagram square', size: { width: 1080, height: 1080 } },
  { group: 'social', name: 'Instagram portrait', size: { width: 1080, height: 1350 }, note: 'Takes the most space in the feed.' },
  { group: 'social', name: 'Instagram story', size: { width: 1080, height: 1920 } },
  { group: 'social', name: 'X header', size: { width: 1500, height: 500 } },
  { group: 'social', name: 'Facebook cover', size: { width: 1200, height: 630 } },
  { group: 'social', name: 'LinkedIn banner', size: { width: 1584, height: 396 } },
  { group: 'social', name: 'YouTube thumbnail', size: { width: 1280, height: 720 } },
  { group: 'social', name: 'Open Graph image', size: { width: 1200, height: 630 }, note: 'The picture shown when a link is pasted into a chat.' },

  // Screens.
  { group: 'screens', name: '720p', size: { width: 1280, height: 720 } },
  { group: 'screens', name: '1080p', size: { width: 1920, height: 1080 } },
  { group: 'screens', name: '1440p', size: { width: 2560, height: 1440 } },
  { group: 'screens', name: '4K', size: { width: 3840, height: 2160 } },
  { group: 'screens', name: 'Phone 360 wide', size: { width: 360, height: 800 } },
  { group: 'screens', name: 'Phone 390 wide', size: { width: 390, height: 844 } },
  { group: 'screens', name: 'Phone 414 wide', size: { width: 414, height: 896 } },
  { group: 'screens', name: 'Phone 430 wide', size: { width: 430, height: 932 } },

  // Favicons and app icons. Square by definition.
  { group: 'favicons', name: 'Favicon 16', size: { width: 16, height: 16 } },
  { group: 'favicons', name: 'Favicon 32', size: { width: 32, height: 32 } },
  { group: 'favicons', name: 'Favicon 48', size: { width: 48, height: 48 } },
  { group: 'favicons', name: 'Apple touch icon 180', size: { width: 180, height: 180 } },
  { group: 'favicons', name: 'Android icon 192', size: { width: 192, height: 192 } },
  { group: 'favicons', name: 'App icon 512', size: { width: 512, height: 512 } },

  // Print, at 300 dots per inch — the number a print shop assumes.
  { group: 'print', name: 'A4 at 300dpi', size: { width: 2480, height: 3508 } },
  { group: 'print', name: 'A5 at 300dpi', size: { width: 1748, height: 2480 } },
  { group: 'print', name: 'Letter at 300dpi', size: { width: 2550, height: 3300 } },
  { group: 'print', name: '4 × 6 inch at 300dpi', size: { width: 1200, height: 1800 } },
  { group: 'print', name: '5 × 7 inch at 300dpi', size: { width: 1500, height: 2100 } },
  { group: 'print', name: '8 × 10 inch at 300dpi', size: { width: 2400, height: 3000 } },
];

/**
 * A rough guess at the encoded file size, in bytes.
 *
 * Read this as an estimate and nothing more. It exists to set expectations before
 * anything is encoded — "this will be about 400 KB" next to a quality slider —
 * and the real number comes from the encoder, which is the only thing that knows.
 * The gap can be large in either direction: at identical size and quality, a
 * photograph of gravel and a photograph of a clear sky differ several-fold,
 * because JPEG spends its bytes on detail and a flat sky has almost none. As soon
 * as a real blob exists, show its actual byte length and forget this number.
 *
 * The model is bytes per pixel. JPEG climbs steeply with quality, WebP lands
 * around 30% below JPEG for a similar look, and PNG ignores quality entirely
 * because it is lossless — it pays for pixels, not for detail.
 *
 * `quality` is accepted either as 0–1 or as 0–100, since both conventions are in
 * circulation and mixing them up would otherwise be a silent 100× error.
 */
export function estimateOutputBytes(
  size: Size,
  format: 'jpeg' | 'png' | 'webp',
  quality: number = 0.8,
): number {
  const src = normaliseSize(size);
  const pixels = src.width * src.height;
  const raw = Number.isFinite(quality) ? quality : 0.8;
  const q = Math.min(1, Math.max(0.01, raw > 1 ? raw / 100 : raw));

  if (format === 'png') return Math.max(1, Math.round(pixels * 3 + 1024));
  const jpegBytesPerPixel = 0.06 + 0.62 * q ** 2.5;
  const bytesPerPixel = format === 'webp' ? jpegBytesPerPixel * 0.7 : jpegBytesPerPixel;
  return Math.max(1, Math.round(pixels * bytesPerPixel + 600));
}
