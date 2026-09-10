import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CSS_COLOR_NAMES,
  assessContrast,
  bestTextColor,
  contrastRatio,
  generatePalette,
  harmony,
  hslToRgb,
  mix,
  nearestNamedColor,
  parseColor,
  relativeLuminance,
  rgbToCmyk,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  simulateColorBlindness,
  tailwindScale,
} from './color.ts';
import type { HarmonyKind, Rgb } from './color.ts';

/** Deterministic PRNG so a failing round trip is always reproducible. */
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

/** Unwraps a parse that is expected to succeed. */
function rgbOf(input: string): Rgb {
  const parsed = parseColor(input);
  assert.equal(parsed.ok, true, `could not parse ${input}`);
  if (!parsed.ok) throw new Error('unreachable');
  return parsed.rgb;
}

test('all 148 CSS colour names are present, well formed, and parse back to themselves', () => {
  const names = Object.keys(CSS_COLOR_NAMES);
  assert.equal(names.length, 148);
  assert.equal(new Set(names).size, 148);
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    assert.match(name, /^[a-z]+$/, name);
    assert.match(hex, /^#[0-9a-f]{6}$/, `${name} -> ${hex}`);
    const parsed = parseColor(name);
    assert.equal(parsed.ok, true, name);
    if (!parsed.ok) continue;
    assert.equal(parsed.format, 'named', name);
    assert.equal(parsed.alpha, 1, name);
    assert.equal(rgbToHex(parsed.rgb), hex, name);
  }
  // The spellings people actually get wrong, and the grey/gray pairing.
  for (const [name, hex] of [
    ['red', '#ff0000'],
    ['lime', '#00ff00'],
    ['blue', '#0000ff'],
    ['white', '#ffffff'],
    ['black', '#000000'],
    ['rebeccapurple', '#663399'],
    ['cornflowerblue', '#6495ed'],
    ['gray', '#808080'],
    ['grey', '#808080'],
    ['darkslategrey', '#2f4f4f'],
    ['aqua', '#00ffff'],
    ['cyan', '#00ffff'],
  ] as const) {
    assert.equal(CSS_COLOR_NAMES[name], hex, name);
  }
  // Case and stray whitespace are the user's, not an error.
  assert.equal(rgbToHex(rgbOf('  ReBeccaPurple ')), '#663399');
});

test('transparent parses to a real colour with zero alpha', () => {
  const parsed = parseColor('transparent');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alpha, 0);
  assert.deepEqual(parsed.rgb, { r: 0, g: 0, b: 0 });
});

test('every hex spelling is read the same way', () => {
  const cases: ReadonlyArray<[string, string, number, string]> = [
    ['#36f', '#3366ff', 1, 'hex'],
    ['#36F', '#3366ff', 1, 'hex'],
    ['#3366ff', '#3366ff', 1, 'hex'],
    ['#3366FF', '#3366ff', 1, 'hex'],
    ['#36f8', '#3366ff', 0.533, 'hex-alpha'],
    ['#3366ff80', '#3366ff', 0.502, 'hex-alpha'],
    ['#3366ff00', '#3366ff', 0, 'hex-alpha'],
    ['#3366ffff', '#3366ff', 1, 'hex-alpha'],
    ['3366ff', '#3366ff', 1, 'hex'],
    ['#000', '#000000', 1, 'hex'],
    ['#fff', '#ffffff', 1, 'hex'],
  ];
  for (const [input, hex, alpha, format] of cases) {
    const parsed = parseColor(input);
    assert.equal(parsed.ok, true, input);
    if (!parsed.ok) continue;
    assert.equal(rgbToHex(parsed.rgb), hex, input);
    assert.equal(parsed.alpha, alpha, input);
    assert.equal(parsed.format, format, input);
  }
  // `#ffffff01` must not round to a fully transparent white.
  const faint = parseColor('#ffffff01');
  assert.equal(faint.ok && faint.alpha > 0, true);
});

test('rgb() and hsl() in both the comma and the space syntax', () => {
  const equivalent = [
    'rgb(51, 102, 255)',
    'rgb(51 102 255)',
    'rgba(51, 102, 255, 1)',
    'rgba(51 102 255 / 1)',
    'rgb(20%, 40%, 100%)',
    'hsl(225, 100%, 60%)',
    'hsl(225 100% 60%)',
    'hsla(225, 100%, 60%, 1)',
    'hsla(225 100% 60% / 1)',
    'hsl(250grad 100% 60%)',
    'hsl(0.625turn 100% 60%)',
  ];
  for (const input of equivalent) {
    assert.equal(rgbToHex(rgbOf(input)), '#3366ff', input);
  }
  const spaced = parseColor('rgb(51 102 255)');
  assert.equal(spaced.ok && spaced.format, 'rgb');
  const transparentHsl = parseColor('hsla(0 0% 0% / 0)');
  assert.equal(transparentHsl.ok && transparentHsl.format, 'hsla');
  assert.equal(transparentHsl.ok && transparentHsl.alpha, 0);
});

test('unreadable colours come back as a sentence, not an exception', () => {
  const junk = [
    '',
    '   ',
    'not a colour',
    'bluish',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#gggggg',
    '12345',
    'rgb()',
    'rgb(1,2)',
    'rgb(1,2,3,4,5)',
    'hsl(abc 10% 20%)',
    'hsl(210 abc 20%)',
    'rgb(1 2 3 / abc)',
  ];
  for (const input of junk) {
    const parsed = parseColor(input);
    assert.equal(parsed.ok, false, `accepted ${JSON.stringify(input)}`);
    if (parsed.ok) continue;
    assert.ok(parsed.error.length > 25, parsed.error);
    assert.match(parsed.error, /\.$/, parsed.error);
    assert.equal(parsed.error.includes('undefined'), false, parsed.error);
    assert.equal(parsed.error.includes('NaN'), false, parsed.error);
  }
});

test('hex to HSL and back is lossless for 500 colours', () => {
  // Rounding saturation and lightness to whole percentages would break this,
  // which is why rgbToHsl keeps its full precision.
  const random = mulberry32(20260903);
  for (let i = 0; i < 500; i += 1) {
    const rgb = {
      r: Math.floor(random() * 256),
      g: Math.floor(random() * 256),
      b: Math.floor(random() * 256),
    };
    const hex = rgbToHex(rgb);
    assert.equal(rgbToHex(hslToRgb(rgbToHsl(rgb))), hex, hex);
    assert.equal(rgbToHex(rgbOf(hex)), hex, hex);
  }
  // The corners, where the hue sector arithmetic changes branch.
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#7f7f7f']) {
    assert.equal(rgbToHex(hslToRgb(rgbToHsl(rgbOf(hex)))), hex, hex);
  }
});

const round2 = (value: number): number => Math.round(value * 100) / 100;

test('HSV and CMYK match the values worked out by hand', () => {
  const hsv = (hex: string): string => {
    const { h, s, v } = rgbToHsv(rgbOf(hex));
    return `${round2(h)} ${round2(s)} ${round2(v)}`;
  };
  assert.equal(hsv('#ff0000'), '0 100 100');
  assert.equal(hsv('#00ff00'), '120 100 100');
  assert.equal(hsv('#0000ff'), '240 100 100');
  assert.equal(hsv('#ffffff'), '0 0 100');
  assert.equal(hsv('#000000'), '0 0 0');
  assert.equal(hsv('#808080'), '0 0 50.2');
  assert.equal(hsv('#3366ff'), '225 80 100');
  assert.equal(hsv('#c0ffee'), '163.81 24.71 100');

  const cmyk = (hex: string): string => {
    const { c, m, y, k } = rgbToCmyk(rgbOf(hex));
    return `${round2(c)} ${round2(m)} ${round2(y)} ${round2(k)}`;
  };
  assert.equal(cmyk('#ff0000'), '0 100 100 0');
  assert.equal(cmyk('#00ff00'), '100 0 100 0');
  assert.equal(cmyk('#0000ff'), '100 100 0 0');
  assert.equal(cmyk('#ffffff'), '0 0 0 0');
  assert.equal(cmyk('#000000'), '0 0 0 100');
  assert.equal(cmyk('#3366ff'), '80 60 0 0');
  assert.equal(cmyk('#808080'), '0 0 0 49.8');
});

test('relative luminance uses the WCAG coefficients exactly', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
  // A primary at full strength is its coefficient, because the other two are
  // zero and linearise(255) is exactly 1.
  assert.ok(Math.abs(relativeLuminance({ r: 255, g: 0, b: 0 }) - 0.2126) < 1e-12);
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 255, b: 0 }) - 0.7152) < 1e-12);
  assert.ok(Math.abs(relativeLuminance({ r: 0, g: 0, b: 255 }) - 0.0722) < 1e-12);
  // The 0.04045 knee: 10/255 is below it and takes the linear branch.
  assert.ok(Math.abs(relativeLuminance({ r: 10, g: 10, b: 10 }) - 10 / 255 / 12.92) < 1e-12);
});

test('contrast ratio: black on white is exactly 21, and it is symmetric', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(contrastRatio(black, white), 21);
  assert.equal(contrastRatio(white, black), 21);
  assert.equal(contrastRatio(white, white), 1);
  assert.equal(contrastRatio(black, black), 1);
  const random = mulberry32(4045);
  for (let i = 0; i < 200; i += 1) {
    const a = { r: random() * 255, g: random() * 255, b: random() * 255 };
    const b = { r: random() * 255, g: random() * 255, b: random() * 255 };
    assert.equal(contrastRatio(a, b), contrastRatio(b, a));
    assert.ok(contrastRatio(a, b) >= 1 && contrastRatio(a, b) <= 21);
  }
});

test('the AA boundary falls between #767676 and #777777 on white', () => {
  // These two greys are one step apart and sit either side of 4.5, so they are
  // the pair that catches a linearisation using the old 0.03928 knee or a ratio
  // rounded before it is compared.
  const white = { r: 255, g: 255, b: 255 };
  const pass = assessContrast(rgbOf('#767676'), white);
  assert.equal(pass.ratio, 4.54);
  assert.equal(pass.aaNormal, true);
  assert.equal(pass.aaLarge, true);
  assert.equal(pass.aaaNormal, false);
  assert.equal(pass.aaaLarge, true);
  assert.equal(pass.aaUiComponent, true);
  assert.match(pass.summary, /passes AA for text of any size/);

  const fail = assessContrast(rgbOf('#777777'), white);
  assert.equal(fail.ratio, 4.48);
  assert.equal(fail.aaNormal, false);
  assert.equal(fail.aaLarge, true);
  assert.equal(fail.aaaLarge, false);
  assert.match(fail.summary, /only strong enough for large text/);

  const perfect = assessContrast({ r: 0, g: 0, b: 0 }, white);
  assert.equal(perfect.ratio, 21);
  assert.equal(perfect.aaaNormal, true);
  assert.match(perfect.summary, /passes every WCAG level/);

  const hopeless = assessContrast({ r: 255, g: 255, b: 0 }, white);
  assert.equal(hopeless.aaLarge, false);
  assert.match(hopeless.summary, /fails every WCAG level/);
  for (const verdict of [pass, fail, perfect, hopeless]) {
    assert.match(verdict.summary, /^At \d+\.\d\d to 1 /, verdict.summary);
    assert.match(verdict.summary, /\.$/);
  }
});

test('bestTextColor picks the readable one, and one of the two always passes AA', () => {
  assert.deepEqual(bestTextColor(rgbOf('#1a1a1a')), { color: '#ffffff', ratio: 17.4 });
  assert.deepEqual(bestTextColor(rgbOf('#ffdd00')), { color: '#000000', ratio: 15.59 });
  assert.equal(bestTextColor(rgbOf('#ffffff')).color, '#000000');
  assert.equal(bestTextColor(rgbOf('#000000')).color, '#ffffff');

  const random = mulberry32(1411);
  for (let i = 0; i < 500; i += 1) {
    const bg = {
      r: Math.floor(random() * 256),
      g: Math.floor(random() * 256),
      b: Math.floor(random() * 256),
    };
    const chosen = bestTextColor(bg);
    const onBlack = contrastRatio({ r: 0, g: 0, b: 0 }, bg);
    const onWhite = contrastRatio({ r: 255, g: 255, b: 255 }, bg);
    assert.equal(chosen.color, onBlack >= onWhite ? '#000000' : '#ffffff', rgbToHex(bg));
    assert.equal(chosen.ratio, round2(Math.max(onBlack, onWhite)), rgbToHex(bg));
    // The worst possible background sits at the crossover, where both options
    // still reach 4.58, so plain black or white text is never below AA.
    assert.ok(chosen.ratio >= 4.5, `${rgbToHex(bg)} only reached ${chosen.ratio}`);
  }
});

test('OKLCH matches Ottossons published figures', () => {
  const red = rgbToOklch(rgbOf('#ff0000'));
  assert.ok(Math.abs(red.l - 0.6280) < 5e-4, `L ${red.l}`);
  assert.ok(Math.abs(red.c - 0.2577) < 5e-4, `C ${red.c}`);
  assert.ok(Math.abs(red.h - 29.23) < 5e-3, `h ${red.h}`);

  const white = rgbToOklch(rgbOf('#ffffff'));
  assert.ok(Math.abs(white.l - 1) < 1e-6, `L ${white.l}`);
  assert.ok(white.c < 1e-6, `C ${white.c}`);
  // Below the chroma floor the hue angle is rounding noise, so it is pinned.
  assert.equal(white.h, 0);
  assert.deepEqual(rgbToOklch(rgbOf('#000000')), { l: 0, c: 0, h: 0 });

  // Lightness has to rise with the grey level or every ramp built on it is wrong.
  let previous = -1;
  for (let level = 0; level <= 255; level += 5) {
    const { l } = rgbToOklch({ r: level, g: level, b: level });
    assert.ok(l > previous, `L stalled at grey ${level}`);
    previous = l;
  }
});

test('tailwindScale runs from light to dark without a single flat step', () => {
  for (const base of ['#3b82f6', '#ff0000', '#808080', '#000000', '#ffffff', '#123456']) {
    const scale = tailwindScale(rgbOf(base));
    assert.deepEqual(
      scale.map((entry) => entry.step),
      [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
    );
    let previous = Infinity;
    for (const entry of scale) {
      assert.match(entry.hex, /^#[0-9a-f]{6}$/, `${base} ${entry.step}`);
      const { l } = rgbToOklch(rgbOf(entry.hex));
      assert.ok(l < previous, `${base} step ${entry.step} did not darken: ${l} vs ${previous}`);
      previous = l;
    }
    // The ends have to be usable as a page background and as body text on it.
    const light = rgbOf(scale[0].hex);
    const dark = rgbOf(scale[scale.length - 1].hex);
    assert.ok(contrastRatio(dark, light) >= 7, `${base} ends only reach ${contrastRatio(dark, light)}`);
  }
});

test('an achromatic base gives a true neutral ramp, not a tinted one', () => {
  // A chroma floor applied to grey invents a hue out of rounding noise, which is
  // how a grey scale comes out faintly tan.
  for (const base of ['#000000', '#808080', '#ffffff', '#7f7f7f']) {
    for (const entry of tailwindScale(rgbOf(base))) {
      const { r, g, b } = rgbOf(entry.hex);
      assert.equal(r, g, `${base} step ${entry.step} is ${entry.hex}`);
      assert.equal(g, b, `${base} step ${entry.step} is ${entry.hex}`);
    }
  }
  // A saturated base keeps its hue all the way down the ramp.
  const blueHue = rgbToOklch(rgbOf('#3b82f6')).h;
  for (const entry of tailwindScale(rgbOf('#3b82f6'))) {
    const { h, c } = rgbToOklch(rgbOf(entry.hex));
    if (c > 0.02) assert.ok(Math.abs(h - blueHue) < 12, `${entry.step} drifted to ${h}`);
  }
});

test('mix blends in linear light and honours the end points', () => {
  const red = { r: 255, g: 0, b: 0 };
  const blue = { r: 0, g: 0, b: 255 };
  assert.equal(rgbToHex(mix(red, blue, 0)), '#ff0000');
  assert.equal(rgbToHex(mix(red, blue, 1)), '#0000ff');
  // Half of black and half of white is 0.5 in linear light, which encodes to
  // #bcbcbc. The #808080 that naive averaging gives is the darker, wrong answer.
  assert.equal(rgbToHex(mix({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5)), '#bcbcbc');
  assert.equal(rgbToHex(mix(red, blue, 0.5)), '#bc00bc');
});

test('each harmony rotates the wheel by the angles the rule names', () => {
  const base = rgbOf('#3366ff');
  const baseHue = rgbToHsl(base).h;
  assert.equal(baseHue, 225);
  const expected: ReadonlyArray<[HarmonyKind, readonly number[]]> = [
    ['complementary', [0, 180]],
    ['analogous', [0, 30, 330]],
    ['triadic', [0, 120, 240]],
    ['tetradic', [0, 90, 180, 270]],
    ['split-complementary', [0, 150, 210]],
  ];
  for (const [kind, angles] of expected) {
    const colors = harmony(base, kind);
    assert.equal(colors.length, angles.length, kind);
    for (let i = 0; i < angles.length; i += 1) {
      const hue = rgbToHsl(colors[i]).h;
      const want = (baseHue + angles[i]) % 360;
      const apart = Math.min(Math.abs(hue - want), 360 - Math.abs(hue - want));
      assert.ok(apart < 1, `${kind} colour ${i} is at ${hue}, not ${want}`);
      // Rotating hue must not quietly change how saturated or light it is.
      assert.ok(Math.abs(rgbToHsl(colors[i]).l - 60) < 0.5, `${kind} ${i} lightness drifted`);
    }
    assert.equal(rgbToHex(colors[0]), '#3366ff', kind);
  }
  // Red is the case where the numbers are exact, so it is worth pinning.
  assert.deepEqual(
    harmony(rgbOf('#ff0000'), 'triadic').map((c) => rgbToHex(c)),
    ['#ff0000', '#00ff00', '#0000ff'],
  );
  assert.deepEqual(
    harmony(rgbOf('#ff0000'), 'complementary').map((c) => rgbToHex(c)),
    ['#ff0000', '#00ffff'],
  );
});

test('the lightness harmonies walk in one direction and keep the hue', () => {
  const base = rgbOf('#3366ff');
  const mono = harmony(base, 'monochromatic');
  assert.equal(mono.length, 5);
  const wanted = [85, 70, 55, 40, 25];
  for (let i = 0; i < mono.length; i += 1) {
    const { h, l } = rgbToHsl(mono[i]);
    assert.ok(Math.abs(l - wanted[i]) < 0.5, `step ${i} is at lightness ${l}`);
    assert.ok(Math.abs(h - 225) < 1.5, `step ${i} drifted to hue ${h}`);
  }
  for (const [kind, direction] of [['shades', -1], ['tints', 1]] as const) {
    const colors = harmony(base, kind as HarmonyKind);
    assert.equal(colors.length, 5);
    assert.equal(rgbToHex(colors[0]), '#3366ff', kind);
    for (let i = 1; i < colors.length; i += 1) {
      const step = relativeLuminance(colors[i]) - relativeLuminance(colors[i - 1]);
      assert.ok(Math.sign(step) === direction, `${kind} reversed at step ${i}`);
    }
  }
});

test('a seeded palette is the same palette every time, and an unseeded one is not', () => {
  const first = generatePalette({ seed: 42, count: 8, kind: 'triadic' });
  const second = generatePalette({ seed: 42, count: 8, kind: 'triadic' });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.colors, second.colors);
  assert.equal(first.colors.length, 8);
  // A shared link has to show the same colours to two people, so this is the
  // one place in the two modules where reproducibility is the requirement.
  const different = generatePalette({ seed: 43, count: 8, kind: 'triadic' });
  assert.equal(different.ok, true);
  if (different.ok) assert.notDeepEqual(different.colors, first.colors);

  const unseeded = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const result = generatePalette({ count: 5 });
    if (result.ok) unseeded.add(result.colors.map((entry) => entry.hex).join());
  }
  assert.ok(unseeded.size >= 45, `only ${unseeded.size} distinct palettes in 50`);
});

test('every palette entry carries the figures a designer needs', () => {
  const result = generatePalette({ base: '#3366ff', kind: 'analogous', count: 5, seed: 7 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(rgbToHex(result.colors[0].rgb), '#3366ff');
  for (const entry of result.colors) {
    assert.match(entry.hex, /^#[0-9a-f]{6}$/);
    assert.equal(rgbToHex(entry.rgb), entry.hex);
    assert.deepEqual(entry.hsl, rgbToHsl(entry.rgb));
    assert.ok(CSS_COLOR_NAMES[entry.name] !== undefined, entry.name);
    assert.ok(entry.textColor === '#000000' || entry.textColor === '#ffffff', entry.textColor);
    assert.equal(entry.contrastOnWhite, round2(contrastRatio(entry.rgb, { r: 255, g: 255, b: 255 })));
    assert.equal(entry.contrastOnBlack, round2(contrastRatio(entry.rgb, { r: 0, g: 0, b: 0 })));
    // Compared unrounded: two ratios that display the same can still differ.
    const onBlack = contrastRatio(entry.rgb, { r: 0, g: 0, b: 0 });
    const onWhite = contrastRatio(entry.rgb, { r: 255, g: 255, b: 255 });
    assert.equal(entry.textColor, onBlack >= onWhite ? '#000000' : '#ffffff', entry.hex);
  }
});

test('palette counts are bounded and a bad base colour is reported as such', () => {
  for (const count of [1, 0, 13, -2, 2.5, Number.NaN]) {
    const result = generatePalette({ count });
    assert.equal(result.ok, false, `accepted ${String(count)}`);
    if (!result.ok) assert.match(result.error, /between 2 and 12 colours/);
  }
  for (const count of [2, 12]) {
    const result = generatePalette({ count, seed: 1 });
    assert.equal(result.ok, true, `rejected ${count}`);
    if (result.ok) assert.equal(result.colors.length, count);
  }
  const bad = generatePalette({ base: 'chartrooze' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /could not read "chartrooze"/);
});

test('nearestNamedColor finds the obvious answer and is exact on the names themselves', () => {
  const nudged = nearestNamedColor(rgbOf('#ff0001'));
  assert.equal(nudged.name, 'red');
  assert.equal(nudged.hex, '#ff0000');
  assert.ok(nudged.distance > 0 && nudged.distance < 5, `distance ${nudged.distance}`);

  // Every named colour is its own nearest neighbour, at distance zero.
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const found = nearestNamedColor(rgbOf(hex));
    assert.equal(found.distance, 0, `${name} matched ${found.name} at ${found.distance}`);
    assert.equal(found.hex, hex, name);
  }
  for (const [input, expected] of [
    ['#000000', 'black'],
    ['#ffffff', 'white'],
    ['#010101', 'black'],
    ['#6495ec', 'cornflowerblue'],
    ['#663398', 'rebeccapurple'],
  ] as const) {
    assert.equal(nearestNamedColor(rgbOf(input)).name, expected, input);
  }
  // Out-of-range channels are clamped rather than throwing off the arithmetic.
  assert.equal(nearestNamedColor({ r: 300, g: -20, b: -5 }).name, 'red');
});

test('colour blindness simulation leaves every grey exactly where it was', () => {
  // Greys carry no red-green or blue-yellow information, so a dichromat sees
  // them unchanged. Any drift here means the matrix and its inverse disagree.
  for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
    for (let level = 0; level <= 255; level += 1) {
      const seen = simulateColorBlindness({ r: level, g: level, b: level }, kind);
      assert.deepEqual(seen, { r: level, g: level, b: level }, `${kind} at grey ${level}`);
    }
  }
});

test('colour blindness simulation collapses the confusable pairs, not the rest', () => {
  const red = rgbOf('#ff0000');
  const green = rgbOf('#00ff00');
  // Red and green are far apart normally and close together to a protanope.
  assert.ok(contrastRatio(red, green) > 2, 'sanity check on the starting pair');
  for (const kind of ['protanopia', 'deuteranopia'] as const) {
    const a = simulateColorBlindness(red, kind);
    const b = simulateColorBlindness(green, kind);
    const apart = Math.abs(rgbToHsl(a).h - rgbToHsl(b).h);
    assert.ok(Math.min(apart, 360 - apart) < 30, `${kind} kept them ${apart} degrees apart`);
  }
  // Blue is on the axis a protanope still has, so it must not turn into red.
  const blue = simulateColorBlindness(rgbOf('#0000ff'), 'protanopia');
  assert.ok(blue.b > blue.r, `blue became ${rgbToHex(blue)}`);
  for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#3366ff', '#c0ffee', '#ffdd00']) {
      const seen = simulateColorBlindness(rgbOf(hex), kind);
      for (const channel of [seen.r, seen.g, seen.b]) {
        assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255, `${kind} ${hex}`);
      }
    }
  }
});
