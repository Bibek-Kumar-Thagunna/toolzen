import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP_RATIOS,
  centreCrop,
  clampRect,
  cropToRatio,
  describeCrop,
  expandToRatio,
  flipRect,
  rectFromPercent,
  rectToPercent,
  resizeRect,
  rotateSize,
} from './crop.ts';
import type { Handle, Rect } from './crop.ts';
import type { Size } from './dimensions.ts';

/** Deterministic PRNG, so a property failure is always reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function show(rect: Rect): string {
  return `${rect.width}x${rect.height} at ${rect.x},${rect.y}`;
}

test('clampRect: caps the size first, then the position', () => {
  const bounds: Size = { width: 1000, height: 800 };
  assert.deepEqual(clampRect({ x: 10, y: 20, width: 100, height: 50 }, bounds), { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(clampRect({ x: -50, y: -50, width: 100, height: 50 }, bounds), { x: 0, y: 0, width: 100, height: 50 });
  assert.deepEqual(clampRect({ x: 990, y: 790, width: 100, height: 50 }, bounds), { x: 900, y: 750, width: 100, height: 50 });
  assert.deepEqual(clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, bounds), { x: 0, y: 0, width: 1000, height: 800 });
  assert.deepEqual(clampRect({ x: 10.4, y: 10.6, width: 99.5, height: 0.2 }, bounds), { x: 10, y: 11, width: 100, height: 1 });
});

test('centreCrop: a 16:9 source cropped square is centred and square', () => {
  const source: Size = { width: 1920, height: 1080 };
  const square = centreCrop(source, 1);
  assert.deepEqual(square, { x: 420, y: 0, width: 1080, height: 1080 });
  assert.equal(square.width, square.height, 'not square');
  assert.equal(square.x + square.width / 2, source.width / 2, 'not centred horizontally');
  assert.equal(square.y + square.height / 2, source.height / 2, 'not centred vertically');
  assert.deepEqual(centreCrop(source, 16 / 9), { x: 0, y: 0, width: 1920, height: 1080 }, 'same shape, whole picture');
});

test('cropToRatio: every anchor, on both a landscape and a portrait source', () => {
  const landscape: Size = { width: 1920, height: 1080 };
  assert.deepEqual(cropToRatio(landscape, 1, 'centre'), { x: 420, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(landscape, 1, 'left'), { x: 0, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(landscape, 1, 'right'), { x: 840, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(landscape, 1, 'top'), { x: 420, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(landscape, 1, 'bottom'), { x: 420, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(landscape, 1), cropToRatio(landscape, 1, 'centre'), 'centre is the default');

  const portrait: Size = { width: 1080, height: 1920 };
  assert.deepEqual(cropToRatio(portrait, 1, 'centre'), { x: 0, y: 420, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(portrait, 1, 'top'), { x: 0, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(portrait, 1, 'bottom'), { x: 0, y: 840, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(portrait, 1, 'left'), { x: 0, y: 420, width: 1080, height: 1080 });
  assert.deepEqual(cropToRatio(portrait, 1, 'right'), { x: 0, y: 420, width: 1080, height: 1080 });
});

test('cropToRatio: the largest that fits, never larger, whatever the ratio', () => {
  const source: Size = { width: 1000, height: 1000 };
  for (const entry of CROP_RATIOS) {
    if (entry.value === null) continue;
    const rect = cropToRatio(source, entry.value);
    assert.ok(rect.x >= 0 && rect.y >= 0, `${entry.label}: ${show(rect)}`);
    assert.ok(rect.x + rect.width <= source.width, `${entry.label} escaped sideways: ${show(rect)}`);
    assert.ok(rect.y + rect.height <= source.height, `${entry.label} escaped downwards: ${show(rect)}`);
    const drift = Math.abs(rect.width / rect.height - entry.value) / entry.value;
    assert.ok(drift <= 0.005, `${entry.label} came out at ${show(rect)}, ${(drift * 100).toFixed(2)}% off`);
    assert.ok(
      rect.width >= source.width - 1 || rect.height >= source.height - 1,
      `${entry.label} is not the largest that fits: ${show(rect)}`,
    );
  }
  // A broken ratio falls back to the whole picture rather than throwing.
  assert.deepEqual(cropToRatio(source, Number.NaN), { x: 0, y: 0, width: 1000, height: 1000 });
  assert.deepEqual(cropToRatio(source, 0), { x: 0, y: 0, width: 1000, height: 1000 });
});

test('resizeRect: move slides the whole rectangle and stops at the edges', () => {
  const bounds: Size = { width: 1000, height: 800 };
  const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
  assert.deepEqual(resizeRect(rect, 'move', 50, 25, bounds), { x: 150, y: 125, width: 200, height: 150 });
  assert.deepEqual(resizeRect(rect, 'move', 5000, 5000, bounds), { x: 800, y: 650, width: 200, height: 150 }, 'stops, does not shrink');
  assert.deepEqual(resizeRect(rect, 'move', -5000, -5000, bounds), { x: 0, y: 0, width: 200, height: 150 });
  assert.deepEqual(resizeRect(rect, 'move', 0, 0, bounds), rect);
});

test('resizeRect: a free drag never inverts the rectangle', () => {
  const bounds: Size = { width: 1000, height: 800 };
  const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
  // The west grip dragged far past the east edge parks minSize short of it.
  assert.deepEqual(resizeRect(rect, 'w', 5000, 0, bounds), { x: 284, y: 100, width: 16, height: 150 });
  // ...and the east grip dragged far past the west edge does the mirror image.
  assert.deepEqual(resizeRect(rect, 'e', -5000, 0, bounds), { x: 100, y: 100, width: 16, height: 150 });
  assert.deepEqual(resizeRect(rect, 'n', 5000, 5000, bounds), { x: 100, y: 234, width: 200, height: 16 });
  assert.deepEqual(resizeRect(rect, 's', 0, -5000, bounds), { x: 100, y: 100, width: 200, height: 16 });
  // A custom minSize is honoured.
  assert.deepEqual(resizeRect(rect, 'w', 5000, 0, bounds, { minSize: 64 }), { x: 236, y: 100, width: 64, height: 150 });
});

test('resizeRect: a free drag never escapes the picture', () => {
  const bounds: Size = { width: 1000, height: 800 };
  const rect: Rect = { x: 100, y: 100, width: 200, height: 150 };
  assert.deepEqual(resizeRect(rect, 'se', 5000, 5000, bounds), { x: 100, y: 100, width: 900, height: 700 });
  assert.deepEqual(resizeRect(rect, 'nw', -5000, -5000, bounds), { x: 0, y: 0, width: 300, height: 250 });
  assert.deepEqual(resizeRect(rect, 'ne', 5000, -5000, bounds), { x: 100, y: 0, width: 900, height: 250 });
  assert.deepEqual(resizeRect(rect, 'sw', -5000, 5000, bounds), { x: 0, y: 100, width: 300, height: 700 });
});

test('resizeRect: a locked drag slides along the edge instead of jamming', () => {
  const bounds: Size = { width: 1000, height: 1000 };
  const corner: Rect = { x: 900, y: 0, width: 80, height: 80 };
  const grown = resizeRect(corner, 'se', 500, 500, bounds, { lockRatio: 1 });
  assert.deepEqual(grown, { x: 420, y: 0, width: 580, height: 580 }, 'kept its size and slid left');
  assert.equal(grown.width, grown.height, 'the ratio survived the slide');

  // Dragged past every edge at once, it becomes the largest 16:9 box that fits:
  // 999 × 562 rather than 1000 × 563, because holding the ratio matters more than
  // the last pixel of width.
  const wide = resizeRect({ x: 400, y: 400, width: 100, height: 56 }, 'se', 9000, 9000, bounds, { lockRatio: 16 / 9 });
  assert.deepEqual(wide, { x: 1, y: 400, width: 999, height: 562 });
  assert.ok(Math.abs(wide.width - wide.height * (16 / 9)) <= 1, `ratio drifted: ${show(wide)}`);
});

/**
 * The point of the whole module. An interactive cropper does not fail in the
 * middle of the picture; it fails when the pointer leaves the window, when the
 * ratio is locked and the selection reaches a corner, when the drag is longer than
 * the image itself. So: 2000 drags with random handles, random rectangles and
 * deltas up to three times the size of the picture, half of them ratio-locked.
 */
test('resizeRect: 2000 random drags keep every invariant', () => {
  const random = mulberry32(20260903);
  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'move'];
  const minSize = 16;
  let locks = 0;

  for (let i = 0; i < 2000; i += 1) {
    const bounds: Size = {
      width: 320 + Math.floor(random() * 3680),
      height: 320 + Math.floor(random() * 2680),
    };
    const start: Rect = {
      x: Math.floor(random() * bounds.width),
      y: Math.floor(random() * bounds.height),
      width: 1 + Math.floor(random() * bounds.width),
      height: 1 + Math.floor(random() * bounds.height),
    };
    const handle = handles[Math.floor(random() * handles.length)] ?? 'se';
    const dx = (random() * 6 - 3) * bounds.width;
    const dy = (random() * 6 - 3) * bounds.height;
    const locked = i % 2 === 0;
    const lockRatio = 0.25 + random() * 3.75;
    if (locked) locks += 1;

    const out = resizeRect(start, handle, dx, dy, bounds, locked ? { lockRatio } : {});
    const where = `#${i} ${handle}${locked ? ` @${lockRatio.toFixed(3)}` : ''} in ${bounds.width}x${bounds.height} from ${show(start)} by ${dx.toFixed(1)},${dy.toFixed(1)} -> ${show(out)}`;

    assert.ok(Number.isInteger(out.x) && Number.isInteger(out.y), `not whole pixels: ${where}`);
    assert.ok(Number.isInteger(out.width) && Number.isInteger(out.height), `not whole pixels: ${where}`);
    assert.ok(out.x >= 0 && out.y >= 0, `negative origin: ${where}`);
    assert.ok(out.width > 0 && out.height > 0, `inverted or empty: ${where}`);
    assert.ok(out.x + out.width <= bounds.width, `escaped sideways: ${where}`);
    assert.ok(out.y + out.height <= bounds.height, `escaped downwards: ${where}`);
    assert.ok(out.width >= minSize, `narrower than minSize: ${where}`);
    assert.ok(out.height >= minSize, `shorter than minSize: ${where}`);

    if (handle === 'move') {
      assert.equal(out.width, Math.min(Math.max(start.width, minSize), bounds.width), `move resized: ${where}`);
      assert.equal(out.height, Math.min(Math.max(start.height, minSize), bounds.height), `move resized: ${where}`);
    } else if (locked) {
      assert.ok(Math.abs(out.width - out.height * lockRatio) <= 1, `ratio drifted: ${where}`);
    }
  }
  assert.equal(locks, 1000, 'half the drags should have been ratio-locked');
});

test('resizeRect: bounds win when the ratio simply cannot fit', () => {
  const bounds: Size = { width: 320, height: 320 };
  const out = resizeRect({ x: 0, y: 0, width: 100, height: 100 }, 'se', 5000, 5000, bounds, { lockRatio: 400 });
  assert.ok(out.x >= 0 && out.y >= 0 && out.width >= 1 && out.height >= 1, show(out));
  assert.ok(out.x + out.width <= bounds.width, `escaped sideways: ${show(out)}`);
  assert.ok(out.y + out.height <= bounds.height, `escaped downwards: ${show(out)}`);
});

test('rectToPercent -> rectFromPercent round-trips within a pixel, 200 times', () => {
  const random = mulberry32(7);
  for (let i = 0; i < 200; i += 1) {
    const source: Size = {
      width: 64 + Math.floor(random() * 16000),
      height: 64 + Math.floor(random() * 12000),
    };
    const width = 1 + Math.floor(random() * source.width);
    const height = 1 + Math.floor(random() * source.height);
    const rect: Rect = {
      x: Math.floor(random() * (source.width - width + 1)),
      y: Math.floor(random() * (source.height - height + 1)),
      width,
      height,
    };
    const back = rectFromPercent(rectToPercent(rect, source), source);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert.ok(
        Math.abs(back[key] - rect[key]) <= 1,
        `#${i} ${key} drifted: ${show(rect)} in ${source.width}x${source.height} came back as ${show(back)}`,
      );
    }
  }
});

test('rectToPercent: readable percentages, and a rect outside the picture is pulled in first', () => {
  const source: Size = { width: 1000, height: 500 };
  assert.deepEqual(rectToPercent({ x: 250, y: 100, width: 500, height: 250 }, source), { x: 25, y: 20, width: 50, height: 50 });
  assert.deepEqual(rectFromPercent({ x: 25, y: 20, width: 50, height: 50 }, source), { x: 250, y: 100, width: 500, height: 250 });
  assert.deepEqual(rectFromPercent({ x: 0, y: 0, width: 200, height: 200 }, source), { x: 0, y: 0, width: 1000, height: 500 });
  assert.deepEqual(rectToPercent({ x: -100, y: -100, width: 5000, height: 5000 }, source), { x: 0, y: 0, width: 100, height: 100 });
});

test('rotateSize: exact on quarter turns, bounding box otherwise', () => {
  const source: Size = { width: 1920, height: 1080 };
  assert.deepEqual(rotateSize(source, 90), { width: 1080, height: 1920 });
  assert.deepEqual(rotateSize(source, 270), { width: 1080, height: 1920 });
  assert.deepEqual(rotateSize(source, -90), { width: 1080, height: 1920 });
  assert.deepEqual(rotateSize(source, 180), source);
  assert.deepEqual(rotateSize(source, 0), source);
  assert.deepEqual(rotateSize(source, 360), source);
  // (1920 + 1080) x cos 45° = 2121.32, the same either way round.
  assert.deepEqual(rotateSize(source, 45), { width: 2121, height: 2121 });
  assert.deepEqual(rotateSize(source, 135), { width: 2121, height: 2121 });
  assert.deepEqual(rotateSize({ width: 100, height: 100 }, 45), { width: 141, height: 141 });
  assert.deepEqual(rotateSize(source, Number.NaN), source, 'nonsense means no rotation');
});

test('flipRect: mirroring the picture moves the selection with it', () => {
  const bounds: Size = { width: 1000, height: 800 };
  const rect: Rect = { x: 100, y: 50, width: 200, height: 150 };
  assert.deepEqual(flipRect(rect, bounds, 'horizontal'), { x: 700, y: 50, width: 200, height: 150 });
  assert.deepEqual(flipRect(rect, bounds, 'vertical'), { x: 100, y: 600, width: 200, height: 150 });
  assert.deepEqual(flipRect(flipRect(rect, bounds, 'horizontal'), bounds, 'horizontal'), rect, 'flip twice, back where it started');
  assert.deepEqual(flipRect(flipRect(rect, bounds, 'vertical'), bounds, 'vertical'), rect);
});

test('CROP_RATIOS: freeform plus the nine named shapes', () => {
  assert.equal(CROP_RATIOS[0]?.value, null, 'freeform comes first');
  const labels = CROP_RATIOS.map((entry) => entry.label);
  assert.deepEqual(labels, ['Freeform', '1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16', '21:9', '5:4']);
  assert.equal(new Set(labels).size, labels.length, 'labels must be unique');
  for (const entry of CROP_RATIOS.slice(1)) {
    assert.ok(entry.value !== null && entry.value > 0, `${entry.label} needs a positive ratio`);
  }
  assert.equal(CROP_RATIOS.find((entry) => entry.label === '16:9')?.value, 16 / 9);
});

test('describeCrop: the sentence under the cropper', () => {
  assert.equal(describeCrop({ x: 0, y: 0, width: 1080, height: 1080 }, { width: 1920, height: 2160 }), '1080 × 1080 px (1:1), 28% of the original');
  assert.equal(describeCrop({ x: 0, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 }), '1920 × 1080 px (16:9), 100% of the original');
  assert.equal(describeCrop({ x: 0, y: 0, width: 1000, height: 999 }, { width: 4000, height: 3000 }), '1000 × 999 px (≈1:1), 8% of the original');
  assert.equal(describeCrop({ x: 0, y: 0, width: 20, height: 20 }, { width: 4000, height: 3000 }), '20 × 20 px (1:1), <1% of the original');
});

test('expandToRatio: grows the short side rather than trimming the long one', () => {
  const bounds: Size = { width: 1000, height: 800 };
  // 4:3 out to 16:9 — the height is what the person chose, so it stays.
  assert.deepEqual(expandToRatio({ x: 100, y: 100, width: 400, height: 300 }, 16 / 9, bounds), { x: 34, y: 100, width: 533, height: 300 });
  // Already wider than 16:9, so the height grows instead and the width stays.
  assert.deepEqual(expandToRatio({ x: 0, y: 0, width: 800, height: 200 }, 16 / 9, bounds), { x: 0, y: 0, width: 800, height: 450 });
  // Already the right shape: left exactly alone, even in a corner.
  assert.deepEqual(expandToRatio({ x: 900, y: 700, width: 100, height: 100 }, 1, bounds), { x: 900, y: 700, width: 100, height: 100 });
  // Only when the picture has no room does it come back smaller.
  assert.deepEqual(expandToRatio({ x: 0, y: 0, width: 1000, height: 800 }, 1, bounds), { x: 100, y: 0, width: 800, height: 800 });
});

test('expandToRatio: every ratio, from every corner, stays inside and on ratio', () => {
  const bounds: Size = { width: 1200, height: 900 };
  const starts: Rect[] = [
    { x: 0, y: 0, width: 200, height: 200 },
    { x: 1000, y: 700, width: 200, height: 200 },
    { x: 500, y: 400, width: 40, height: 300 },
    { x: 0, y: 880, width: 1200, height: 20 },
  ];
  for (const start of starts) {
    for (const entry of CROP_RATIOS) {
      if (entry.value === null) continue;
      const out = expandToRatio(start, entry.value, bounds);
      const where = `${entry.label} from ${show(start)} -> ${show(out)}`;
      assert.ok(Number.isInteger(out.x) && Number.isInteger(out.width), where);
      assert.ok(out.x >= 0 && out.y >= 0, `negative origin: ${where}`);
      assert.ok(out.x + out.width <= bounds.width, `escaped sideways: ${where}`);
      assert.ok(out.y + out.height <= bounds.height, `escaped downwards: ${where}`);
      assert.ok(Math.abs(out.width - out.height * entry.value) <= 1, `off ratio: ${where}`);
      assert.ok(out.width >= start.width || out.height >= start.height, `shrank on both sides: ${where}`);
    }
  }
});
