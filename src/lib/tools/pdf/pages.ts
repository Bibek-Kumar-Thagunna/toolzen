/**
 * Page geometry for putting an image on a PDF page: what size the page is, and
 * where on it the picture goes.
 *
 * Everything here is in PDF points — 72 to the inch, the unit the file format
 * itself uses — and every coordinate has its **origin at the bottom-left corner
 * of the page, with y increasing upwards**. That is the opposite of a screen,
 * and quietly reusing screen thinking is the classic way to produce a PDF where
 * every image is mirrored vertically or hanging off the top edge. The tests
 * assert the bottom-left convention explicitly for that reason.
 *
 * Pure arithmetic, no dependencies, no I/O: the same numbers on a server as in
 * a browser preview, which is what makes a preview trustworthy.
 */

export interface PageSize {
  /** Points across. */
  width: number;
  /** Points down. */
  height: number;
}

export type PageSizeName = 'a4' | 'a3' | 'a5' | 'letter' | 'legal' | 'tabloid' | 'fit';

/**
 * Named page sizes, in points, at full precision.
 *
 * The ISO A series is defined in millimetres, so its point sizes are not round
 * numbers: A4 is 210 × 297 mm, which is 595.276 × 841.890 pt. Rounding those to
 * 595 × 842 is close enough to look right and wrong enough that a printer's
 * trim marks drift, so we keep the exact values. The US sizes genuinely are
 * whole inches and so genuinely are whole points.
 */
export const PAGE_SIZES: Readonly<Record<Exclude<PageSizeName, 'fit'>, PageSize>> = {
  a4: { width: 595.276, height: 841.89 },
  a3: { width: 841.89, height: 1190.551 },
  a5: { width: 419.528, height: 595.276 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
};

export type Orientation = 'portrait' | 'landscape' | 'auto';

export type ImageFit = 'contain' | 'cover' | 'actual';

export interface Placement {
  /** Points from the left edge to the image's left edge. */
  x: number;
  /** Points from the **bottom** edge to the image's bottom edge. */
  y: number;
  width: number;
  height: number;
}

/** Millimetres to points. The ISO paper sizes are defined this way. */
export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/** Inches to points, which is the definition of a point. */
export function inToPt(inches: number): number {
  return inches * 72;
}

/** A page laid out the requested way round, without distorting it. */
function orient(size: PageSize, wantLandscape: boolean): PageSize {
  const isLandscape = size.width > size.height;
  if (isLandscape === wantLandscape) return { width: size.width, height: size.height };
  return { width: size.height, height: size.width };
}

/**
 * The page a given image should go on.
 *
 * `'fit'` makes the page exactly the size of the image, which is what anyone who
 * asks for "no white borders" means. The conversion needs a resolution: at the
 * PDF default of 72 dpi one pixel becomes one point, so a 640 × 480 photo makes
 * a 640 × 480 pt page — about 226 × 169 mm, roughly A5-ish and far too big for
 * what it holds. Passing the image's real `dpi` fixes that: the same photo at
 * 300 dpi becomes a crisp 153.6 × 115.2 pt page, printed at its intended size.
 *
 * Orientation is ignored for `'fit'`, deliberately. The page *is* the image, so
 * forcing it landscape could only mean stretching the picture or leaving a
 * margin — neither of which is what "fit" asks for.
 *
 * `'auto'` follows the image: a wide photo gets a landscape page. A square image
 * counts as portrait, matching the named size's own default.
 */
export function resolvePageSize(
  name: PageSizeName,
  orientation: Orientation,
  image: { width: number; height: number; dpi?: number },
): PageSize {
  if (name === 'fit') {
    const dpi = image.dpi !== undefined && image.dpi > 0 && Number.isFinite(image.dpi) ? image.dpi : 72;
    const scale = 72 / dpi;
    return { width: image.width * scale, height: image.height * scale };
  }
  const base = PAGE_SIZES[name];
  if (orientation === 'portrait') return orient(base, false);
  if (orientation === 'landscape') return orient(base, true);
  return orient(base, image.width > image.height);
}

/**
 * A margin can never eat more than this share of the shorter side.
 *
 * Two margins at 40% leave a fifth of the page still usable, so the image never
 * collapses to nothing however silly the number handed in — a stray `10000`
 * from a form field included.
 */
const MARGIN_CAP_FRACTION = 0.4;

/**
 * Where the image sits on the page, in bottom-left-origin PDF coordinates.
 *
 * The three fits:
 * - `contain` shrinks or grows the image so all of it is inside the margins,
 *   keeping its shape. Nothing is cropped and nothing overflows.
 * - `cover` scales until the margin box is filled, so the image runs off two of
 *   the edges. The writer clips each page to its own boundary so nothing draws
 *   outside the sheet — a PDF image is not clipped by the page edge on its own.
 *   Note that clipping only hides the overflow: the whole picture is still in
 *   the file, so `cover` is a layout choice, not a way to crop privately.
 * - `actual` puts one image pixel on one PDF point regardless of the page, so a
 *   photo from a modern camera is several times wider than a sheet of A4. Also
 *   overflows, also clipped.
 *
 * `align` moves the image vertically only; horizontally it is always centred.
 * `'top'` measures down from the top edge, which in these coordinates means
 * `page.height − margin − height`, and getting that subtraction the wrong way
 * round is what puts the picture off the bottom of the page.
 */
export function placeImage(
  image: { width: number; height: number },
  page: PageSize,
  opts: { fit: ImageFit; marginPt: number; align?: 'centre' | 'top' | 'bottom' },
): Placement {
  const cap = Math.min(page.width, page.height) * MARGIN_CAP_FRACTION;
  const requested = Number.isFinite(opts.marginPt) ? opts.marginPt : 0;
  const margin = Math.min(Math.max(requested, 0), Math.max(cap, 0));

  const boxWidth = page.width - margin * 2;
  const boxHeight = page.height - margin * 2;
  // A zero-sized image would make every scale infinite or NaN; treat it as one
  // pixel so the caller gets a usable rectangle instead of poison numbers. The
  // writer rejects such images outright, which is where that belongs.
  const imageWidth = image.width > 0 && Number.isFinite(image.width) ? image.width : 1;
  const imageHeight = image.height > 0 && Number.isFinite(image.height) ? image.height : 1;

  const scaleX = boxWidth / imageWidth;
  const scaleY = boxHeight / imageHeight;
  const scale =
    opts.fit === 'actual' ? 1 : opts.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const x = margin + (boxWidth - width) / 2;
  const align = opts.align ?? 'centre';
  const y =
    align === 'bottom'
      ? margin
      : align === 'top'
        ? page.height - margin - height
        : margin + (boxHeight - height) / 2;

  return { x, y, width, height };
}

const PAGE_LABELS: Readonly<Record<Exclude<PageSizeName, 'fit'>, string>> = {
  a4: 'A4',
  a3: 'A3',
  a5: 'A5',
  letter: 'Letter',
  legal: 'Legal',
  tabloid: 'Tabloid',
};

/** Trim a measurement for display: one decimal place, and no trailing `.0`. */
function human(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Within a point either way round, which is well inside any rounding people do. */
function matchesName(page: PageSize): string | null {
  const keys = Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[];
  for (const key of keys) {
    const size = PAGE_SIZES[key];
    const same = Math.abs(page.width - size.width) <= 1 && Math.abs(page.height - size.height) <= 1;
    const turned = Math.abs(page.width - size.height) <= 1 && Math.abs(page.height - size.width) <= 1;
    if (same || turned) return PAGE_LABELS[key];
  }
  return null;
}

/**
 * The page size as a line of text for the tool page — a name when it is a
 * standard sheet, and always the numbers, in both points and millimetres,
 * because "595 × 842" means nothing to most people and "210 × 297 mm" means A4
 * to almost everyone outside the United States.
 */
export function describePage(page: PageSize): string {
  const label = matchesName(page) ?? 'Custom';
  const shape =
    page.width === page.height ? 'square' : page.width > page.height ? 'landscape' : 'portrait';
  const mmWidth = human((page.width * 25.4) / 72);
  const mmHeight = human((page.height * 25.4) / 72);
  return `${label} ${shape} — ${human(page.width)} × ${human(page.height)} pt (${mmWidth} × ${mmHeight} mm)`;
}
