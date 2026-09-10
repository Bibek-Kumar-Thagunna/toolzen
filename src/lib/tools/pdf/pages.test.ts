import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_SIZES,
  describePage,
  inToPt,
  mmToPt,
  placeImage,
  resolvePageSize,
} from './pages.ts';

/** Points, compared to a ten-thousandth. Anything tighter is comparing float noise. */
function close(actual: number, expected: number, what: string): void {
  closeTo(actual, expected, 1e-4, what);
}

function closeTo(actual: number, expected: number, tolerance: number, what: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected}, got ${actual} (off by ${actual - expected})`,
  );
}

const A4 = PAGE_SIZES.a4;

test('the named page sizes are the real ones, to three decimal places', () => {
  assert.deepEqual(PAGE_SIZES.a4, { width: 595.276, height: 841.89 });
  assert.deepEqual(PAGE_SIZES.a3, { width: 841.89, height: 1190.551 });
  assert.deepEqual(PAGE_SIZES.a5, { width: 419.528, height: 595.276 });
  assert.deepEqual(PAGE_SIZES.letter, { width: 612, height: 792 });
  assert.deepEqual(PAGE_SIZES.legal, { width: 612, height: 1008 });
  assert.deepEqual(PAGE_SIZES.tabloid, { width: 792, height: 1224 });

  // Cross-check against the definitions rather than against the same numbers
  // typed twice: the A series is millimetres, the US sizes are whole inches. The
  // stored values are those conversions rounded to three decimal places, so
  // three decimal places is the tolerance.
  closeTo(mmToPt(210), A4.width, 0.001, 'A4 width from 210 mm');
  closeTo(mmToPt(297), A4.height, 0.001, 'A4 height from 297 mm');
  closeTo(mmToPt(148), PAGE_SIZES.a5.width, 0.001, 'A5 width from 148 mm');
  closeTo(mmToPt(420), PAGE_SIZES.a3.height, 0.001, 'A3 height from 420 mm');
  assert.equal(inToPt(8.5), PAGE_SIZES.letter.width);
  assert.equal(inToPt(11), PAGE_SIZES.letter.height);
  assert.equal(inToPt(14), PAGE_SIZES.legal.height);
  assert.equal(inToPt(17), PAGE_SIZES.tabloid.height);
  assert.equal(mmToPt(25.4), 72, 'an inch is 72 points');
  assert.equal(mmToPt(0), 0);
});

test('"fit" makes the page the size of the image, and the dpi is what scales it', () => {
  const at72 = resolvePageSize('fit', 'auto', { width: 640, height: 480 });
  assert.deepEqual(at72, { width: 640, height: 480 }, 'one pixel is one point at 72 dpi');

  const at300 = resolvePageSize('fit', 'auto', { width: 640, height: 480, dpi: 300 });
  close(at300.width, 153.6, 'width at 300 dpi');
  close(at300.height, 115.2, 'height at 300 dpi');

  // A nonsense dpi falls back to 72 rather than producing a zero-sized page.
  assert.deepEqual(resolvePageSize('fit', 'auto', { width: 10, height: 20, dpi: 0 }), {
    width: 10,
    height: 20,
  });
  assert.deepEqual(resolvePageSize('fit', 'auto', { width: 10, height: 20, dpi: Number.NaN }), {
    width: 10,
    height: 20,
  });

  // Orientation cannot apply to "fit": the page is the image, so turning it
  // could only distort the picture or add the border "fit" exists to avoid.
  const portraitRequested = resolvePageSize('fit', 'portrait', { width: 640, height: 480 });
  assert.deepEqual(portraitRequested, { width: 640, height: 480 });
});

test('orientation: explicit wins, "auto" follows the image', () => {
  assert.deepEqual(resolvePageSize('a4', 'portrait', { width: 999, height: 1 }), A4);
  assert.deepEqual(resolvePageSize('a4', 'landscape', { width: 1, height: 999 }), {
    width: A4.height,
    height: A4.width,
  });

  const landscapeImage = resolvePageSize('a4', 'auto', { width: 640, height: 480 });
  assert.deepEqual(landscapeImage, { width: 841.89, height: 595.276 }, 'a wide photo turns the page');
  assert.ok(landscapeImage.width > landscapeImage.height);

  assert.deepEqual(resolvePageSize('a4', 'auto', { width: 480, height: 640 }), A4);
  assert.deepEqual(resolvePageSize('a4', 'auto', { width: 500, height: 500 }), A4, 'square counts as portrait');
  assert.deepEqual(
    resolvePageSize('tabloid', 'landscape', { width: 1, height: 1 }),
    { width: 1224, height: 792 },
    'landscape works on a size that is portrait by default',
  );
});

test('"contain" centres the image, and y is measured up from the bottom edge', () => {
  // Worked by hand. A4 portrait is 595.276 × 841.89 pt. A 36 pt margin all round
  // leaves 523.276 × 769.89. A square image fits the narrower side, so it becomes
  // 523.276 × 523.276. The spare height is 769.89 − 523.276 = 246.614, half above
  // and half below, so the gap under the image is 36 + 123.307 = 159.307 pt.
  const placed = placeImage({ width: 100, height: 100 }, A4, { fit: 'contain', marginPt: 36 });
  close(placed.width, 523.276, 'width');
  close(placed.height, 523.276, 'height');
  close(placed.x, 36, 'x sits exactly on the margin when the image fills the width');
  close(placed.y, 159.307, 'y is the gap from the BOTTOM of the page');

  // The same number arrived at from the top proves the origin: if `y` were
  // measured downwards, the space left above the image would not match.
  close(A4.height - (placed.y + placed.height), 159.307, 'the gap above equals the gap below');
  assert.ok(placed.y > 0 && placed.y + placed.height < A4.height, 'contain never leaves the page');

  // A wide image on a portrait page is pinned by width, so it has spare height.
  const wide = placeImage({ width: 400, height: 100 }, A4, { fit: 'contain', marginPt: 0 });
  close(wide.width, 595.276, 'a wide image fills the full width');
  close(wide.height, 148.819, 'height keeps the 4:1 shape');
  close(wide.x, 0, 'no margin means no offset');
  close(wide.y, (841.89 - 148.819) / 2, 'centred vertically');
});

test('align moves the image up and down, and only up and down', () => {
  const image = { width: 100, height: 100 };
  const top = placeImage(image, A4, { fit: 'contain', marginPt: 36, align: 'top' });
  const bottom = placeImage(image, A4, { fit: 'contain', marginPt: 36, align: 'bottom' });
  const centre = placeImage(image, A4, { fit: 'contain', marginPt: 36, align: 'centre' });

  close(bottom.y, 36, 'bottom-aligned sits on the margin');
  close(top.y, 841.89 - 36 - 523.276, 'top-aligned is page height less margin less image height');
  close(top.y, 282.614, 'and that is 282.614 pt up from the bottom');
  assert.ok(top.y > centre.y && centre.y > bottom.y, 'top is higher up the page than bottom');
  close(A4.height - (top.y + top.height), 36, 'top-aligned leaves exactly the margin above');
  assert.equal(top.x, bottom.x, 'align does not touch the horizontal position');
  assert.deepEqual(centre, placeImage(image, A4, { fit: 'contain', marginPt: 36 }), 'centre is the default');
});

test('"cover" fills the page and runs off it; "actual" ignores the page entirely', () => {
  // A tall narrow image covering A4 must overflow top and bottom: the scale is
  // set by the width, 595.276 / 100 = 5.95276, which makes it 1190.552 pt tall
  // against a page of 841.89.
  const cover = placeImage({ width: 100, height: 200 }, A4, { fit: 'cover', marginPt: 0 });
  close(cover.width, 595.276, 'covers the full width');
  close(cover.height, 1190.552, 'and overshoots the height');
  assert.ok(cover.height > A4.height, 'cover is expected to overflow — the writer clips it');
  close(cover.y, (841.89 - 1190.552) / 2, 'the overflow is shared between top and bottom');
  assert.ok(cover.y < 0, 'which means y goes below the bottom edge');

  const contained = placeImage({ width: 100, height: 200 }, A4, { fit: 'contain', marginPt: 0 });
  assert.ok(contained.height <= A4.height + 1e-9, 'contain never does that');
  assert.ok(cover.width >= contained.width, 'cover is always at least as large as contain');

  const actual = placeImage({ width: 100, height: 100 }, A4, { fit: 'actual', marginPt: 0 });
  assert.deepEqual(
    { width: actual.width, height: actual.height },
    { width: 100, height: 100 },
    'one pixel, one point, whatever the page',
  );
  close(actual.x, (595.276 - 100) / 2, 'still centred');
  const huge = placeImage({ width: 4000, height: 3000 }, A4, { fit: 'actual', marginPt: 0 });
  assert.ok(huge.width > A4.width, 'a camera photo at actual size is far wider than the sheet');
});

test('a silly margin is capped instead of squeezing the image out of existence', () => {
  // The cap is 40% of the shorter side: 595.276 × 0.4 = 238.1104 pt.
  const capped = placeImage({ width: 100, height: 100 }, A4, { fit: 'contain', marginPt: 10000 });
  close(capped.x, 238.1104, 'the margin used is the cap, not the 10000 asked for');
  close(capped.width, 595.276 - 238.1104 * 2, 'which still leaves a fifth of the width');
  assert.ok(capped.width > 0 && capped.height > 0, 'the image never vanishes');

  const negative = placeImage({ width: 100, height: 100 }, A4, { fit: 'contain', marginPt: -50 });
  assert.deepEqual(negative, placeImage({ width: 100, height: 100 }, A4, { fit: 'contain', marginPt: 0 }));

  const notANumber = placeImage({ width: 100, height: 100 }, A4, { fit: 'contain', marginPt: Number.NaN });
  assert.ok(Number.isFinite(notANumber.x) && Number.isFinite(notANumber.y), 'no NaN escapes into the PDF');

  // A zero-sized image would make every scale infinite; the placement stays finite
  // so the writer can report it rather than emitting broken numbers.
  const empty = placeImage({ width: 0, height: 0 }, A4, { fit: 'contain', marginPt: 0 });
  assert.ok(Number.isFinite(empty.width) && Number.isFinite(empty.height));
});

test('describePage names the standard sheets and always gives the numbers', () => {
  assert.equal(describePage(A4), 'A4 portrait — 595.3 × 841.9 pt (210 × 297 mm)');
  assert.equal(
    describePage({ width: A4.height, height: A4.width }),
    'A4 landscape — 841.9 × 595.3 pt (297 × 210 mm)',
  );
  assert.equal(describePage(PAGE_SIZES.letter), 'Letter portrait — 612 × 792 pt (215.9 × 279.4 mm)');
  assert.equal(describePage({ width: 640, height: 480 }), 'Custom landscape — 640 × 480 pt (225.8 × 169.3 mm)');
  assert.equal(describePage({ width: 300, height: 300 }), 'Custom square — 300 × 300 pt (105.8 × 105.8 mm)');
  // Rounded-off A4, as another tool might have written it, still reads as A4.
  assert.match(describePage({ width: 595, height: 842 }), /^A4 portrait/);
});
