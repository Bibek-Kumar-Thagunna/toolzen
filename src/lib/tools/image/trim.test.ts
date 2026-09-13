import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contentBounds, isWorthCropping } from './trim.ts';
import type { Size } from './dimensions.ts';

/** A canvas filled with `bg`, on which `draw` may put ink. */
function canvas(
  size: Size,
  bg: [number, number, number, number],
  draw?: (set: (x: number, y: number, rgba: [number, number, number, number]) => void) => void,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size.width * size.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = bg[3];
  }
  draw?.((x, y, rgba) => {
    const at = (y * size.width + x) * 4;
    data[at] = rgba[0];
    data[at + 1] = rgba[1];
    data[at + 2] = rgba[2];
    data[at + 3] = rgba[3];
  });
  return data;
}

test('a blank sheet returns the whole frame rather than an empty crop', () => {
  const size = { width: 40, height: 30 };
  const data = canvas(size, [255, 255, 255, 255]);
  assert.deepEqual(contentBounds(data, size), { x: 0, y: 0, width: 40, height: 30 });
});

test('ink in the middle is found, with padding added around it', () => {
  const size = { width: 100, height: 100 };
  const data = canvas(size, [255, 255, 255, 255], (set) => {
    for (let y = 40; y < 60; y += 1) {
      for (let x = 40; x < 60; x += 1) set(x, y, [0, 0, 0, 255]);
    }
  });

  // 20x20 of content, 4% padding = 1px each side (round(20 * 0.04) = 1).
  const bounds = contentBounds(data, size);
  assert.equal(bounds.x, 39);
  assert.equal(bounds.y, 39);
  assert.equal(bounds.width, 22);
  assert.equal(bounds.height, 22);
});

test('the background is measured from the corners, not assumed to be white', () => {
  // Photographed paper: a grey-beige sheet, with a dark signature on it. A
  // fixed "not white" test would treat the entire page as content and crop
  // nothing at all, which is the bug this exists to avoid.
  const size = { width: 80, height: 80 };
  const data = canvas(size, [206, 200, 188, 255], (set) => {
    for (let x = 30; x < 50; x += 1) set(x, 40, [20, 20, 30, 255]);
  });

  const bounds = contentBounds(data, size, { padding: 0 });
  assert.equal(bounds.x, 30);
  assert.equal(bounds.width, 20);
  assert.equal(bounds.height, 1);
});

test('light ink on dark paper works, because the corners describe the paper', () => {
  const size = { width: 60, height: 60 };
  const data = canvas(size, [18, 18, 24, 255], (set) => {
    for (let x = 10; x < 30; x += 1) set(x, 20, [240, 240, 240, 255]);
  });

  const bounds = contentBounds(data, size, { padding: 0 });
  assert.equal(bounds.x, 10);
  assert.equal(bounds.width, 20);
});

test('one bad corner does not drag the estimate — the median survives it', () => {
  // A thumb over the bottom-right corner. Three corners are paper; a mean
  // would shift the background towards the thumb and start treating paper as
  // content.
  const size = { width: 50, height: 50 };
  const data = canvas(size, [250, 248, 245, 255], (set) => {
    set(49, 49, [90, 60, 50, 255]);
    for (let x = 20; x < 30; x += 1) set(x, 25, [10, 10, 10, 255]);
  });

  const bounds = contentBounds(data, size, { padding: 0 });
  // The signature, plus the thumb pixel itself, which is legitimately content.
  assert.equal(bounds.x, 20);
  assert.equal(bounds.y, 25);
});

test('transparent pixels are background whatever colour is stored under them', () => {
  // A PNG exported with a cut-out background keeps arbitrary RGB under alpha 0.
  // Reading those as ink would return the whole frame and crop nothing.
  const size = { width: 40, height: 40 };
  const data = canvas(size, [255, 0, 0, 0], (set) => {
    for (let x = 15; x < 25; x += 1) set(x, 20, [0, 0, 0, 255]);
  });

  const bounds = contentBounds(data, size, { padding: 0 });
  assert.equal(bounds.x, 15);
  assert.equal(bounds.width, 10);
});

test('padding is clamped to the frame rather than running off the edge', () => {
  const size = { width: 20, height: 20 };
  const data = canvas(size, [255, 255, 255, 255], (set) => {
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) if (x > 0 || y > 0) set(x, y, [0, 0, 0, 255]);
    }
  });

  const bounds = contentBounds(data, size, { padding: 0.5 });
  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0);
  assert.ok(bounds.width <= 20);
  assert.ok(bounds.height <= 20);
});

test('a degenerate buffer is refused by returning the whole frame', () => {
  const size = { width: 10, height: 10 };
  assert.deepEqual(contentBounds(new Uint8ClampedArray(4), size), {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
});

test('isWorthCropping ignores a crop that barely changes anything', () => {
  const size = { width: 100, height: 100 };
  // 2% saved — not worth a second encode pass.
  assert.equal(isWorthCropping({ x: 0, y: 0, width: 99, height: 99 }, size), false);
  // 51% saved.
  assert.equal(isWorthCropping({ x: 0, y: 0, width: 70, height: 70 }, size), true);
});
