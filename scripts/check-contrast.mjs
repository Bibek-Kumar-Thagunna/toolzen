/**
 * ============================================================================
 * CONTRAST AUDIT
 * ============================================================================
 * Reads the design tokens out of globals.css and checks the pairs that actually
 * appear together in the product against WCAG 2.1 contrast ratios.
 *
 * Why a script and not a manual pass: the palette has two themes and about
 * thirty colours each, which is roughly nine hundred possible pairings — and
 * the ones that go wrong are never the obvious ones. A slider track three
 * points away from the card behind it looked fine in a review and was invisible
 * on a real screen.
 *
 * The thresholds are the WCAG ones:
 *   4.5  normal text
 *   3.0  large text (18pt+, or 14pt bold) and user-interface components —
 *        borders, icons, form-control boundaries, focus rings
 * A pair below its threshold is an error. A pair within 15% above it is a
 * warning, because those are the ones that fail on a dim laptop screen at an
 * angle even though they pass on paper.
 *
 * Run: node scripts/check-contrast.mjs
 * ============================================================================
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

/** Pull `--c-name: r g b;` declarations out of one CSS block. */
function tokensIn(block) {
  const found = new Map();
  for (const match of block.matchAll(/--c-([a-z0-9-]+):\s*([\d]+)\s+([\d]+)\s+([\d]+)\s*;/g)) {
    found.set(match[1], [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return found;
}

/**
 * The light palette is everything before the dark block; the dark palette is
 * the light one with the dark block's overrides applied, which is exactly how
 * the cascade resolves it in a browser.
 */
const darkStart = css.search(/^\.dark\s*\{/m);
if (darkStart === -1) throw new Error('could not find the dark block in globals.css');

const light = tokensIn(css.slice(0, darkStart));
const dark = new Map(light);
for (const [name, value] of tokensIn(css.slice(darkStart))) dark.set(name, value);

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The pairs that actually appear together on a page.
 *
 * `min` is the WCAG threshold for what that pair is: 4.5 where it is text a
 * person reads, 3 where it is a border, an icon or a control boundary.
 */
const PAIRS = [
  // Body text on every background it is set on.
  ['fg', 'canvas', 4.5, 'body text on the page'],
  ['fg', 'surface', 4.5, 'body text on a card'],
  ['fg', 'surface-sunken', 4.5, 'body text on a sunken panel'],
  ['fg-muted', 'canvas', 4.5, 'secondary text on the page'],
  ['fg-muted', 'surface', 4.5, 'secondary text on a card'],
  ['fg-muted', 'surface-sunken', 4.5, 'secondary text on a sunken panel'],
  // Placeholder and disabled text: still has to be readable, not decorative.
  ['fg-subtle', 'surface', 3, 'placeholder text'],

  // Buttons.
  ['primary-fg', 'primary', 4.5, 'label on the primary button'],
  ['fg-on-accent', 'accent', 4.5, 'label on an accent fill'],

  // Borders and control boundaries are interface components: threshold 3.
  ['border-strong', 'surface', 3, 'an input border'],
  ['track', 'surface', 3, 'a slider groove on a card'],
  ['accent', 'surface', 3, 'the filled part of a slider, and its thumb'],
  ['ring', 'canvas', 3, 'the focus ring'],

  // Status colours, as text on their own tinted background.
  ['accent-fg', 'accent-subtle', 4.5, 'text in an accent panel'],
  ['success-fg', 'success-subtle', 4.5, 'text in a success alert'],
  ['warning-fg', 'warning-subtle', 4.5, 'text in a warning alert'],
  ['danger-fg', 'danger-subtle', 4.5, 'text in a danger alert'],
  ['info-fg', 'info-subtle', 4.5, 'text in an info alert'],
  // And the accent used as a link colour on the page itself.
  ['accent-fg', 'surface', 4.5, 'a link on a card'],
  ['accent-fg', 'canvas', 4.5, 'a link on the page'],
  ['success', 'surface', 3, 'the success tick'],
];

const WARN_MARGIN = 1.15;
const errors = [];
const warnings = [];

for (const [theme, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const [fg, bg, min, what] of PAIRS) {
    const a = tokens.get(fg);
    const b = tokens.get(bg);
    if (!a || !b) {
      errors.push(`${theme}: --c-${a ? bg : fg} is not defined (needed for ${what})`);
      continue;
    }
    const value = ratio(a, b);
    const line = `${theme}: ${what} — ${fg} on ${bg} is ${value.toFixed(2)}:1, needs ${min}:1`;
    if (value < min) errors.push(line);
    else if (value < min * WARN_MARGIN) warnings.push(line);
  }
}

console.log(`Checked ${PAIRS.length} pairs in 2 themes.\n`);
if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const line of warnings) console.log(`  ${line}`);
  console.log('');
}
if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}):`);
  for (const line of errors) console.log(`  ${line}`);
  process.exit(1);
}
console.log('ERRORS: none');
