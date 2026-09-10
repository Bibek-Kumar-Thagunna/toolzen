/**
 * Colour conversion, contrast checking and palette generation.
 *
 * Two things in this file are load-bearing for accessibility and are therefore
 * taken from published sources rather than invented: the WCAG relative
 * luminance formula behind {@link contrastRatio}, and the LMS transformation
 * matrices behind {@link simulateColorBlindness}. Both are cited where they are
 * used. A contrast checker that is wrong by 0.1 will tell somebody their text
 * passes when it does not, which is worse than having no checker at all.
 *
 * The perceptual work - {@link rgbToOklch} and {@link tailwindScale} - uses
 * Bjorn Ottosson's Oklab, because ramps built by lightening in HSL wash out and
 * drift in hue, and the whole point of a generated scale is that the steps look
 * evenly spaced.
 */

import { rngFromSeed } from '../text/random.ts';
import type { Rng } from '../text/random.ts';

/** Channels in 0..255. Not necessarily integers until they are formatted. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue in degrees 0..360, saturation and lightness as percentages 0..100. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export type ParseResult =
  | { ok: true; rgb: Rgb; alpha: number; format: string }
  | { ok: false; error: string };

/** The 148 CSS named colours, lowercase, as they appear in CSS Color 4. */
export const CSS_COLOR_NAMES: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00',
  darkorchid: '#9932cc', darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b', darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1', darkviolet: '#9400d3', deeppink: '#ff1493',
  deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1e90ff',
  firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22', fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700', goldenrod: '#daa520',
  gray: '#808080', green: '#008000', greenyellow: '#adff2f', grey: '#808080',
  honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c', indigo: '#4b0082',
  ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa', lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3', lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a', lightseagreen: '#20b2aa', lightskyblue: '#87cefa',
  lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32', linen: '#faf0e6',
  magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa', mediumblue: '#0000cd',
  mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585', midnightblue: '#191970', mintcream: '#f5fffa',
  mistyrose: '#ffe4e1', moccasin: '#ffe4b5', navajowhite: '#ffdead', navy: '#000080',
  oldlace: '#fdf5e6', olive: '#808000', olivedrab: '#6b8e23', orange: '#ffa500',
  orangered: '#ff4500', orchid: '#da70d6', palegoldenrod: '#eee8aa', palegreen: '#98fb98',
  paleturquoise: '#afeeee', palevioletred: '#db7093', papayawhip: '#ffefd5',
  peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb', plum: '#dda0dd',
  powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399', red: '#ff0000',
  rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513', salmon: '#fa8072',
  sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee', sienna: '#a0522d',
  silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd', slategray: '#708090',
  slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f', steelblue: '#4682b4',
  tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8', tomato: '#ff6347',
  turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3', white: '#ffffff',
  whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function byte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Alpha keeps three decimals so `#ffffff01` does not round away to invisible. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unrecognised(input: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `I could not read "${input}" as a colour. Try a hex code such as #3366ff, an rgb() or hsl() value, or a CSS colour name such as cornflowerblue.`,
  };
}

/** `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`, case-insensitive. */
function parseHex(input: string, body: string): ParseResult {
  if (!/^[0-9a-f]+$/.test(body)) {
    return {
      ok: false,
      error: `"${input}" contains something that is not a hex digit. Hex colours use 0-9 and a-f only, as in #3366ff.`,
    };
  }
  if (body.length !== 3 && body.length !== 4 && body.length !== 6 && body.length !== 8) {
    return {
      ok: false,
      error: `"${input}" has ${body.length} digits after the #. A hex colour needs 3, 4, 6 or 8 of them.`,
    };
  }
  const short = body.length === 3 || body.length === 4;
  const pair = (index: number): number =>
    short
      ? parseInt(body[index] + body[index], 16)
      : parseInt(body.slice(index * 2, index * 2 + 2), 16);
  const hasAlpha = body.length === 4 || body.length === 8;
  return {
    ok: true,
    rgb: { r: pair(0), g: pair(1), b: pair(2) },
    alpha: hasAlpha ? round3(pair(3) / 255) : 1,
    format: hasAlpha ? 'hex-alpha' : 'hex',
  };
}

/**
 * Splits the inside of `rgb(...)` or `hsl(...)` into its arguments.
 *
 * CSS Color 4 allows both the old comma syntax and the space syntax with a
 * slash before the alpha, and mixing them is legal in practice because browsers
 * are lenient. Treating commas, spaces and the slash all as separators accepts
 * every real-world spelling, and the argument count is checked afterwards.
 */
function splitArguments(inner: string): { values: string[]; hadSlash: boolean } {
  const hadSlash = inner.includes('/');
  const values = inner
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  return { values, hadSlash };
}

/** A plain number or a percentage of `full`. Returns null when unreadable. */
function readScaled(token: string, full: number): number | null {
  if (token.endsWith('%')) {
    const percent = Number(token.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * full : null;
  }
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** Degrees, with the `deg`, `grad`, `rad` and `turn` units CSS allows. */
function readAngle(token: string): number | null {
  const match = /^(-?[0-9.]+(?:e[-+]?\d+)?)(deg|grad|rad|turn)?$/.exec(token);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] ?? 'deg';
  if (unit === 'grad') return value * 0.9;
  if (unit === 'rad') return (value * 180) / Math.PI;
  if (unit === 'turn') return value * 360;
  return value;
}

function readAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const value = readScaled(token, 1);
  return value === null ? null : clamp(round3(value), 0, 1);
}

function parseRgbFunction(input: string, name: string, inner: string): ParseResult {
  const { values } = splitArguments(inner);
  if (values.length < 3 || values.length > 4) {
    return {
      ok: false,
      error: `${name}() needs three numbers for red, green and blue, and an optional fourth for opacity. I found ${values.length} in "${input}".`,
    };
  }
  const channels: number[] = [];
  for (const token of values.slice(0, 3)) {
    const value = readScaled(token, 255);
    if (value === null) {
      return { ok: false, error: `I could not read "${token}" as a number in "${input}".` };
    }
    channels.push(byte(value));
  }
  const alpha = readAlpha(values[3]);
  if (alpha === null) {
    return { ok: false, error: `I could not read "${values[3]}" as an opacity in "${input}".` };
  }
  return {
    ok: true,
    rgb: { r: channels[0], g: channels[1], b: channels[2] },
    alpha,
    format: name,
  };
}

function parseHslFunction(input: string, name: string, inner: string): ParseResult {
  const { values } = splitArguments(inner);
  if (values.length < 3 || values.length > 4) {
    return {
      ok: false,
      error: `${name}() needs a hue angle, a saturation and a lightness, and an optional fourth value for opacity. I found ${values.length} in "${input}".`,
    };
  }
  const hue = readAngle(values[0]);
  if (hue === null) {
    return { ok: false, error: `I could not read "${values[0]}" as a hue angle in "${input}".` };
  }
  const saturation = readScaled(values[1], 100);
  const lightness = readScaled(values[2], 100);
  if (saturation === null || lightness === null) {
    return {
      ok: false,
      error: `The saturation and lightness in "${input}" have to be percentages, as in hsl(210 90% 55%).`,
    };
  }
  const alpha = readAlpha(values[3]);
  if (alpha === null) {
    return { ok: false, error: `I could not read "${values[3]}" as an opacity in "${input}".` };
  }
  const rgb = hslToRgb({
    h: ((hue % 360) + 360) % 360,
    s: clamp(saturation, 0, 100),
    l: clamp(lightness, 0, 100),
  });
  return { ok: true, rgb, alpha, format: name };
}

/**
 * Reads any of the colour spellings a person is likely to paste in.
 *
 * `format` reports what was recognised - `hex`, `hex-alpha`, `rgb`, `rgba`,
 * `hsl`, `hsla` or `named` - so the UI can offer "convert from this" without
 * guessing.
 */
export function parseColor(input: string): ParseResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return {
      ok: false,
      error: 'Type a colour first, such as #3366ff, rgb(51 102 255) or cornflowerblue.',
    };
  }
  const text = input.trim();
  const lower = text.toLowerCase();

  if (lower === 'transparent') {
    return { ok: true, rgb: { r: 0, g: 0, b: 0 }, alpha: 0, format: 'named' };
  }
  const named = CSS_COLOR_NAMES[lower];
  if (named !== undefined) {
    const parsed = parseHex(named, named.slice(1));
    return parsed.ok ? { ...parsed, format: 'named' } : parsed;
  }
  if (lower.startsWith('#')) return parseHex(text, lower.slice(1));

  const call = /^(rgb|rgba|hsl|hsla)\s*\(([^)]*)\)$/.exec(lower);
  if (call) {
    const name = call[1];
    const inner = call[2].trim();
    if (inner.length === 0) {
      return { ok: false, error: `"${text}" has nothing inside the brackets.` };
    }
    return name.startsWith('rgb')
      ? parseRgbFunction(text, name, inner)
      : parseHslFunction(text, name, inner);
  }
  // A bare `3366ff` is a hex code with the # left off often enough to accept.
  if (/^[0-9a-f]{3,8}$/.test(lower)) return parseHex(`#${text}`, lower);
  return unrecognised(text);
}

function hexPair(value: number): string {
  return byte(value).toString(16).padStart(2, '0');
}

/** Lowercase `#rrggbb`, or `#rrggbbaa` when `alpha` is given and below 1. */
export function rgbToHex(rgb: Rgb, alpha?: number): string {
  const base = `#${hexPair(rgb.r)}${hexPair(rgb.g)}${hexPair(rgb.b)}`;
  if (alpha === undefined || alpha >= 1) return base;
  return `${base}${hexPair(clamp(alpha, 0, 1) * 255)}`;
}

/**
 * Full precision on purpose. Rounding saturation and lightness to whole
 * percentages loses information, and a hex to HSL to hex round trip then comes
 * back a shade off. Formatting for display is the caller's job.
 */
export function rgbToHsl(rgb: Rgb): Hsl {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const span = max - min;
  if (span === 0) return { h: 0, s: 0, l: lightness * 100 };
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const hue = (((hsl.h % 360) + 360) % 360) / 60;
  const saturation = clamp(hsl.s, 0, 100) / 100;
  const lightness = clamp(hsl.l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const base = lightness - chroma / 2;
  const sector = Math.floor(hue) % 6;
  const table: ReadonlyArray<readonly [number, number, number]> = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [r, g, b] = table[sector];
  return { r: byte((r + base) * 255), g: byte((g + base) * 255), b: byte((b + base) * 255) };
}

export function rgbToHsv(rgb: Rgb): { h: number; s: number; v: number } {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  let hue = 0;
  if (span !== 0) {
    if (max === r) hue = ((g - b) / span) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max === 0 ? 0 : (span / max) * 100, v: max * 100 };
}

/** The naive conversion print uses: no ink limits, no colour profile. */
export function rgbToCmyk(rgb: Rgb): { c: number; m: number; y: number; k: number } {
  const r = clamp(rgb.r, 0, 255) / 255;
  const g = clamp(rgb.g, 0, 255) / 255;
  const b = clamp(rgb.b, 0, 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - r - k) / (1 - k)) * 100,
    m: ((1 - g - k) / (1 - k)) * 100,
    y: ((1 - b - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

/**
 * sRGB to linear light, exactly as WCAG 2.x specifies it: the piecewise curve
 * with a 0.04045 threshold, a 1/12.92 slope below it and `((c+0.055)/1.055)^2.4`
 * above. The often-copied 0.03928 threshold is from an older draft and shifts
 * borderline ratios, which is the difference between a pass and a fail.
 */
function linearise(channel: number): number {
  const c = clamp(channel, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function encodeSrgb(linear: number): number {
  const c = clamp(linear, 0, 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** WCAG relative luminance: 0.2126 R + 0.7152 G + 0.0722 B in linear light. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearise(rgb.r) + 0.7152 * linearise(rgb.g) + 0.0722 * linearise(rgb.b);
}

/**
 * Full precision, deliberately. Black on white comes out at exactly 21, and a
 * borderline pair such as #767676 on white at 4.5422 - rounding that to 4.54
 * before comparing it against the 4.5 threshold would be harmless, but rounding
 * a 4.4999 up to 4.50 would turn a fail into a pass. Rounding happens in
 * {@link assessContrast}, after every comparison has been made.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastVerdict {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  aaUiComponent: boolean;
  summary: string;
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const AAA_NORMAL = 7;
const AAA_LARGE = 4.5;
const AA_UI_COMPONENT = 3;

/**
 * The WCAG 2.2 verdict. "Large" means 18pt, or 14pt bold and heavier. The UI
 * component threshold is success criterion 1.4.11 and covers borders, icons and
 * focus rings - the parts of an interface that are not text but still have to be
 * seen.
 */
export function assessContrast(fg: Rgb, bg: Rgb): ContrastVerdict {
  const ratio = contrastRatio(fg, bg);
  const rounded = round2(ratio);
  const verdict: ContrastVerdict = {
    ratio: rounded,
    aaNormal: ratio >= AA_NORMAL,
    aaLarge: ratio >= AA_LARGE,
    aaaNormal: ratio >= AAA_NORMAL,
    aaaLarge: ratio >= AAA_LARGE,
    aaUiComponent: ratio >= AA_UI_COMPONENT,
    summary: '',
  };
  const shown = `${rounded.toFixed(2)} to 1`;
  if (verdict.aaaNormal) {
    verdict.summary = `At ${shown} this passes every WCAG level, including AAA for body text.`;
  } else if (verdict.aaNormal) {
    verdict.summary = `At ${shown} this passes AA for text of any size, but falls short of AAA for body text, which needs 7 to 1.`;
  } else if (verdict.aaLarge) {
    verdict.summary = `At ${shown} this is only strong enough for large text - 18pt, or 14pt bold - and for borders and icons. Body text needs 4.5 to 1.`;
  } else {
    verdict.summary = `At ${shown} this fails every WCAG level. Darken the text or lighten the background until the ratio reaches at least 3 to 1 for large text and 4.5 to 1 for body text.`;
  }
  return verdict;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Whichever of black or white is easier to read on this background. */
export function bestTextColor(bg: Rgb): { color: '#000000' | '#ffffff'; ratio: number } {
  const onBlack = contrastRatio(BLACK, bg);
  const onWhite = contrastRatio(WHITE, bg);
  return onBlack >= onWhite
    ? { color: '#000000', ratio: round2(onBlack) }
    : { color: '#ffffff', ratio: round2(onWhite) };
}

/**
 * Linear sRGB to Oklab, using the matrices Bjorn Ottosson published with the
 * space in "A perceptual color space for image processing" (2020). Linear sRGB
 * goes to a cone-response LMS estimate, each channel takes a cube root, and a
 * second matrix produces the opponent pair. Oklab is used rather than CIE Lab
 * because its hue stays put when lightness changes, which is exactly what a
 * generated colour ramp depends on.
 */
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The inverse of {@link linearToOklab}, from the same source. */
function oklabToLinear(lightness: number, a: number, b: number): [number, number, number] {
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Lightness 0..1, chroma in Oklab units, hue in degrees. */
export function rgbToOklch(rgb: Rgb): { l: number; c: number; h: number } {
  const [lightness, a, b] = linearToOklab(linearise(rgb.r), linearise(rgb.g), linearise(rgb.b));
  const chroma = Math.hypot(a, b);
  // Below this, the a/b pair is rounding noise and the angle is meaningless.
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

const GAMUT_TOLERANCE = 1e-4;

function insideGamut(linear: readonly number[]): boolean {
  return linear.every((value) => value >= -GAMUT_TOLERANCE && value <= 1 + GAMUT_TOLERANCE);
}

/**
 * OKLCH back to a displayable colour.
 *
 * Most OKLCH triples name a colour no monitor can show. Clipping the resulting
 * RGB channels would change the lightness as well as the saturation, which
 * breaks an evenly spaced ramp. Instead the chroma is reduced - a binary search
 * for the most saturated version that still fits in sRGB - while lightness and
 * hue are held exactly where they were asked for.
 */
function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;
  const at = (amount: number): [number, number, number] =>
    oklabToLinear(lightness, amount * Math.cos(radians), amount * Math.sin(radians));
  let usable = chroma;
  if (!insideGamut(at(chroma))) {
    let low = 0;
    let high = chroma;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (insideGamut(at(middle))) low = middle;
      else high = middle;
    }
    usable = low;
  }
  const [r, g, b] = at(usable);
  return {
    r: byte(encodeSrgb(r) * 255),
    g: byte(encodeSrgb(g) * 255),
    b: byte(encodeSrgb(b) * 255),
  };
}

const SCALE_STEPS: readonly number[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Oklab lightness for each step. Evenly spaced by eye, not by arithmetic. */
const SCALE_LIGHTNESS: readonly number[] = [
  0.971, 0.941, 0.885, 0.828, 0.75, 0.662, 0.582, 0.5, 0.424, 0.36, 0.262,
];

/**
 * Chroma multipliers. Colour has to fade at both ends: a near-white tint with
 * full chroma looks like a stain, and a near-black shade with full chroma cannot
 * be represented on screen anyway.
 */
const SCALE_CHROMA: readonly number[] = [
  0.2, 0.35, 0.55, 0.75, 0.9, 1, 1, 0.92, 0.8, 0.68, 0.5,
];

/** Below this the base colour is grey, and inventing a hue for it is wrong. */
const NEUTRAL_CHROMA = 0.004;

/**
 * A Tailwind-shaped 50..950 scale built from one colour.
 *
 * The ramp walks Oklab lightness, keeping the base hue. The naive alternative -
 * mixing the base with white and black in HSL - produces steps that bunch up in
 * the middle and drift towards grey at the light end, because HSL lightness is
 * not perceptual. This produces steps that look evenly spaced.
 */
export function tailwindScale(base: Rgb): Array<{ step: number; hex: string }> {
  const { c, h } = rgbToOklch(base);
  const chroma = c < NEUTRAL_CHROMA ? 0 : c;
  return SCALE_STEPS.map((step, index) => ({
    step,
    hex: rgbToHex(oklchToRgb(SCALE_LIGHTNESS[index], chroma * SCALE_CHROMA[index], h)),
  }));
}

/** Blends in linear light, so mixing complementary colours does not go muddy. */
export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp(amount, 0, 1);
  const blend = (first: number, second: number): number =>
    byte(encodeSrgb(linearise(first) * (1 - t) + linearise(second) * t) * 255);
  return { r: blend(a.r, b.r), g: blend(a.g, b.g), b: blend(a.b, b.b) };
}

export type HarmonyKind =
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'tetradic'
  | 'split-complementary'
  | 'monochromatic'
  | 'shades'
  | 'tints';

/** Hue offsets in degrees. The three lightness-based kinds are handled apart. */
const HARMONY_ANGLES: Readonly<Record<string, readonly number[]>> = {
  complementary: [0, 180],
  analogous: [0, 30, 330],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  'split-complementary': [0, 150, 210],
};

const MONOCHROMATIC_LIGHTNESS: readonly number[] = [85, 70, 55, 40, 25];
const SHADE_STEPS: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8];

/**
 * A colour-wheel harmony.
 *
 * Hues rotate in HSL rather than Oklab: "complementary means 180 degrees away"
 * is a statement about the artist's colour wheel that HSL models, and shifting
 * to a perceptual wheel would quietly return different colours from the ones
 * every design tool shows for the same rule.
 *
 * `monochromatic` walks lightness from light to dark, `shades` blends towards
 * black and `tints` towards white; all three start from the base and return five
 * colours.
 */
export function harmony(base: Rgb, kind: HarmonyKind): Rgb[] {
  if (kind === 'shades') return SHADE_STEPS.map((amount) => mix(base, BLACK, amount));
  if (kind === 'tints') return SHADE_STEPS.map((amount) => mix(base, WHITE, amount));
  const hsl = rgbToHsl(base);
  if (kind === 'monochromatic') {
    return MONOCHROMATIC_LIGHTNESS.map((l) => hslToRgb({ h: hsl.h, s: hsl.s, l }));
  }
  const angles = HARMONY_ANGLES[kind] ?? HARMONY_ANGLES.complementary;
  return angles.map((angle) => hslToRgb({ h: (hsl.h + angle) % 360, s: hsl.s, l: hsl.l }));
}

export interface PaletteEntry {
  hex: string;
  rgb: Rgb;
  hsl: Hsl;
  name: string;
  textColor: string;
  contrastOnWhite: number;
  contrastOnBlack: number;
}

export type PaletteResult = { ok: true; colors: PaletteEntry[] } | { ok: false; error: string };

const MIN_PALETTE = 2;
const MAX_PALETTE = 12;
const DEFAULT_PALETTE = 5;

function describe(rgb: Rgb): PaletteEntry {
  return {
    hex: rgbToHex(rgb),
    rgb,
    hsl: rgbToHsl(rgb),
    name: nearestNamedColor(rgb).name,
    textColor: bestTextColor(rgb).color,
    contrastOnWhite: round2(contrastRatio(rgb, WHITE)),
    contrastOnBlack: round2(contrastRatio(rgb, BLACK)),
  };
}

/** A random colour that is worth looking at: mid lightness, clearly saturated. */
function randomPleasantColor(rng: Rng): Rgb {
  return hslToRgb({ h: rng() * 360, s: 55 + rng() * 30, l: 42 + rng() * 22 });
}

/** Fills a palette out to `count` by nudging the harmony colours it already has. */
function extend(colors: Rgb[], count: number, rng: Rng): Rgb[] {
  const out = colors.slice();
  const source = colors.length > 0 ? colors : [WHITE];
  let index = 0;
  while (out.length < count) {
    const hsl = rgbToHsl(source[index % source.length]);
    const lightnessShift = (rng() < 0.5 ? -1 : 1) * (10 + rng() * 15);
    const hueShift = (rng() - 0.5) * 16;
    out.push(
      hslToRgb({
        h: (hsl.h + hueShift + 360) % 360,
        s: hsl.s,
        l: clamp(hsl.l + lightnessShift, 8, 92),
      }),
    );
    index += 1;
  }
  return out.slice(0, count);
}

/**
 * A palette, with the contrast figures already worked out for each colour.
 *
 * Passing a `seed` makes the result reproducible, which is what lets a shared
 * link show the same palette to two people. Leaving it out uses the crypto
 * source in `../text/random.ts`, so a refresh really is a new palette.
 */
export function generatePalette(
  opts: { base?: string; kind?: HarmonyKind; count?: number; seed?: number } = {},
): PaletteResult {
  const count = opts.count ?? DEFAULT_PALETTE;
  if (!Number.isInteger(count) || count < MIN_PALETTE || count > MAX_PALETTE) {
    return {
      ok: false,
      error: `A palette can hold between ${MIN_PALETTE} and ${MAX_PALETTE} colours. You asked for ${String(count)}.`,
    };
  }
  const kind = opts.kind ?? 'analogous';
  const rng = rngFromSeed(opts.seed);
  let base: Rgb;
  if (typeof opts.base === 'string' && opts.base.trim().length > 0) {
    const parsed = parseColor(opts.base);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    base = parsed.rgb;
  } else {
    base = randomPleasantColor(rng);
  }
  const colors = extend(harmony(base, kind), count, rng);
  return { ok: true, colors: colors.map(describe) };
}

/**
 * The closest CSS colour name.
 *
 * The distance is the "redmean" approximation rather than a straight Euclidean
 * one. Plain RGB distance assumes a step in blue is as visible as the same step
 * in red, which it is not - the eye is far more sensitive to green, and least to
 * blue - so Euclidean matching names blues and greens badly. Redmean weights the
 * channels and tilts the red and blue weights depending on how red the pair is,
 * which tracks perception closely for the cost of one extra multiply.
 */
export function nearestNamedColor(rgb: Rgb): { name: string; hex: string; distance: number } {
  let bestName = 'black';
  let bestHex = '#000000';
  let bestDistance = Infinity;
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const other = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    const redMean = (clamp(rgb.r, 0, 255) + other.r) / 2;
    const dr = clamp(rgb.r, 0, 255) - other.r;
    const dg = clamp(rgb.g, 0, 255) - other.g;
    const db = clamp(rgb.b, 0, 255) - other.b;
    const distance = Math.sqrt(
      (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = name;
      bestHex = hex;
    }
  }
  return { name: bestName, hex: bestHex, distance: round2(bestDistance) };
}

/**
 * Linear sRGB to the LMS cone response used for dichromacy simulation, from
 * Vienot, Brettel and Mollon, "Digital video colourmaps for checking the
 * legibility of displays by dichromats" (Color Research and Application, 1999).
 */
const RGB_TO_LMS: ReadonlyArray<readonly number[]> = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];

/**
 * How each deficiency collapses one cone response onto the other two, from the
 * same paper. Protanopia loses the long-wavelength cone, deuteranopia the
 * medium, tritanopia the short.
 *
 * The paper's own caveat applies to the last one: the tritanopia coefficients
 * are an extrapolation rather than a fit to observer data, so treat that
 * simulation as indicative. Protanopia and deuteranopia, which together cover
 * the overwhelming majority of colour vision deficiency, are the fitted cases.
 */
const DICHROMAT_PROJECTION: Readonly<Record<string, readonly number[]>> = {
  protanopia: [2.02344, -2.52581],
  deuteranopia: [0.494207, 1.24827],
  tritanopia: [-0.395913, 0.801109],
};

/**
 * Inverts a 3x3 matrix by cofactors.
 *
 * The inverse of {@link RGB_TO_LMS} is published too, rounded to six figures,
 * but rounding it means a colour a dichromat sees normally does not survive the
 * round trip exactly. Computing the true inverse keeps grey exactly grey, which
 * is a property of the projection and something the tests check.
 */
function invert3(m: ReadonlyArray<readonly number[]>): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const cofactorA = e * i - f * h;
  const cofactorD = f * g - d * i;
  const cofactorG = d * h - e * g;
  const determinant = a * cofactorA + b * cofactorD + c * cofactorG;
  return [
    [cofactorA / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
    [cofactorD / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
    [cofactorG / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant],
  ];
}

const LMS_TO_RGB = invert3(RGB_TO_LMS);

/**
 * What a colour looks like to somebody with the named form of colour blindness.
 *
 * The work happens in linear light, not in the gamma-encoded values: the cone
 * response is a linear combination of the light actually arriving, so doing the
 * arithmetic on sRGB numbers would be mixing quantities that are not additive.
 */
export function simulateColorBlindness(
  rgb: Rgb,
  kind: 'protanopia' | 'deuteranopia' | 'tritanopia',
): Rgb {
  const r = linearise(rgb.r);
  const g = linearise(rgb.g);
  const b = linearise(rgb.b);
  let long = RGB_TO_LMS[0][0] * r + RGB_TO_LMS[0][1] * g + RGB_TO_LMS[0][2] * b;
  let medium = RGB_TO_LMS[1][0] * r + RGB_TO_LMS[1][1] * g + RGB_TO_LMS[1][2] * b;
  let short = RGB_TO_LMS[2][0] * r + RGB_TO_LMS[2][1] * g + RGB_TO_LMS[2][2] * b;
  const projection = DICHROMAT_PROJECTION[kind];
  if (kind === 'protanopia') long = projection[0] * medium + projection[1] * short;
  else if (kind === 'deuteranopia') medium = projection[0] * long + projection[1] * short;
  else short = projection[0] * long + projection[1] * medium;
  const channel = (row: readonly number[]): number =>
    byte(encodeSrgb(row[0] * long + row[1] * medium + row[2] * short) * 255);
  return {
    r: channel(LMS_TO_RGB[0]),
    g: channel(LMS_TO_RGB[1]),
    b: channel(LMS_TO_RGB[2]),
  };
}
