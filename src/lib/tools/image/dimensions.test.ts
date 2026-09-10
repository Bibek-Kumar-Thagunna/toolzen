import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANVAS_LIMITS,
  PRESETS,
  aspectRatio,
  clampToMaxPixels,
  estimateOutputBytes,
  fitWithin,
  resizeSteps,
  scaleByPercent,
  scaleToHeight,
  scaleToLongestEdge,
  scaleToMegapixels,
  scaleToWidth,
  validateTarget,
} from './dimensions.ts';
import type { FitMode, Size } from './dimensions.ts';

const MODES: FitMode[] = ['contain', 'cover', 'fill', 'inside', 'outside'];

const BOX: Size = { width: 800, height: 600 };
const WIDER: Size = { width: 4000, height: 1000 };
const TALLER: Size = { width: 1000, height: 4000 };
const SMALL: Size = { width: 200, height: 100 };

function label(size: Size): string {
  return `${size.width}x${size.height}`;
}

test('aspectRatio: the labels a person recognises', () => {
  assert.equal(aspectRatio({ width: 1920, height: 1080 }).label, '16:9');
  assert.equal(aspectRatio({ width: 2560, height: 1600 }).label, '16:10', 'nobody says 8:5');
  assert.equal(aspectRatio({ width: 4032, height: 3024 }).label, '4:3');
  assert.equal(aspectRatio({ width: 1000, height: 999 }).label, '≈1:1', 'a hand crop, near enough');
  assert.equal(aspectRatio({ width: 1, height: 1 }).label, '1:1');
  assert.equal(aspectRatio({ width: 3, height: 7 }).label, '3:7');
  assert.equal(aspectRatio({ width: 1000, height: 567 }).label, '1.76:1', 'too far off to name');
  assert.equal(aspectRatio({ width: 1920, height: 1080 }).ratio, 16 / 9);
  assert.equal(aspectRatio({ width: 1080, height: 1920 }).label, '9:16');
});

test('fitWithin: all five modes on a source wider than the box', () => {
  assert.deepEqual(fitWithin(WIDER, BOX, 'contain'), { width: 800, height: 200 });
  assert.deepEqual(fitWithin(WIDER, BOX, 'cover'), { width: 2400, height: 600 });
  assert.deepEqual(fitWithin(WIDER, BOX, 'fill'), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(WIDER, BOX, 'inside'), { width: 800, height: 200 });
  assert.deepEqual(fitWithin(WIDER, BOX, 'outside'), WIDER, 'already covers, so left alone');
});

test('fitWithin: all five modes on a source taller than the box', () => {
  assert.deepEqual(fitWithin(TALLER, BOX, 'contain'), { width: 150, height: 600 });
  assert.deepEqual(fitWithin(TALLER, BOX, 'cover'), { width: 800, height: 3200 });
  assert.deepEqual(fitWithin(TALLER, BOX, 'fill'), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(TALLER, BOX, 'inside'), { width: 150, height: 600 });
  assert.deepEqual(fitWithin(TALLER, BOX, 'outside'), TALLER);
});

test('fitWithin: a source smaller than the box', () => {
  assert.deepEqual(fitWithin(SMALL, BOX, 'contain'), { width: 800, height: 400 });
  assert.deepEqual(fitWithin(SMALL, BOX, 'cover'), { width: 1200, height: 600 });
  assert.deepEqual(fitWithin(SMALL, BOX, 'inside'), SMALL, 'inside never enlarges');
  assert.deepEqual(fitWithin(SMALL, BOX, 'outside'), { width: 1200, height: 600 });
});

test('fitWithin: the four promises hold for every source and box', () => {
  const sources: Size[] = [WIDER, TALLER, SMALL, { width: 100, height: 200 }, BOX, { width: 1, height: 1 }, { width: 3, height: 7 }, { width: 4032, height: 3024 }];
  const boxes: Size[] = [BOX, { width: 100, height: 100 }, { width: 1920, height: 1080 }, { width: 16, height: 16 }, { width: 1, height: 1 }];
  for (const source of sources) {
    for (const box of boxes) {
      const where = `${label(source)} into ${label(box)}`;
      const contain = fitWithin(source, box, 'contain');
      assert.ok(contain.width <= box.width && contain.height <= box.height, `contain escaped the box: ${where}`);
      const cover = fitWithin(source, box, 'cover');
      assert.ok(cover.width >= box.width && cover.height >= box.height, `cover fell short: ${where}`);
      const inside = fitWithin(source, box, 'inside');
      assert.ok(inside.width <= source.width && inside.height <= source.height, `inside upscaled: ${where}`);
      const outside = fitWithin(source, box, 'outside');
      assert.ok(outside.width >= source.width && outside.height >= source.height, `outside downscaled: ${where}`);
      assert.deepEqual(fitWithin(source, box, 'fill'), box, `fill must be the box: ${where}`);
      for (const mode of MODES) {
        const out = fitWithin(source, box, mode);
        assert.ok(Number.isInteger(out.width) && out.width >= 1, `${mode} width ${out.width}: ${where}`);
        assert.ok(Number.isInteger(out.height) && out.height >= 1, `${mode} height ${out.height}: ${where}`);
      }
    }
  }
});

test('the scale helpers keep the shape, round halves up, and never return zero', () => {
  assert.deepEqual(scaleByPercent({ width: 4000, height: 3000 }, 50), { width: 2000, height: 1500 });
  assert.deepEqual(scaleByPercent({ width: 4000, height: 3000 }, 100), { width: 4000, height: 3000 });
  assert.deepEqual(scaleByPercent({ width: 3, height: 3 }, 10), { width: 1, height: 1 }, 'never 0');
  assert.deepEqual(scaleByPercent({ width: 100, height: 100 }, 0), { width: 1, height: 1 });
  assert.deepEqual(scaleToWidth({ width: 1920, height: 1080 }, 800), { width: 800, height: 450 });
  assert.deepEqual(scaleToWidth({ width: 2, height: 3 }, 1), { width: 1, height: 2 }, '1.5 rounds up');
  assert.deepEqual(scaleToHeight({ width: 1920, height: 1080 }, 540), { width: 960, height: 540 });
  assert.deepEqual(scaleToLongestEdge({ width: 4000, height: 3000 }, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(scaleToLongestEdge({ width: 3000, height: 4000 }, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(scaleToLongestEdge({ width: 1000, height: 1000 }, 100), { width: 100, height: 100 });
});

test('scaleToMegapixels: lands within 1% of the target for 12 varied sources', () => {
  const sources: Size[] = [
    { width: 4032, height: 3024 },
    { width: 6000, height: 4000 },
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
    { width: 5000, height: 5000 },
    { width: 3000, height: 2000 },
    { width: 2560, height: 1440 },
    { width: 800, height: 600 },
    { width: 7680, height: 4320 },
    { width: 1500, height: 500 },
    { width: 640, height: 480 },
    { width: 1234, height: 987 },
  ];
  assert.equal(sources.length, 12);
  for (const source of sources) {
    const shape = source.width / source.height;
    for (const megapixels of [0.3, 0.5, 1, 2, 8, 12]) {
      const out = scaleToMegapixels(source, megapixels);
      const target = megapixels * 1_000_000;
      const off = Math.abs(out.width * out.height - target) / target;
      assert.ok(off <= 0.01, `${label(source)} -> ${megapixels}MP gave ${label(out)}, ${(off * 100).toFixed(2)}% off`);
      const drift = Math.abs(out.width / out.height - shape) / shape;
      assert.ok(drift <= 0.01, `${label(source)} -> ${megapixels}MP changed the shape by ${(drift * 100).toFixed(2)}%`);
      assert.ok(Number.isInteger(out.width) && Number.isInteger(out.height) && out.width >= 1 && out.height >= 1);
    }
  }
});

test('resizeSteps: every hop is at most a halving, and the last is exactly the target', () => {
  const cases: Array<[Size, Size]> = [
    [{ width: 4000, height: 3000 }, { width: 400, height: 300 }],
    [{ width: 6000, height: 4000 }, { width: 200, height: 133 }],
    [{ width: 1920, height: 1080 }, { width: 16, height: 9 }],
    [{ width: 4032, height: 3024 }, { width: 1, height: 1 }],
    [{ width: 5, height: 5 }, { width: 1, height: 1 }],
    [{ width: 1000, height: 20 }, { width: 100, height: 20 }],
    [{ width: 1500, height: 500 }, { width: 1499, height: 499 }],
  ];
  for (const [source, target] of cases) {
    const steps = resizeSteps(source, target);
    assert.ok(steps.length >= 1, `${label(source)} -> ${label(target)} returned nothing`);
    const chain = [source, ...steps];
    for (let i = 1; i < chain.length; i += 1) {
      const from = chain[i - 1];
      const to = chain[i];
      const hop = `${label(from)} -> ${label(to)}`;
      assert.ok(to.width <= from.width && to.height <= from.height, `a downscale grew: ${hop}`);
      assert.ok(from.width <= to.width * 2, `width hop bigger than 2x: ${hop}`);
      assert.ok(from.height <= to.height * 2, `height hop bigger than 2x: ${hop}`);
      assert.ok(Number.isInteger(to.width) && to.width >= 1 && Number.isInteger(to.height) && to.height >= 1, hop);
    }
    assert.deepEqual(steps[steps.length - 1], target, `did not land on the target: ${label(target)}`);
  }
});

test('resizeSteps: no stepping when there is nothing to gain', () => {
  assert.deepEqual(resizeSteps({ width: 1000, height: 1000 }, { width: 600, height: 600 }), [{ width: 600, height: 600 }]);
  assert.deepEqual(resizeSteps({ width: 1000, height: 1000 }, { width: 500, height: 500 }), [{ width: 500, height: 500 }]);
  assert.deepEqual(resizeSteps({ width: 400, height: 300 }, { width: 800, height: 600 }), [{ width: 800, height: 600 }]);
  assert.deepEqual(resizeSteps({ width: 400, height: 300 }, { width: 400, height: 300 }), [{ width: 400, height: 300 }]);
  assert.equal(resizeSteps({ width: 4000, height: 3000 }, { width: 400, height: 300 }).length, 4);
});

test('clampToMaxPixels: a 20000 x 20000 PNG comes back drawable and still square', () => {
  const out = clampToMaxPixels({ width: 20000, height: 20000 });
  assert.equal(out.clamped, true);
  assert.equal(out.size.width, out.size.height, 'square in, square out');
  assert.ok(out.size.width * out.size.height <= CANVAS_LIMITS.maxPixels, 'still over the pixel budget');
  assert.ok(out.size.width <= CANVAS_LIMITS.maxDimension, 'still over the per-side limit');
  assert.deepEqual(out.size, { width: 8192, height: 8192 });
});

test('clampToMaxPixels: keeps the shape, respects a custom budget, leaves sane sizes alone', () => {
  const wide = clampToMaxPixels({ width: 30000, height: 10000 });
  assert.equal(wide.clamped, true);
  assert.ok(wide.size.width * wide.size.height <= CANVAS_LIMITS.maxPixels);
  assert.ok(wide.size.width <= CANVAS_LIMITS.maxDimension);
  assert.ok(Math.abs(wide.size.width / wide.size.height - 3) / 3 <= 0.001, `shape drifted: ${label(wide.size)}`);

  const fine = clampToMaxPixels({ width: 4032, height: 3024 });
  assert.equal(fine.clamped, false);
  assert.deepEqual(fine.size, { width: 4032, height: 3024 });

  const custom = clampToMaxPixels({ width: 4000, height: 3000 }, 1_000_000);
  assert.equal(custom.clamped, true);
  assert.ok(custom.size.width * custom.size.height <= 1_000_000, `over budget: ${label(custom.size)}`);
  assert.ok(Math.abs(custom.size.width / custom.size.height - 4 / 3) / (4 / 3) <= 0.01);
});

test('CANVAS_LIMITS are the conservative mobile-safe pair, and say why', () => {
  assert.equal(CANVAS_LIMITS.maxDimension, 16384);
  assert.equal(CANVAS_LIMITS.maxPixels, (16384 * 16384) / 4);
  assert.ok(CANVAS_LIMITS.note.length > 40, 'the note has to explain itself');
});

test('validateTarget: enlarging is refused when the caller says not to', () => {
  const source: Size = { width: 800, height: 600 };
  const refused = validateTarget(source, { width: 1600, height: 1200 }, { allowUpscale: false });
  assert.equal(refused.ok, false);
  if (refused.ok) throw new Error('unreachable');
  assert.match(refused.error, /cannot add detail/);
  assert.match(refused.error, /800 × 600/);
});

test('validateTarget: enlarging is allowed by default, with a warning that says why', () => {
  const source: Size = { width: 800, height: 600 };
  const allowed = validateTarget(source, { width: 1600, height: 1200 }, { allowUpscale: true });
  assert.equal(allowed.ok, true);
  if (!allowed.ok) throw new Error('unreachable');
  assert.deepEqual(allowed.size, { width: 1600, height: 1200 });
  assert.equal(allowed.warnings.length, 1);
  assert.match(allowed.warnings[0] ?? '', /softer/);
  const byDefault = validateTarget(source, { width: 1600, height: 1200 });
  assert.equal(byDefault.ok, true);
});

test('validateTarget: lockAspect fills in the missing side and refuses to distort', () => {
  const source: Size = { width: 1920, height: 1080 };
  const derived = validateTarget(source, { width: 960 }, { lockAspect: true });
  assert.equal(derived.ok, true);
  if (!derived.ok) throw new Error('unreachable');
  assert.deepEqual(derived.size, { width: 960, height: 540 });
  assert.deepEqual(derived.warnings, []);

  const fromHeight = validateTarget(source, { height: 270 }, { lockAspect: true });
  assert.equal(fromHeight.ok, true);
  if (!fromHeight.ok) throw new Error('unreachable');
  assert.deepEqual(fromHeight.size, { width: 480, height: 270 });

  const pulledBack = validateTarget(source, { width: 800, height: 800 }, { lockAspect: true });
  assert.equal(pulledBack.ok, true);
  if (!pulledBack.ok) throw new Error('unreachable');
  assert.deepEqual(pulledBack.size, { width: 800, height: 450 });
  assert.match(pulledBack.warnings[0] ?? '', /Kept the original shape/);

  const stretched = validateTarget(source, { width: 800, height: 800 });
  assert.equal(stretched.ok, true);
  if (!stretched.ok) throw new Error('unreachable');
  assert.deepEqual(stretched.size, { width: 800, height: 800 });
  assert.match(stretched.warnings[0] ?? '', /stretched/);
});

test('validateTarget: the numbers it refuses outright', () => {
  const source: Size = { width: 4000, height: 3000 };
  const cases: Array<[Partial<Size>, RegExp]> = [
    [{ width: 100.5 }, /whole number/],
    [{ height: 0.5 }, /whole number/],
    [{ width: 0 }, /at least 1 pixel/],
    [{ width: -10 }, /at least 1 pixel/],
    [{ height: 0 }, /at least 1 pixel/],
    [{ width: 20000 }, /cannot be more than 16384/],
    [{ height: 999999 }, /cannot be more than 16384/],
    [{ width: Number.NaN }, /needs to be a number/],
    [{}, /Enter a width or a height/],
  ];
  for (const [target, expected] of cases) {
    const out = validateTarget(source, target);
    assert.equal(out.ok, false, `expected ${JSON.stringify(target)} to be refused`);
    if (out.ok) continue;
    assert.match(out.error, expected);
  }
});

test('validateTarget: past the pixel budget, and past it only by implication', () => {
  const huge = validateTarget({ width: 16000, height: 16000 }, { width: 16000, height: 16000 });
  assert.equal(huge.ok, false);
  if (huge.ok) throw new Error('unreachable');
  assert.match(huge.error, /megapixels/);

  // The number typed is legal; the side worked out from the shape is not.
  const implied = validateTarget({ width: 100, height: 10000 }, { width: 16384 });
  assert.equal(implied.ok, false);
  if (implied.ok) throw new Error('unreachable');
  assert.match(implied.error, /past the 16384 pixel limit/);

  const ordinary = validateTarget({ width: 4032, height: 3024 }, { width: 1600, height: 1200 });
  assert.equal(ordinary.ok, true);
  if (!ordinary.ok) throw new Error('unreachable');
  assert.deepEqual(ordinary.size, { width: 1600, height: 1200 });
  assert.deepEqual(ordinary.warnings, [], 'a plain downscale has nothing to warn about');
});

test('every PRESETS entry is whole pixels, positive, and uniquely named', () => {
  const seen = new Set<string>();
  const groups = new Set<string>();
  for (const preset of PRESETS) {
    const key = `${preset.group}/${preset.name}`;
    assert.equal(seen.has(key), false, `duplicate preset: ${key}`);
    seen.add(key);
    groups.add(preset.group);
    assert.ok(preset.group.length > 0 && preset.name.length > 0, key);
    assert.ok(Number.isInteger(preset.size.width) && preset.size.width >= 1, `${key} width`);
    assert.ok(Number.isInteger(preset.size.height) && preset.size.height >= 1, `${key} height`);
    assert.ok(preset.size.width <= CANVAS_LIMITS.maxDimension, `${key} is bigger than a canvas allows`);
    assert.ok(preset.size.height <= CANVAS_LIMITS.maxDimension, `${key} is bigger than a canvas allows`);
  }
  assert.deepEqual([...groups].sort(), ['favicons', 'print', 'screens', 'social']);
  const instagram = PRESETS.find((preset) => preset.name === 'Instagram square');
  assert.deepEqual(instagram?.size, { width: 1080, height: 1080 });
  const a4 = PRESETS.find((preset) => preset.name === 'A4 at 300dpi');
  assert.deepEqual(a4?.size, { width: 2480, height: 3508 });
});

test('estimateOutputBytes: an estimate, but a monotonic and sane one', () => {
  const size: Size = { width: 1920, height: 1080 };
  const jpeg = estimateOutputBytes(size, 'jpeg', 0.8);
  const webp = estimateOutputBytes(size, 'webp', 0.8);
  const png = estimateOutputBytes(size, 'png');
  assert.ok(webp < jpeg, 'WebP should estimate smaller than JPEG at the same quality');
  assert.ok(jpeg < png, 'a lossless PNG should estimate larger than a JPEG');
  assert.ok(estimateOutputBytes(size, 'jpeg', 0.6) < jpeg, 'lower quality, fewer bytes');
  assert.ok(estimateOutputBytes(size, 'jpeg', 0.95) > jpeg, 'higher quality, more bytes');
  assert.ok(estimateOutputBytes({ width: 3840, height: 2160 }, 'jpeg', 0.8) > jpeg, 'bigger, more bytes');

  // 0-1 and 0-100 are both accepted, so a mixed-up caller is not out by 100x.
  assert.equal(estimateOutputBytes(size, 'jpeg', 80), jpeg);
  assert.equal(estimateOutputBytes(size, 'webp', 100), estimateOutputBytes(size, 'webp', 1));

  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const bytes = estimateOutputBytes({ width: 1, height: 1 }, format, 0.8);
    assert.ok(Number.isInteger(bytes) && bytes >= 1, `${format} gave ${bytes}`);
  }
  // Roughly a couple of hundred KB for a 1080p JPEG: an order of magnitude, no more.
  assert.ok(jpeg > 100_000 && jpeg < 2_000_000, `1080p JPEG estimated at ${jpeg} bytes`);
});
