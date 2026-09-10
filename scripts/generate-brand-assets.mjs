#!/usr/bin/env node
/**
 * ============================================================================
 * BRAND ASSET GENERATION
 * ============================================================================
 * Builds every image the site claims to have, from two inputs: the brand name
 * and the accent colour. Run it after changing either.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * What it writes:
 *   public/favicon.ico                 32×32 + 16×16
 *   public/icons/icon.svg              the mark, as vector
 *   public/icons/icon-192.png          PWA
 *   public/icons/icon-512.png          PWA
 *   public/icons/maskable-512.png      PWA, safe zone respected
 *   public/icons/apple-touch-icon.png  180×180, opaque
 *   public/og/default.png              1200×630
 *   public/og/tool/<slug>.png          1200×630, one per tool
 *   public/og/category/<id>.png        1200×630, one per category
 *
 * ── Why generate rather than draw once in a design tool ───────────────────
 * `src/lib/seo.ts` promises a specific OG image path for every tool page. Thirty
 * one images maintained by hand drift the moment a tool is renamed, and a
 * missing one is invisible in testing and embarrassing in public — a link
 * pasted into a chat that unfurls as a broken rectangle. Generating them from
 * the registry means the set is correct by construction, and adding a tool
 * costs a re-run rather than an afternoon.
 *
 * ── Why SVG through sharp, and not a canvas ───────────────────────────────
 * The layout here is text on a flat background with a mark: SVG expresses that
 * exactly, is diffable in review, and needs no headless browser. sharp
 * rasterises it through librsvg. The one real constraint is that text is
 * rendered with the fonts installed on the machine doing the build, so the
 * copy is drawn with a generic stack and the layout does not depend on precise
 * metrics — nothing is centred by measuring a string.
 *
 * ── Why the text is escaped ───────────────────────────────────────────────
 * Tool names come from the registry and go into markup. An ampersand in a name
 * would produce invalid XML and sharp would fail on the whole batch, so every
 * interpolated string goes through `escapeXml` first. Same class of bug as the
 * JSON-LD escaping in `seo.ts`, and worth the same care.
 * ============================================================================
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');

/* ─────────────────────────── brand inputs ──────────────────────────────── */

/**
 * Read straight out of `brand.ts` rather than duplicated here, so a rename
 * cannot leave the icons saying the old name. A regex rather than an import
 * because this is a plain `.mjs` script and the source is TypeScript.
 */
const brandSource = await readText(join(root, 'src/lib/brand.ts'));
const NAME = matchOne(brandSource, /name:\s*'([^']+)'/, 'Toolzen');
const TAGLINE = matchOne(brandSource, /tagline:\s*'([^']+)'/, 'Fast, private tools that just work.');

/** The accent, taken from the light theme in globals.css. `r g b`, space-separated. */
const cssSource = await readText(join(root, 'src/app/globals.css'));
const ACCENT_RGB = matchOne(cssSource, /--c-accent:\s*([\d\s]+);/, '192 67 11').trim();
const ACCENT = `rgb(${ACCENT_RGB.split(/\s+/).join(',')})`;

const INK = '#12100e';
const PAPER = '#fdfcfb';
const MUTED = '#6b6560';

/** A generic stack: the build machine's fonts are not ours to assume. */
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/* ─────────────────────────────── the mark ──────────────────────────────── */

/**
 * The mark: a stack of three balanced stones with a face on the top one.
 *
 * Kept in step with `src/components/Logo.tsx` by hand — this script is plain
 * `.mjs` and cannot import the TSX component. The geometry is the same
 * 48-unit box, so the two can be diffed side by side.
 *
 * Drawn for 16 pixels first. Three stacked shapes of clearly different widths
 * keep a readable silhouette in a browser tab; a single round stone turned
 * into an indistinguishable dot.
 *
 * `maskable` insets everything to the inner 80%, because a platform may crop a
 * maskable icon to a circle, and pads the remainder with the brand colour so
 * the tile is opaque.
 */
const STONE_DARK = '#0f766e';
const STONE_MID = '#14b8a6';
const STONE_LIGHT = '#5eead4';

function markSvg(size, { maskable = false, background = '#ffffff' } = {}) {
  const scale = maskable ? 0.72 : 0.92;
  const offset = (48 - 48 * scale) / 2;

  const stones = `
    <g transform="translate(${offset} ${offset}) scale(${scale})">
      <ellipse cx="24" cy="40" rx="16" ry="5.4" fill="${STONE_DARK}"/>
      <ellipse cx="24" cy="30.5" rx="12" ry="5.2" fill="${STONE_MID}"/>
      <path d="M24 12c5.2 0 8.8 3.7 8.8 8.2 0 4.2-3.6 6.6-8.8 6.6s-8.8-2.4-8.8-6.6C15.2 15.7 18.8 12 24 12z" fill="${STONE_LIGHT}"/>
      <circle cx="20.9" cy="19.6" r="1.35" fill="${STONE_DARK}"/>
      <circle cx="27.1" cy="19.6" r="1.35" fill="${STONE_DARK}"/>
      <path d="M21.4 23a3.4 3.4 0 0 0 5.2 0" stroke="${STONE_DARK}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}">
  ${maskable ? `<rect width="48" height="48" fill="${background}"/>` : ''}
  ${stones}
</svg>`;
}

/* ──────────────────────────── the OG card ──────────────────────────────── */

/**
 * A 1200×630 card: brand line, title, one line of support text, accent rule.
 *
 * `wrap` breaks the title by word count rather than by measured width, because
 * the measurement would depend on a font this script cannot rely on. The sizes
 * below are chosen so that the longest title in the registry still fits at the
 * smallest step.
 */
function ogSvg({ eyebrow, title, subtitle }) {
  const lines = wrap(title, 22).slice(0, 3);
  const fontSize = lines.length >= 3 ? 62 : lines.length === 2 ? 72 : 84;
  const startY = 300 - ((lines.length - 1) * fontSize * 1.15) / 2;

  const titleMarkup = lines
    .map(
      (line, index) =>
        `<tspan x="80" y="${startY + index * fontSize * 1.15}">${escapeXml(line)}</tspan>`,
    )
    .join('');

  /*
   * The support line wraps rather than truncating. A tagline cut at a fixed
   * character count lands mid-word — "…without it looking obviously degr…" —
   * which reads as a rendering fault rather than as an abbreviation. Two lines
   * hold every tagline in the registry; a third would collide with the rule
   * below, so the last line is ellipsised if one ever gets longer.
   */
  const subtitleLines = wrap(subtitle, 58);
  const shown = subtitleLines.slice(0, 2);
  if (subtitleLines.length > 2 && shown[1] !== undefined) {
    shown[1] = truncate(`${shown[1]} ${subtitleLines[2]}`, 58);
  }
  const subtitleTop = 500 - (shown.length - 1) * 38;
  const subtitleMarkup = shown
    .map((line, index) => `<tspan x="80" y="${subtitleTop + index * 38}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect x="0" y="0" width="1200" height="10" fill="${ACCENT}"/>

  <g transform="translate(80, 70)">
    <g transform="scale(1.1667)">${markSvg(48).replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
    <text x="76" y="28" font-family="${FONT}" font-size="30" font-weight="700"
          fill="${INK}" dominant-baseline="central">${escapeXml(NAME)}</text>
    <text x="${76 + NAME.length * 18 + 18}" y="29" font-family="${FONT}" font-size="22"
          fill="${MUTED}" dominant-baseline="central">${escapeXml(eyebrow)}</text>
  </g>

  <text font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="${INK}">${titleMarkup}</text>

  <text font-family="${FONT}" font-size="30" fill="${MUTED}">${subtitleMarkup}</text>

  <rect x="80" y="556" width="120" height="6" rx="3" fill="${ACCENT}"/>
</svg>`;
}

/* ──────────────────────────────── run ──────────────────────────────────── */

const { tools, categories } = await readRegistry();

mkdirSync(join(publicDir, 'icons'), { recursive: true });
mkdirSync(join(publicDir, 'og/tool'), { recursive: true });
mkdirSync(join(publicDir, 'og/category'), { recursive: true });

// -- icons --------------------------------------------------------------------
writeFileSync(join(publicDir, 'icons/icon.svg'), markSvg(512));

await png(markSvg(192), join(publicDir, 'icons/icon-192.png'));
await png(markSvg(512), join(publicDir, 'icons/icon-512.png'));
await png(markSvg(512, { maskable: true, background: '#ffffff' }), join(publicDir, 'icons/maskable-512.png'));
// iOS composites an apple-touch-icon onto black if it has transparency, so this
// one is drawn on an opaque tile of its own.
await png(markSvg(180, { maskable: true, background: '#ffffff' }), join(publicDir, 'icons/apple-touch-icon.png'));

/**
 * A real multi-resolution .ico, assembled by hand.
 *
 * sharp writes PNG, not ICO, and pulling in an encoder for a 22-byte header is
 * not worth a dependency. The ICO container is a directory of embedded images,
 * and every browser since IE6 accepts PNG payloads inside one, so this packs
 * two PNGs and writes the header itself.
 */
await writeIco(
  [
    { size: 16, data: await sharp(Buffer.from(markSvg(16))).png().toBuffer() },
    { size: 32, data: await sharp(Buffer.from(markSvg(32))).png().toBuffer() },
  ],
  join(publicDir, 'favicon.ico'),
);

// -- open graph ---------------------------------------------------------------
await png(
  ogSvg({ eyebrow: '', title: NAME, subtitle: TAGLINE }),
  join(publicDir, 'og/default.png'),
);

for (const tool of tools) {
  await png(
    ogSvg({ eyebrow: 'free online tool', title: tool.h1, subtitle: tool.tagline }),
    join(publicDir, `og/tool/${tool.slug}.png`),
  );
}

for (const category of categories) {
  await png(
    ogSvg({ eyebrow: 'tools', title: category.name, subtitle: category.tagline }),
    join(publicDir, `og/category/${category.id}.png`),
  );
}

console.log(
  `[brand] ${NAME}: 6 icons, ${tools.length + categories.length + 1} OG images written to public/`,
);

/* ───────────────────────────── helpers ─────────────────────────────────── */

async function png(svg, path) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path);
}

async function readText(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

function matchOne(source, pattern, fallback) {
  const match = source.match(pattern);
  return match?.[1] ?? fallback;
}

/**
 * Pull the registry's slugs, headings and taglines out of the TypeScript source
 * with a regex.
 *
 * Not elegant, and the honest alternative — compiling the registry so this
 * script can import it — means a build step before the build step for the sake
 * of three fields per entry. The failure mode is contained: if a field cannot be
 * read the entry is skipped and the count printed at the end will not match the
 * registry, which is visible immediately.
 */
async function readRegistry() {
  const { readdir } = await import('node:fs/promises');
  const toolsDir = join(root, 'src/lib/registry/tools');
  const files = await readdir(toolsDir);

  const tools = [];
  for (const file of files) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = await readText(join(toolsDir, file));
    const pattern = /slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*h1:\s*'([^']+)',\s*tagline:\s*'([^']*)'/g;
    for (const match of source.matchAll(pattern)) {
      tools.push({ slug: match[1], name: match[2], h1: match[3], tagline: match[4] });
    }
  }

  const categorySource = await readText(join(root, 'src/lib/registry/categories.ts'));
  const categories = [];
  const categoryPattern = /id:\s*'([^']+)',\s*slug:\s*'[^']+',\s*name:\s*'([^']+)',[\s\S]*?tagline:\s*'([^']*)'/g;
  for (const match of categorySource.matchAll(categoryPattern)) {
    categories.push({ id: match[1], name: match[2], tagline: match[3] });
  }

  return { tools, categories };
}

/** Break into lines of at most `max` characters, never mid-word. */
function wrap(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (`${line} ${word}`.length <= max) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function truncate(text, max) {
  const value = String(text);
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Five characters, and skipping any one of them produces invalid XML. */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Write an ICO containing PNG payloads.
 *
 * Layout: a 6-byte header, then one 16-byte directory entry per image, then the
 * image data. A dimension of 256 is written as 0, which is the format's way of
 * saying "256" in a single byte — not a bug, and the reason a 256px icon in a
 * hand-rolled writer so often comes out zero-sized.
 */
async function writeIco(images, path) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = [];
  let offset = 6 + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2); // palette size: 0 for true colour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += image.data.length;
  }

  writeFileSync(path, Buffer.concat([header, ...directory, ...images.map((i) => i.data)]));
}
