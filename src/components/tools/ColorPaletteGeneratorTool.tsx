'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { describedBy, Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import {
  assessContrast,
  bestTextColor,
  contrastRatio,
  generatePalette,
  harmony,
  hslToRgb,
  nearestNamedColor,
  parseColor,
  rgbToCmyk,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  simulateColorBlindness,
  tailwindScale,
  type ContrastVerdict,
  type HarmonyKind,
  type Hsl,
  type PaletteEntry,
  type Rgb,
} from '@/lib/tools/gen/color';
import { cryptoRng } from '@/lib/tools/text/random';

/**
 * Color palette generator.
 *
 * Six decisions worth recording.
 *
 * **Everything is computed during render.** Every figure here is a pure function
 * of the controls, so the server renders a real palette and the browser renders
 * the same one. The single random ingredient — the filler swatches a harmony rule
 * cannot supply on its own — comes from a seed field whose blank value is a fixed
 * constant, so there is nothing for hydration to disagree about. The only true
 * randomness runs inside the "Random" handler, which is an event, not a render.
 *
 * **The seed field is only shown when it can change something.** A rule supplies
 * a fixed number of colors: two for complementary, five for shades. Below that
 * threshold the seed is never consulted, and a control that visibly does nothing
 * is worse than a hidden one.
 *
 * **Generated colors are inline `style`, not utility classes.** The palette is
 * data. It cannot come from the token set, and no amount of Tailwind
 * configuration would change that. Nothing else in this file uses a raw color.
 *
 * **Text never sits on a generated color.** Contrast against a color somebody
 * just invented cannot be guaranteed, so every label sits on `bg-surface`
 * underneath its swatch rather than on top of it. `bestTextColor` is reported as
 * a fact in the detail panel instead of being used to paint small text.
 *
 * **The color vision preview repaints swatches and never values.** A simulated
 * hex is not a color anybody should copy, so the previews change what is drawn
 * and leave every number alone, with a banner saying so.
 *
 * **An unreadable starting color is reported in the hint slot, not the error
 * slot.** `Field`'s error slot is a live region, and a hex code is invalid for
 * two or three keystrokes on the way to being valid; announcing that on every
 * keystroke is noise. The border and `aria-invalid` carry the state, the hint
 * carries the sentence, and the result area says plainly that it is waiting.
 */

const SLUG = 'color-palette-generator';

const BASE_ID = 'palette-base';
const PICKER_ID = 'palette-picker';
const HARMONY_ID = 'palette-harmony';
const COUNT_ID = 'palette-count';
const SEED_ID = 'palette-seed';
const VISION_ID = 'palette-vision';
/** Not `palette-export`: `TextOutput` puts that id on the textarea below it. */
const FORMAT_ID = 'palette-format';
const PALETTE_HEADING_ID = 'palette-swatches-heading';
const DETAIL_HEADING_ID = 'palette-detail-heading';
const SCALE_HEADING_ID = 'palette-scale-heading';
const EXPORT_HEADING_ID = 'palette-export-heading';

/** Saturated enough to show what the rules do, dark enough to pass on white. */
const DEFAULT_BASE = '#3366ff';

const MIN_COUNT = 2;
const MAX_COUNT = 12;
const DEFAULT_COUNT = 5;

/** mulberry32 truncates to 32 bits, so the field only has to be a whole number. */
const DEFAULT_SEED = 1;
const MAX_SEED = 4294967295;

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** The WCAG AA threshold for body text, used for the scale advice line. */
const BODY_TEXT_RATIO = 4.5;

const HARMONY_ORDER: readonly HarmonyKind[] = [
  'analogous',
  'complementary',
  'split-complementary',
  'triadic',
  'tetradic',
  'monochromatic',
  'shades',
  'tints',
];

const HARMONY_LABELS: Record<HarmonyKind, string> = {
  analogous: 'Analogous — neighbours on the wheel',
  complementary: 'Complementary — the opposite hue',
  'split-complementary': 'Split complementary — either side of opposite',
  triadic: 'Triadic — three, evenly spaced',
  tetradic: 'Tetradic — four, in two pairs',
  monochromatic: 'Monochromatic — one hue, five lightnesses',
  shades: 'Shades — towards black',
  tints: 'Tints — towards white',
};

const HARMONY_BLURBS: Record<HarmonyKind, string> = {
  analogous:
    'Three hues within 30 degrees of each other. The hardest rule to make clash, and the usual choice for a calm interface.',
  complementary:
    'The starting color and the hue directly opposite it. Strong, and uncomfortable at full saturation in small sizes.',
  'split-complementary':
    'The two hues either side of the opposite one. Keeps most of the tension of a complementary pair with less vibration.',
  triadic:
    'Three hues 120 degrees apart. Lively, and easy to overuse — one of the three usually has to lead.',
  tetradic:
    'Two complementary pairs, 90 degrees apart. The most colors to balance, so it needs a clear dominant.',
  monochromatic:
    'One hue at five lightnesses. Safe, and it can leave you without a color that reads as a warning.',
  shades:
    'The starting color blended towards black in linear light, which is what stops it going muddy.',
  tints:
    'The starting color blended towards white in linear light, which is what stops it going chalky.',
};

type Vision = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';

const VISION_ORDER: readonly Vision[] = ['none', 'deuteranopia', 'protanopia', 'tritanopia'];

const VISION_LABELS: Record<Vision, string> = {
  none: 'Off — show the real colors',
  deuteranopia: 'Deuteranopia — no working green cone',
  protanopia: 'Protanopia — no working red cone',
  tritanopia: 'Tritanopia — no working blue cone',
};

const VISION_NOTES: Record<Exclude<Vision, 'none'>, string> = {
  deuteranopia:
    'The most common form. Simulated from coefficients fitted to observation, so it is close enough to make design decisions against.',
  protanopia:
    'The other common red-green form, also fitted to observation. Reds darken noticeably as well as shifting.',
  tritanopia:
    'Rare, and the coefficients are an extrapolation in the original paper rather than a fit. Treat this one as indicative.',
};

type ExportFormat = 'hex' | 'css' | 'scss' | 'tailwind' | 'json';

const EXPORT_ORDER: readonly ExportFormat[] = ['hex', 'css', 'scss', 'tailwind', 'json'];

const EXPORT_LABELS: Record<ExportFormat, string> = {
  hex: 'Hex list — the palette, one per line',
  css: 'CSS custom properties — palette and scale',
  scss: 'SCSS variables — palette and scale',
  tailwind: 'Tailwind colors — the 50 to 950 scale',
  json: 'JSON — everything, with contrast figures',
};

const EXPORT_NAMES: Record<ExportFormat, string> = {
  hex: 'palette.txt',
  css: 'palette.css',
  scss: 'palette.scss',
  tailwind: 'palette.js',
  json: 'palette.json',
};

/**
 * Rounds for display, then drops the padding: 100 reads as `100` and 59.63 as
 * `59.6`. Truncating everything to whole numbers would be tidier and slightly
 * wrong — a hex to HSL to hex round trip through integer percentages comes back a
 * shade off, and these values get pasted into stylesheets.
 */
function decimal(value: number, places: number): string {
  const fixed = value.toFixed(places);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * Commas rather than the space-separated syntax CSS Color 4 prefers. Both are
 * valid in every browser of the last few years, but the comma form has been legal
 * since CSS 2, and this text is going into somebody else's stylesheet.
 */
function formatRgb(rgb: Rgb): string {
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

function formatHsl(hsl: Hsl): string {
  return `hsl(${decimal(hsl.h, 1)}, ${decimal(hsl.s, 1)}%, ${decimal(hsl.l, 1)}%)`;
}

/** HSV has no CSS function, so it is shown as bare figures rather than a fake one. */
function formatHsv(hsv: { h: number; s: number; v: number }): string {
  return `${decimal(hsv.h, 1)}°, ${decimal(hsv.s, 1)}%, ${decimal(hsv.v, 1)}%`;
}

function formatCmyk(cmyk: { c: number; m: number; y: number; k: number }): string {
  return `${decimal(cmyk.c, 1)}%, ${decimal(cmyk.m, 1)}%, ${decimal(cmyk.y, 1)}%, ${decimal(cmyk.k, 1)}%`;
}

/** Space separated, because `oklch()` has no comma form to fall back on. */
function formatOklch(oklch: { l: number; c: number; h: number }): string {
  return `oklch(${decimal(oklch.l * 100, 1)}% ${decimal(oklch.c, 3)} ${decimal(oklch.h, 1)})`;
}

type SeedBound = { ok: true; seed: number } | { ok: false };

/** Blank means the default rather than "unseeded": see the note about hydration. */
function seedBound(text: string): SeedBound {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, seed: DEFAULT_SEED };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SEED) return { ok: false };
  return { ok: true, seed: parsed };
}

function seen(rgb: Rgb, vision: Vision): Rgb {
  return vision === 'none' ? rgb : simulateColorBlindness(rgb, vision);
}

/** The rule name on its own, without the explanatory half of the label. */
function ruleName(kind: HarmonyKind): string {
  return HARMONY_LABELS[kind].split(' — ')[0];
}

/** Likewise for the vision labels, whose second half is a note about the cones. */
function visionName(kind: Exclude<Vision, 'none'>): string {
  return VISION_LABELS[kind].split(' — ')[0];
}

interface ExportInput {
  entries: readonly PaletteEntry[];
  scale: ReadonlyArray<{ step: number; hex: string }>;
  base: string;
  kind: HarmonyKind;
  seed: number;
  seeded: boolean;
}

/**
 * The palette as text, in whichever shape the caller asked for.
 *
 * Each one is valid where it claims to be: the CSS and SCSS blocks paste in whole,
 * and the Tailwind fragment says in a comment which key it belongs under rather
 * than pretending to be a complete config file.
 */
function exportText(format: ExportFormat, input: ExportInput): string {
  const { entries, scale, base, kind, seed, seeded } = input;
  const origin = seeded
    ? `${ruleName(kind)} from ${base}, seed ${seed}`
    : `${ruleName(kind)} from ${base}`;

  if (format === 'hex') return `${entries.map((entry) => entry.hex).join('\n')}\n`;

  if (format === 'css') {
    return [
      ':root {',
      `  /* Palette: ${origin} */`,
      ...entries.map((entry, position) => `  --color-${position + 1}: ${entry.hex};`),
      '',
      `  /* Scale from ${base} */`,
      ...scale.map((step) => `  --brand-${step.step}: ${step.hex};`),
      '}',
      '',
    ].join('\n');
  }

  if (format === 'scss') {
    return [
      `// Palette: ${origin}`,
      ...entries.map((entry, position) => `$color-${position + 1}: ${entry.hex};`),
      '',
      `// Scale from ${base}`,
      ...scale.map((step) => `$brand-${step.step}: ${step.hex};`),
      '',
    ].join('\n');
  }

  if (format === 'tailwind') {
    return [
      '// Add inside theme.extend.colors in your Tailwind config.',
      `// Scale from ${base}.`,
      'brand: {',
      ...scale.map((step) => `  ${step.step}: '${step.hex}',`),
      '},',
      '',
    ].join('\n');
  }

  // Not named `document`: shadowing a browser global in a client component is the
  // kind of thing that reads fine and breaks the next edit.
  const payload = {
    base,
    harmony: kind,
    seed: seeded ? seed : null,
    colors: entries.map((entry) => ({
      hex: entry.hex,
      name: entry.name,
      rgb: formatRgb(entry.rgb),
      hsl: formatHsl(entry.hsl),
      textColor: entry.textColor,
      contrastOnWhite: entry.contrastOnWhite,
      contrastOnBlack: entry.contrastOnBlack,
    })),
    scale: Object.fromEntries(scale.map((step) => [String(step.step), step.hex])),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Which steps of the ramp can hold body text.
 *
 * Derived rather than asserted. "600 and darker is safe" happens to be true for a
 * mid blue and false for a yellow, and a design system built on the wrong half of
 * that sentence is a lot of unreadable text.
 */
function scaleAdvice(steps: ReadonlyArray<{ step: number; hex: string }>): string {
  const rated = steps.map((entry) => {
    const parsed = parseColor(entry.hex);
    const rgb = parsed.ok ? parsed.rgb : BLACK;
    return {
      step: entry.step,
      onWhite: contrastRatio(rgb, WHITE),
      onBlack: contrastRatio(rgb, BLACK),
    };
  });
  // The ramp runs light to dark, so the lightest step that clears the threshold
  // against white is the start of the "and darker" range, and the darkest that
  // clears it against black ends the "and lighter" one.
  const forWhite = rated.find((entry) => entry.onWhite >= BODY_TEXT_RATIO);
  const passingOnBlack = rated.filter((entry) => entry.onBlack >= BODY_TEXT_RATIO);
  const forBlack = passingOnBlack.length === 0 ? null : passingOnBlack[passingOnBlack.length - 1];

  if (forWhite !== undefined && forBlack !== null) {
    return `Step ${forWhite.step} and darker clear 4.5 to 1 on white; step ${forBlack.step} and lighter clear it on black. The steps in between are background, border and fill colors rather than text colors.`;
  }
  if (forWhite !== undefined) {
    return `Step ${forWhite.step} and darker clear 4.5 to 1 on white. No step in this ramp is light enough for body text on black.`;
  }
  if (forBlack !== null) {
    return `Step ${forBlack.step} and lighter clear 4.5 to 1 on black. No step in this ramp is dark enough for body text on white.`;
  }
  return 'No step in this ramp clears 4.5 to 1 against either white or black, so none of them is a body text color.';
}

/** A pass or fail chip. The glyph and the word carry the meaning, not the color. */
function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium',
        ok
          ? 'border-success-border bg-success-subtle text-success-fg'
          : 'border-border bg-surface-sunken text-fg-muted',
      )}
    >
      <Icon name={ok ? 'check' : 'x'} size={12} label={ok ? 'Passes' : 'Fails'} />
      {label}
    </span>
  );
}

function Verdict({ against, verdict }: { against: string; verdict: ContrastVerdict }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-fg">
        <span className="font-medium">Against {against}: </span>
        <span className="tabular">{verdict.ratio.toFixed(2)} to 1</span>
      </p>
      <div className="flex flex-wrap gap-1">
        <Check ok={verdict.aaNormal} label="Body text" />
        <Check ok={verdict.aaLarge} label="Large text" />
        <Check ok={verdict.aaaNormal} label="AAA body" />
        <Check ok={verdict.aaUiComponent} label="Borders and icons" />
      </div>
      <p className="text-2xs text-fg-muted">{verdict.summary}</p>
    </div>
  );
}

interface FormatRowProps {
  term: string;
  value: string;
  /** Shown after the value and left out of the copy, so nobody pastes a caveat. */
  note?: string;
  target: string;
}

function FormatRow({ term, value, note, target }: FormatRowProps) {
  return (
    // `dl > div > dt + dd` is explicitly allowed, and it is the only way to get a
    // row wrapper without abandoning the description list semantics.
    <div className="flex items-center gap-2 border-b border-border-subtle py-1 last:border-b-0">
      <dt className="w-20 shrink-0 text-xs text-fg-muted">{term}</dt>
      <dd className="min-w-0 flex-1 break-words font-mono text-xs text-fg">
        {value}
        {note === undefined ? null : (
          <span className="ml-1 font-sans text-2xs text-fg-subtle">{note}</span>
        )}
      </dd>
      <CopyButton
        value={value}
        size="icon"
        variant="ghost"
        label={`Copy the ${term} value`}
        onCopied={() => toolTracker(SLUG).copied(target)}
      />
    </div>
  );
}

interface SwatchProps {
  entry: PaletteEntry;
  position: number;
  total: number;
  vision: Vision;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One swatch: a color block that selects it, and a label strip that does not sit
 * on the color. Two controls rather than one, because a copy button nested inside
 * a button is invalid HTML and unreachable by keyboard.
 */
function Swatch({ entry, position, total, vision, selected, onSelect }: SwatchProps) {
  const shown = rgbToHex(seen(entry.rgb, vision));
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border transition-colors',
        selected ? 'border-accent' : 'border-border-subtle',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Swatch ${position + 1} of ${total}, ${entry.hex}, nearest CSS name ${entry.name}`}
        className="relative block w-full"
      >
        {/* The color is data, so it cannot come from the token set. */}
        <span className="block h-16 w-full" style={{ backgroundColor: shown }} />
        {selected ? (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-subtle bg-surface text-accent shadow-sm">
            <Icon name="check" size={12} />
          </span>
        ) : null}
      </button>
      <div
        className={cn(
          'flex items-center gap-1 border-t px-1.5 py-1',
          selected ? 'border-accent-border bg-accent-subtle' : 'border-border-subtle bg-surface',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-2xs text-fg">{entry.hex}</p>
          <p className="truncate text-2xs text-fg-subtle">{entry.name}</p>
        </div>
        <CopyButton
          value={entry.hex}
          size="icon"
          variant="ghost"
          label={`Copy ${entry.hex}`}
          onCopied={() => toolTracker(SLUG).copied('swatch')}
        />
      </div>
    </div>
  );
}

/**
 * The eleven ramp steps.
 *
 * Six columns on a narrow screen rather than eleven: eleven blocks across 320px
 * leaves 25px each, which is a stripe, not a swatch. The hex is printed under each
 * block instead of on it, for the same contrast reason as the palette.
 */
function ScaleStrip({
  steps,
  vision,
}: {
  steps: ReadonlyArray<{ step: number; hex: string }>;
  vision: Vision;
}) {
  return (
    <ul className="grid grid-cols-6 gap-1 sm:grid-cols-11">
      {steps.map((entry) => {
        const parsed = parseColor(entry.hex);
        const shown = parsed.ok ? rgbToHex(seen(parsed.rgb, vision)) : entry.hex;
        return (
          <li key={entry.step} className="min-w-0">
            <span
              className="block h-10 w-full rounded-sm border border-border-subtle"
              style={{ backgroundColor: shown }}
            />
            <p className="tabular mt-1 text-center text-2xs font-medium text-fg-muted">
              {entry.step}
            </p>
            <p className="truncate text-center font-mono text-2xs text-fg-subtle">{entry.hex}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function ColorPaletteGeneratorTool() {
  const [baseText, setBaseText] = useState(DEFAULT_BASE);
  const [kind, setKind] = useState<HarmonyKind>('analogous');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [seedText, setSeedText] = useState('');
  const [vision, setVision] = useState<Vision>('none');
  const [format, setFormat] = useState<ExportFormat>('hex');
  const [selected, setSelected] = useState(0);

  const markStarted = useToolStarted(SLUG);

  const parsed = useMemo(() => parseColor(baseText), [baseText]);
  const baseRgb = parsed.ok ? parsed.rgb : null;
  // Falling back to the default keeps every downstream call working on a real
  // color while the field is mid-edit. Nothing derived from it is rendered until
  // `parsed.ok`, so the fallback is never shown as if it had been asked for.
  const baseHex = baseRgb === null ? DEFAULT_BASE : rgbToHex(baseRgb);

  const bound = seedBound(seedText);
  const seed = bound.ok ? bound.seed : DEFAULT_SEED;

  /** How many colors the rule supplies unaided. Anything past this is seeded. */
  const ruleSize = useMemo(
    () => (baseRgb === null ? 0 : harmony(baseRgb, kind).length),
    [baseRgb, kind],
  );
  const seeded = parsed.ok && count > ruleSize;

  const palette = useMemo(
    () => generatePalette({ base: baseHex, kind, count, seed }),
    [baseHex, kind, count, seed],
  );
  const scale = useMemo(() => (baseRgb === null ? [] : tailwindScale(baseRgb)), [baseRgb]);

  const entries = parsed.ok && palette.ok ? palette.colors : null;
  // Clamped rather than corrected in an effect: dragging the count down is not a
  // reason to re-render twice, and a derived index cannot go stale.
  const index = entries === null ? 0 : Math.min(selected, entries.length - 1);
  const current = entries === null ? null : entries[index];

  const exported = useMemo(
    () =>
      entries === null
        ? ''
        : exportText(format, { entries, scale, base: baseHex, kind, seed, seeded }),
    [entries, scale, format, baseHex, kind, seed, seeded],
  );

  const advice = useMemo(() => (scale.length === 0 ? '' : scaleAdvice(scale)), [scale]);

  const named = current === null ? null : nearestNamedColor(current.rgb);
  const onWhite = current === null ? null : assessContrast(current.rgb, WHITE);
  const onBlack = current === null ? null : assessContrast(current.rgb, BLACK);
  const ink = current === null ? null : bestTextColor(current.rgb);

  function began<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      markStarted();
      setter(value);
    };
  }

  function randomColor(): void {
    markStarted();
    const rng = cryptoRng();
    // Mid lightness and clear saturation — the same ranges the engine uses for its
    // own random base. A uniform random RGB triple is usually a muddy near-grey,
    // which tells you nothing about what the harmony rules do.
    setBaseText(rgbToHex(hslToRgb({ h: rng() * 360, s: 55 + rng() * 30, l: 42 + rng() * 22 })));
    setSelected(0);
  }

  const seedHint =
    count - ruleSize === 1
      ? `Optional. One swatch is more than ${ruleName(kind).toLowerCase()} supplies, and that one is derived from this seed. The same seed always gives the same swatch.`
      : `Optional. ${count - ruleSize} swatches are more than ${ruleName(kind).toLowerCase()} supplies, and those are derived from this seed. The same seed always gives the same swatches.`;

  return (
    <ToolWorkspace
      label="Color palette generator"
      intro="Every color, contrast figure and simulation on this page is worked out in your browser as you type. An unreleased palette never leaves the machine."
      error={palette.ok ? null : palette.error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Starting color"
          htmlFor={BASE_ID}
          hint={
            parsed.ok
              ? 'Hex, rgb(), hsl() or a CSS color name. Three, four, six and eight digit hex all work, with or without the #.'
              : parsed.error
          }
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-2">
            {/* A native picker, deliberately. It is the one control every platform
                already knows how to render well, including with a screen reader and
                an eyedropper, and no custom wheel matches that. */}
            <input
              id={PICKER_ID}
              type="color"
              value={baseHex}
              aria-label="Pick a starting color"
              onChange={(event) => began(setBaseText)(event.target.value)}
              className="h-10 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0"
            />
            <Input
              id={BASE_ID}
              value={baseText}
              invalid={!parsed.ok}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              maxLength={40}
              className="font-mono"
              aria-describedby={describedBy(BASE_ID, { hint: true })}
              onChange={(event) => began(setBaseText)(event.target.value)}
            />
            <Button
              variant="secondary"
              iconLeft="dice"
              onClick={randomColor}
              className="shrink-0"
            >
              Random
            </Button>
          </div>
        </Field>

        <Field label="Harmony rule" htmlFor={HARMONY_ID} hint={HARMONY_BLURBS[kind]}>
          <Select
            id={HARMONY_ID}
            value={kind}
            aria-describedby={describedBy(HARMONY_ID, { hint: true })}
            onChange={(event) => began(setKind)(event.target.value as HarmonyKind)}
          >
            {HARMONY_ORDER.map((option) => (
              <option key={option} value={option}>
                {HARMONY_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Swatches"
          htmlFor={COUNT_ID}
          hint={
            ruleSize === 0
              ? `Between ${MIN_COUNT} and ${MAX_COUNT}.`
              : `Between ${MIN_COUNT} and ${MAX_COUNT}. ${ruleName(kind)} supplies ${ruleSize} on its own.`
          }
          labelSuffix={<span className="tabular">{count}</span>}
        >
          <Slider
            id={COUNT_ID}
            min={MIN_COUNT}
            max={MAX_COUNT}
            step={1}
            value={count}
            aria-describedby={describedBy(COUNT_ID, { hint: true })}
            onChange={(event) => began(setCount)(Number(event.target.value))}
          />
        </Field>

        <Field
          label="Color vision preview"
          htmlFor={VISION_ID}
          hint={
            vision === 'none'
              ? 'Repaints the swatches as somebody with color blindness would see them. The values never change.'
              : VISION_NOTES[vision]
          }
        >
          <Select
            id={VISION_ID}
            value={vision}
            aria-describedby={describedBy(VISION_ID, { hint: true })}
            onChange={(event) => began(setVision)(event.target.value as Vision)}
          >
            {VISION_ORDER.map((option) => (
              <option key={option} value={option}>
                {VISION_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        {seeded ? (
          <Field
            label="Seed"
            htmlFor={SEED_ID}
            hint={seedHint}
            error={
              bound.ok ? undefined : `Enter a whole number from 0 to ${MAX_SEED}, or leave it empty.`
            }
          >
            <Input
              id={SEED_ID}
              value={seedText}
              numeric
              inputMode="numeric"
              maxLength={10}
              placeholder={String(DEFAULT_SEED)}
              invalid={!bound.ok}
              aria-describedby={describedBy(SEED_ID, { hint: true, error: !bound.ok })}
              onChange={(event) => began(setSeedText)(event.target.value)}
            />
          </Field>
        ) : null}

        {parsed.ok && parsed.alpha < 1 ? (
          <p className="flex gap-1.5 text-xs text-fg-muted sm:col-span-2">
            <Icon name="info" size={14} label="Note" className="mt-0.5 shrink-0" />
            <span>
              That color is {decimal(parsed.alpha * 100, 0)}% opaque. Transparency is dropped from
              the palette, because a harmony rule works on hue and lightness and an alpha channel
              would only be carried along unchanged.
            </span>
          </p>
        ) : null}
      </div>

      {entries === null || current === null || named === null ? (
        <EmptyState
          icon="palette"
          title="Waiting for a color it can read"
          description="The palette, the ramp and the contrast figures all start from the color above."
        />
      ) : (
        <div className="space-y-5">
          {vision === 'none' ? null : (
            <Alert variant="info" icon="eye" title={`Showing ${visionName(vision)}`}>
              The swatches and the ramp are repainted. Every hex, rgb and contrast figure below is
              the real color, so anything you copy is unaffected.
            </Alert>
          )}

          <section aria-labelledby={PALETTE_HEADING_ID} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={PALETTE_HEADING_ID} className="text-sm font-medium text-fg">
                {entries.length} colors, {ruleName(kind).toLowerCase()} from{' '}
                <span className="font-mono">{baseHex}</span>
              </h2>
              <CopyButton
                value={entries.map((entry) => entry.hex).join('\n')}
                label="Copy all hex"
                copiedLabel="All copied"
                onCopied={() => toolTracker(SLUG).copied('all-hex')}
              />
            </div>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {entries.map((entry, position) => (
                <li key={`${entry.hex}-${position}`}>
                  <Swatch
                    entry={entry}
                    position={position}
                    total={entries.length}
                    vision={vision}
                    selected={position === index}
                    onSelect={() => began(setSelected)(position)}
                  />
                </li>
              ))}
            </ul>

            <p className="text-xs text-fg-muted">
              Pick a swatch for every value it has and what it can safely be used for.
            </p>
          </section>

          <section aria-labelledby={DETAIL_HEADING_ID} className="space-y-3">
            <h2 id={DETAIL_HEADING_ID} className="text-sm font-medium text-fg">
              Swatch {index + 1} in every format
            </h2>

            <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="block h-10 w-10 shrink-0 rounded-md border border-border-subtle"
                    style={{ backgroundColor: current.hex }}
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-fg">{current.hex}</p>
                    <p className="text-2xs text-fg-subtle">
                      {vision === 'none' ? 'The real color' : 'As designed'}
                    </p>
                  </div>
                </div>

                {vision === 'none' ? null : (
                  <div className="flex items-center gap-2">
                    <Icon name="arrow-right" size={14} className="text-fg-subtle" />
                    <span
                      className="block h-10 w-10 shrink-0 rounded-md border border-border-subtle"
                      style={{ backgroundColor: rgbToHex(seen(current.rgb, vision)) }}
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-fg">
                        {rgbToHex(seen(current.rgb, vision))}
                      </p>
                      <p className="text-2xs text-fg-subtle">As seen</p>
                    </div>
                  </div>
                )}
              </div>

              <dl className="mt-3">
                <FormatRow term="Hex" value={current.hex} target="hex" />
                <FormatRow term="RGB" value={formatRgb(current.rgb)} target="rgb" />
                <FormatRow term="HSL" value={formatHsl(current.hsl)} target="hsl" />
                <FormatRow term="HSV" value={formatHsv(rgbToHsv(current.rgb))} target="hsv" />
                <FormatRow term="CMYK" value={formatCmyk(rgbToCmyk(current.rgb))} target="cmyk" />
                <FormatRow term="OKLCH" value={formatOklch(rgbToOklch(current.rgb))} target="oklch" />
                <FormatRow
                  term="CSS name"
                  value={named.name}
                  note={named.distance === 0 ? '(exact match)' : `(nearest, ${named.hex})`}
                  target="css-name"
                />
              </dl>

              <p className="mt-2 text-2xs text-fg-subtle">
                CMYK is a plain arithmetic conversion with no ink profile behind it. Send the hex to
                your printer, not these four numbers.
              </p>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 sm:p-4">
              {onWhite === null ? null : <Verdict against="white" verdict={onWhite} />}
              {onBlack === null ? null : <Verdict against="black" verdict={onBlack} />}
              {ink === null ? null : (
                <p className="text-xs text-fg-muted sm:col-span-2">
                  Text placed on this color should be{' '}
                  <span className="font-mono text-fg">{ink.color}</span>, which reaches{' '}
                  <span className="tabular text-fg">{ink.ratio.toFixed(2)} to 1</span>
                  {ink.ratio >= BODY_TEXT_RATIO
                    ? ' — enough for body text.'
                    : ' — short of 4.5 to 1, so keep it to large text or use this color as a fill only.'}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby={SCALE_HEADING_ID} className="space-y-3">
            <h2 id={SCALE_HEADING_ID} className="text-sm font-medium text-fg">
              A 50 to 950 ramp from the starting color
            </h2>
            <ScaleStrip steps={scale} vision={vision} />
            <p className="text-xs text-fg-muted">{advice}</p>
            <p className="text-2xs text-fg-subtle">
              Lightness is spaced in Oklab so the steps look evenly apart rather than being evenly
              apart in numbers. Where a step cannot hold the starting color&apos;s chroma, the
              chroma is reduced until it fits instead of the channels being clipped, which is what
              usually turns a bright hue grey at the ends.
            </p>
          </section>

          <section aria-labelledby={EXPORT_HEADING_ID} className="space-y-3">
            <h2 id={EXPORT_HEADING_ID} className="text-sm font-medium text-fg">
              Take it with you
            </h2>
            <Field label="Format" htmlFor={FORMAT_ID} className="sm:max-w-md">
              <Select
                id={FORMAT_ID}
                value={format}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
              >
                {EXPORT_ORDER.map((option) => (
                  <option key={option} value={option}>
                    {EXPORT_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <TextOutput
              slug={SLUG}
              id="palette-export"
              label={`The palette as ${EXPORT_NAMES[format]}`}
              value={exported}
              copyTarget={format}
              downloadName={EXPORT_NAMES[format]}
              rows={format === 'hex' ? 6 : 12}
              monospace
              footer="Nothing here was uploaded to produce it, so nothing has to be deleted afterwards."
            />
          </section>
        </div>
      )}
    </ToolWorkspace>
  );
}
