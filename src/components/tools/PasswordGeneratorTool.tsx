'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import {
  DEFAULT_SYMBOLS,
  PASSWORD_LIMITS,
  WORDLIST,
  assessPassword,
  generatePassphrase,
  generatePassword,
  generatePasswords,
  generatePin,
  type StrengthReport,
} from '@/lib/tools/gen/password';

/**
 * ============================================================================
 * PASSWORD GENERATOR
 * ============================================================================
 * ── Why the first password is drawn in an effect ────────────────────────────
 * A `'use client'` component still renders once on the server, and bytes drawn
 * from `crypto` there are not the bytes the browser draws. React reports the
 * difference as a hydration error, so the result lives in state that starts as
 * `null` and is filled by an effect. One paint with an empty output area buys a
 * page that has a password on it before anyone has clicked anything.
 *
 * ── Why the engine's numbers are not restated here ──────────────────────────
 * Every range — 4 to 256 characters, 1 to 1,000 at a time, 2 to 24 words, 3 to
 * 12 digits — comes from `PASSWORD_LIMITS`, and every refusal is the sentence
 * the engine returned. A slider that offers a value the engine then rejects is
 * a page that looks broken, and a second copy of a bound is a copy that will
 * eventually disagree with the first.
 *
 * ── Why only one of the numeric controls has a slider ──────────────────────
 * Length runs to 256, so on a slider alone each pixel is worth more than one
 * character and landing on 32 is luck: it gets a slider for reach and a number
 * field for precision, both writing the same value. Words (2–24) and PIN digits
 * (3–12) are short enough that a slider covers every value, and a control that
 * cannot express an invalid value never has to refuse one. The batch count is a
 * field alone — a slider running to 1,000 would draw hundreds of passwords on
 * the way past, which is work nobody asked for.
 *
 * ── Why the generated entropy and the strength check stay apart ─────────────
 * For a generated password the figure is exact arithmetic on a uniform draw.
 * `assessPassword` is a heuristic for passwords whose origin is unknown, and it
 * penalises patterns — so a genuinely random draw that happens to contain a
 * dictionary word would score lower than its real strength. Showing both
 * numbers for one string would read as the page contradicting itself, so the
 * checker is a separate panel for passwords you already have, and it says so.
 *
 * ── Why the checker's input is masked and the generator's output is not ─────
 * The output exists to be read and copied; hiding it would add a click and
 * protect nothing. A password you already own is different: you may be typing
 * it in front of someone, so it is masked with a reveal toggle, the same
 * pattern as the JWT decoder's secret.
 *
 * ── Why a batch is offered for passwords and not for passphrases ────────────
 * `generatePasswords` owns the count validation and its sentence. There is no
 * equivalent for passphrases, so a batch there would mean writing a bound and a
 * refusal in this file — the drift this page is otherwise built to avoid.
 * ============================================================================
 */

const SLUG = 'password-generator';
const LENGTH_ID = 'password-length';
const LENGTH_NUMBER_ID = 'password-length-exact';
const COUNT_ID = 'password-count';
const SYMBOLS_ID = 'password-symbols';
const WORDS_ID = 'passphrase-words';
const SEPARATOR_ID = 'passphrase-separator';
const PIN_ID = 'pin-digits';
const CHECK_ID = 'password-check';
const HEADING_ID = 'password-result-heading';
const CHECK_HEADING_ID = 'password-check-heading';

/** Above this many, the batch stops being a list of rows and becomes text. */
const ROWS_MAX = 25;

type Mode = 'password' | 'passphrase' | 'pin';

const MODES: TabDescriptor[] = [
  { id: 'password', label: 'Password', icon: 'key' },
  { id: 'passphrase', label: 'Passphrase', icon: 'text' },
  { id: 'pin', label: 'PIN', icon: 'hash' },
];

const L = PASSWORD_LIMITS;

/**
 * How many equally likely results the settings could have produced.
 *
 * Easier to hold on to than a bit count: "one of about 4.7 × 10^21" says the
 * same thing as "72 bits" without asking anyone to think in logarithms. Exact
 * up to 2^53, where a double stops counting integers one at a time, and in
 * scientific form above it.
 */
function possibilities(bits: number): string {
  if (bits <= 0) return '1';
  if (bits <= 53) return Math.round(2 ** bits).toLocaleString('en-US');
  const log10 = (bits * Math.LN2) / Math.LN10;
  let exponent = Math.floor(log10);
  let mantissa = 10 ** (log10 - exponent);
  // Rounding 9.97 to one decimal gives 10.0, which is not how anyone writes it.
  if (mantissa >= 9.95) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa.toFixed(1)} × 10^${exponent}`;
}

/** Held inside the offered range so the slider thumb always has somewhere to be. */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Empty text reads as "nothing typed yet", which is not the same as zero. */
function typedNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

interface Settings {
  mode: Mode;
  length: number;
  count: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  customSymbols: string;
  excludeAmbiguous: boolean;
  excludeSimilarSymbols: boolean;
  noRepeats: boolean;
  requireEachSet: boolean;
  words: number;
  separator: string;
  capitalise: boolean;
  includeNumber: boolean;
  includeSymbol: boolean;
  pinDigits: number;
}

/** What the summary row above the result reports, when there is one to report. */
interface Strength {
  bits: number;
  poolSize: number;
  /** What the pool is counted in: characters for a password, words for a phrase. */
  poolNoun: string;
  /** True when `requireEachSet` makes `bits` an upper bound rather than the figure. */
  upperBound: boolean;
}

type Batch =
  | { ok: true; values: readonly string[]; strength: Strength | null }
  | { ok: false; error: string };

/**
 * One trip to the engine per settings change.
 *
 * Password mode asks for a single password first even when a batch is wanted,
 * because `generatePassword` is the one function that reports the pool size and
 * the entropy of the draw, and those belong to the settings rather than to any
 * particular password. It costs one extra draw and it means the figure on screen
 * is the engine's arithmetic rather than this file's guess at it.
 */
function makeBatch(settings: Settings): Batch {
  if (settings.mode === 'pin') {
    const pin = generatePin(settings.pinDigits);
    return pin.ok ? { ok: true, values: [pin.pin], strength: null } : pin;
  }

  if (settings.mode === 'passphrase') {
    const phrase = generatePassphrase({
      words: settings.words,
      separator: settings.separator,
      capitalise: settings.capitalise,
      includeNumber: settings.includeNumber,
      includeSymbol: settings.includeSymbol,
    });
    if (!phrase.ok) return phrase;
    return {
      ok: true,
      values: [phrase.passphrase],
      strength: {
        bits: phrase.entropyBits,
        poolSize: phrase.wordlistSize,
        poolNoun: 'words',
        upperBound: false,
      },
    };
  }

  const opts = {
    length: settings.length,
    lowercase: settings.lowercase,
    uppercase: settings.uppercase,
    digits: settings.digits,
    symbols: settings.symbols,
    customSymbols: settings.customSymbols,
    excludeAmbiguous: settings.excludeAmbiguous,
    excludeSimilarSymbols: settings.excludeSimilarSymbols,
    noRepeats: settings.noRepeats,
    requireEachSet: settings.requireEachSet,
  };

  const one = generatePassword(opts);
  if (!one.ok) return one;
  const strength: Strength = {
    bits: one.entropyBits,
    poolSize: one.poolSize,
    poolNoun: 'characters',
    upperBound: settings.requireEachSet,
  };
  if (settings.count === 1) return { ok: true, values: [one.password], strength };

  const many = generatePasswords(settings.count, opts);
  return many.ok ? { ok: true, values: many.passwords, strength } : many;
}

/** A refusal, in the engine's own words — they are already written for a person. */
function Problem({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-fg"
    >
      <Icon name="alert-circle" size={18} label="Problem" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
    </div>
  );
}

/**
 * One setting, on or off.
 *
 * The visible text is repeated into the Switch's `label`, which becomes its
 * `aria-label`: WCAG 2.5.3 asks that the accessible name contain the visible
 * one, and `aria-label` wins the name computation over a wrapping `<label>`.
 */
function Option({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('flex items-start gap-2.5', disabled && 'opacity-[0.55]')}>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        label={label}
        size="sm"
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {hint === undefined ? null : <span className="block text-xs text-fg-subtle">{hint}</span>}
      </div>
    </div>
  );
}

/** One value, given the room to be read off the screen. */
function Single({ value, onCopied }: { value: string; onCopied: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-sunken p-3 sm:flex-nowrap">
      {/* `break-all` rather than `truncate`: a 256-character password has to be
          fully visible to be checked, and no random string has a break point a
          word-wrap would find. */}
      <code className="min-w-0 flex-1 break-all font-mono text-base text-fg sm:text-lg">
        {value}
      </code>
      <CopyButton value={value} label="Copy" onCopied={onCopied} className="shrink-0" />
    </div>
  );
}

/** A short batch, one copyable row each. */
function Rows({ values, onCopied }: { values: readonly string[]; onCopied: () => void }) {
  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
      {values.map((value, index) => (
        <li key={`${index}-${value}`} className="flex items-center gap-2 px-3 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg" title={value}>
            {value}
          </code>
          {/* Numbered rather than read out in full: an icon-only button needs a
              name that tells it apart from the others, and a random string
              spoken aloud is not that. */}
          <CopyButton
            value={value}
            size="icon"
            label={`Copy number ${index + 1}`}
            copiedLabel={`Copied number ${index + 1}`}
            onCopied={onCopied}
          />
        </li>
      ))}
    </ul>
  );
}

/** One fact, in the row under a result. */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{term}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/**
 * Severity as a glyph and a word as well as a colour, per WCAG 1.4.1. The bar is
 * `aria-hidden` because the label beside it already says which band this is;
 * five announced `<div>`s would say it less well.
 */
const SCORES: Record<StrengthReport['score'], { fill: string; tone: string; icon: IconName }> = {
  0: { fill: 'bg-danger', tone: 'text-danger-fg', icon: 'alert-circle' },
  1: { fill: 'bg-danger', tone: 'text-danger-fg', icon: 'alert-circle' },
  2: { fill: 'bg-warning', tone: 'text-warning-fg', icon: 'alert-triangle' },
  3: { fill: 'bg-success', tone: 'text-success-fg', icon: 'check-circle' },
  4: { fill: 'bg-success', tone: 'text-success-fg', icon: 'check-circle' },
};

const SEGMENTS = [0, 1, 2, 3, 4];

/** The verdict on a password the user already has. */
function Report({ report }: { report: StrengthReport }) {
  const band = SCORES[report.score];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="flex flex-1 gap-1">
          {SEGMENTS.map((segment) => (
            <span
              key={segment}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                segment <= report.score ? band.fill : 'bg-border',
              )}
            />
          ))}
        </div>
        <p className={cn('flex shrink-0 items-center gap-1.5 text-sm font-medium', band.tone)}>
          <Icon name={band.icon} size={16} label="Rating" />
          {report.label}
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Fact term="Estimated entropy" value={`${report.entropyBits} bits`} />
        <Fact term="Guessed offline" value={report.crackTime} />
        <Fact term="Guessed through a login" value={report.crackTimeOnline} />
      </dl>

      {report.issues.length === 0 ? null : (
        <ul className="space-y-1.5 text-sm">
          {report.issues.map((issue) => (
            <li key={issue} className="flex gap-1.5 text-warning-fg">
              <Icon name="alert-triangle" size={14} label="Weakness" className="mt-1 shrink-0" />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}

      {report.strengths.length === 0 ? null : (
        <ul className="space-y-1.5 text-sm">
          {report.strengths.map((item) => (
            <li key={item} className="flex gap-1.5 text-success-fg">
              <Icon name="check-circle" size={14} label="In its favour" className="mt-1 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shared empty result. A literal `[]` here would be a new identity per render. */
const EMPTY_VALUES: readonly string[] = Object.freeze([]);

export function PasswordGeneratorTool() {
  const [mode, setMode] = useState<Mode>('password');
  const [lengthText, setLengthText] = useState(String(L.defaultLength));
  const [countText, setCountText] = useState('1');
  const [lowercase, setLowercase] = useState(true);
  const [uppercase, setUppercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [customSymbols, setCustomSymbols] = useState('');
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [excludeSimilarSymbols, setExcludeSimilarSymbols] = useState(false);
  const [noRepeats, setNoRepeats] = useState(false);
  const [requireEachSet, setRequireEachSet] = useState(false);
  const [words, setWords] = useState<number>(L.defaultWords);
  const [separator, setSeparator] = useState('-');
  const [capitalise, setCapitalise] = useState(false);
  const [includeNumber, setIncludeNumber] = useState(false);
  const [includeSymbol, setIncludeSymbol] = useState(false);
  const [pinDigits, setPinDigits] = useState<number>(L.defaultPin);
  const [check, setCheck] = useState('');
  const [reveal, setReveal] = useState(false);
  // Bumped by the button. Its only job is to be a dependency that changed, so
  // that asking again with every setting the same still draws new characters.
  const [nonce, setNonce] = useState(0);
  // `null` until the browser has generated something, which is the state every
  // server render is in. See the note at the top of this file.
  const [batch, setBatch] = useState<Batch | null>(null);
  const markStarted = useToolStarted(SLUG);

  /** `markStarted` fires once and is stable, so wrapping every setter is free. */
  function began<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      markStarted();
      setter(value);
    };
  }

  function selectMode(id: string): void {
    markStarted();
    if (id === 'password' || id === 'passphrase' || id === 'pin') setMode(id);
  }

  const typedLength = typedNumber(lengthText);
  const typedCount = typedNumber(countText);
  // The thumb needs somewhere to sit even while the number beside it says
  // something the engine will refuse, so it shows the nearest offered length.
  // Dragging then writes a valid number back and the refusal goes away.
  const sliderLength = clamp(typedLength, L.minLength, L.maxLength, L.defaultLength);
  const lengthInvalid =
    Number.isFinite(typedLength) &&
    (!Number.isInteger(typedLength) || typedLength < L.minLength || typedLength > L.maxLength);
  const countInvalid =
    Number.isFinite(typedCount) &&
    (!Number.isInteger(typedCount) || typedCount < 1 || typedCount > L.maxCount);

  // Typing is immediate; generating is one frame behind, so a long batch cannot
  // make the field it was typed into feel sticky.
  const deferredLength = useDeferredValue(typedLength);
  const deferredCount = useDeferredValue(typedCount);
  const settings = useMemo<Settings>(
    () => ({
      mode,
      length: deferredLength,
      count: deferredCount,
      lowercase,
      uppercase,
      digits,
      symbols,
      customSymbols,
      excludeAmbiguous,
      excludeSimilarSymbols,
      noRepeats,
      requireEachSet,
      words,
      separator,
      capitalise,
      includeNumber,
      includeSymbol,
      pinDigits,
    }),
    [
      mode,
      deferredLength,
      deferredCount,
      lowercase,
      uppercase,
      digits,
      symbols,
      customSymbols,
      excludeAmbiguous,
      excludeSimilarSymbols,
      noRepeats,
      requireEachSet,
      words,
      separator,
      capitalise,
      includeNumber,
      includeSymbol,
      pinDigits,
    ],
  );

  useEffect(() => {
    setBatch(makeBatch(settings));
  }, [settings, nonce]);

  // Memoised because the fallback is a *new* empty array on every render, and
  // an unstable `values` re-runs every memo and effect downstream of it — the
  // join below, and anything a future edit hangs off the same value.
  const values = useMemo(
    () => (batch !== null && batch.ok ? batch.values : EMPTY_VALUES),
    [batch],
  );
  const strength = batch !== null && batch.ok ? batch.strength : null;
  const failure = batch !== null && !batch.ok ? batch.error : null;
  const joined = useMemo(() => values.join('\n'), [values]);
  const checked = useDeferredValue(check);
  const assessed = useMemo(
    () => (checked.trim() === '' ? null : assessPassword(checked)),
    [checked],
  );

  const noun = mode === 'passphrase' ? 'passphrase' : mode === 'pin' ? 'PIN' : 'password';
  const heading =
    values.length === 1
      ? `Your ${noun}`
      : `${values.length.toLocaleString('en-US')} ${noun}s`;
  const status =
    values.length === 0
      ? ''
      : values.length === 1
        ? `A new ${noun} is ready`
        : `${values.length.toLocaleString('en-US')} new ${noun}s are ready`;

  const caveats: string[] = [];
  if (strength?.upperBound === true) {
    caveats.push(
      'Requiring at least one character from every kind makes the true figure fractionally lower than this, so treat it as an upper bound.',
    );
  }
  if (mode === 'passphrase' && (includeNumber || includeSymbol)) {
    caveats.push(
      'The added digit and symbol are not counted in the figure. They add a few bits at most, not the nine bits a whole extra word adds.',
    );
  }

  return (
    <ToolWorkspace label="Password generator" status={status}>
      <Tabs tabs={MODES} value={mode} onValueChange={selectMode} ariaLabel="What to generate">
        <div className="space-y-4">
          {mode === 'password' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Length"
                  htmlFor={LENGTH_ID}
                  hint={`${L.minLength} to ${L.maxLength} characters.`}
                  labelSuffix={
                    /* The exact value is editable rather than merely shown: the
                       slider covers 253 steps, so landing on 32 by dragging is
                       luck. Both controls write the same number. */
                    <Input
                      id={LENGTH_NUMBER_ID}
                      aria-label="Length in characters"
                      value={lengthText}
                      type="number"
                      min={L.minLength}
                      max={L.maxLength}
                      inputSize="sm"
                      invalid={lengthInvalid}
                      className="w-20 text-center"
                      onChange={(event) => began(setLengthText)(event.target.value)}
                    />
                  }
                >
                  <Slider
                    id={LENGTH_ID}
                    min={L.minLength}
                    max={L.maxLength}
                    step={1}
                    value={sliderLength}
                    onChange={(event) => began(setLengthText)(event.target.value)}
                  />
                </Field>

                <Field
                  label="How many"
                  htmlFor={COUNT_ID}
                  hint={`Up to ${L.maxCount.toLocaleString('en-US')} at a time.`}
                >
                  <Input
                    id={COUNT_ID}
                    value={countText}
                    type="number"
                    min={1}
                    max={L.maxCount}
                    invalid={countInvalid}
                    onChange={(event) => began(setCountText)(event.target.value)}
                  />
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">Which characters</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Option
                    checked={lowercase}
                    onChange={began(setLowercase)}
                    label="Lowercase"
                    hint="a to z"
                  />
                  <Option
                    checked={uppercase}
                    onChange={began(setUppercase)}
                    label="Uppercase"
                    hint="A to Z"
                  />
                  <Option checked={digits} onChange={began(setDigits)} label="Digits" hint="0 to 9" />
                  <Option
                    checked={symbols}
                    onChange={began(setSymbols)}
                    label="Symbols"
                    hint={DEFAULT_SYMBOLS}
                  />
                </div>
              </fieldset>

              {symbols ? (
                <Field
                  label="Use these symbols instead"
                  htmlFor={SYMBOLS_ID}
                  optional
                  hint="Printable characters only. Leave it empty to use the set listed above."
                >
                  <Input
                    id={SYMBOLS_ID}
                    value={customSymbols}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={DEFAULT_SYMBOLS}
                    className="font-mono"
                    onChange={(event) => began(setCustomSymbols)(event.target.value)}
                  />
                </Field>
              ) : null}

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">Fine tuning</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Option
                    checked={excludeAmbiguous}
                    onChange={began(setExcludeAmbiguous)}
                    label="No look-alike characters"
                    hint="Drops 0 O o I l 1 | ` for reading aloud or retyping."
                  />
                  <Option
                    checked={excludeSimilarSymbols}
                    onChange={began(setExcludeSimilarSymbols)}
                    label="No shell-hostile symbols"
                    hint="Drops quotes, slashes and pipes that need escaping."
                    disabled={!symbols}
                  />
                  <Option
                    checked={noRepeats}
                    onChange={began(setNoRepeats)}
                    label="No repeated characters"
                    hint="Caps the length at the number of characters available."
                  />
                  <Option
                    checked={requireEachSet}
                    onChange={began(setRequireEachSet)}
                    label="At least one of each kind"
                    hint="For sites that insist. Makes the entropy figure an upper bound."
                  />
                </div>
              </fieldset>


            </div>
          ) : null}

          {mode === 'passphrase' ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Words"
                  htmlFor={WORDS_ID}
                  hint={`${L.minWords} to ${L.maxWords}. Each word is drawn from a list of ${WORDLIST.length.toLocaleString('en-US')} and adds exactly nine bits.`}
                  labelSuffix={<span className="tabular">{words}</span>}
                >
                  <Slider
                    id={WORDS_ID}
                    min={L.minWords}
                    max={L.maxWords}
                    step={1}
                    value={words}
                    onChange={(event) => began(setWords)(Number(event.target.value))}
                  />
                </Field>

                <Field
                  label="Between words"
                  htmlFor={SEPARATOR_ID}
                  hint={`Up to ${L.maxSeparatorLength} characters, or nothing at all.`}
                >
                  <Input
                    id={SEPARATOR_ID}
                    value={separator}
                    maxLength={L.maxSeparatorLength}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="-"
                    className="font-mono"
                    onChange={(event) => began(setSeparator)(event.target.value)}
                  />
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">Extras</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Option
                    checked={capitalise}
                    onChange={began(setCapitalise)}
                    label="Capitalise each word"
                    hint="Easier to read back. Adds no randomness."
                  />
                  <Option
                    checked={includeNumber}
                    onChange={began(setIncludeNumber)}
                    label="Add a digit"
                    hint="Onto one word, chosen at random."
                  />
                  <Option
                    checked={includeSymbol}
                    onChange={began(setIncludeSymbol)}
                    label="Add a symbol"
                    hint="For sites that demand one."
                  />
                </div>
              </fieldset>
            </div>
          ) : null}

          {mode === 'pin' ? (
            <div className="space-y-3">
              <Field
                label="Digits"
                htmlFor={PIN_ID}
                hint={`${L.minPin} to ${L.maxPin} digits.`}
                labelSuffix={<span className="tabular">{pinDigits}</span>}
              >
                <Slider
                  id={PIN_ID}
                  min={L.minPin}
                  max={L.maxPin}
                  step={1}
                  value={pinDigits}
                  onChange={(event) => began(setPinDigits)(Number(event.target.value))}
                />
              </Field>

              {/* Said plainly rather than dressed up: a PIN is weak arithmetic,
                  and the honest thing is to name the one condition that makes it
                  usable anyway. */}
              <p className="flex gap-1.5 text-sm text-fg-muted">
                <Icon name="info" size={16} label="Note" className="mt-0.5 shrink-0" />
                <span>
                  There are {(10 ** pinDigits).toLocaleString('en-US')} possible {pinDigits}-digit
                  PINs, which is few enough that one is only safe where something limits how many
                  guesses are allowed. Nothing here filters out 1234 or 1111 — removing patterns
                  would shrink the set and make everything left in it slightly easier to guess.
                </span>
              </p>
            </div>
          ) : null}

          {failure === null ? null : <Problem message={failure} />}

          {values.length === 0 ? null : values.length > ROWS_MAX ? (
            <TextOutput
              slug={SLUG}
              id="password-batch"
              label={heading}
              value={joined}
              copyTarget="batch"
              downloadName={`${noun}s.txt`}
              rows={12}
              monospace
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>A plain text file of passwords is worth deleting once it has been used.</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="refresh"
                    onClick={() => {
                      markStarted();
                      setNonce((value) => value + 1);
                    }}
                  >
                    Generate again
                  </Button>
                </div>
              }
            />
          ) : (
            <section aria-labelledby={HEADING_ID} className="space-y-2">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={HEADING_ID} className="text-sm font-medium text-fg">
                  {heading}
                </h2>
                <div className="flex items-center gap-1">
                  {values.length > 1 ? (
                    <CopyButton
                      value={joined}
                      label="Copy all"
                      copiedLabel="Copied all"
                      variant="ghost"
                      onCopied={() => toolTracker(SLUG).copied('batch')}
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft="refresh"
                    onClick={() => {
                      markStarted();
                      setNonce((value) => value + 1);
                    }}
                  >
                    Generate again
                  </Button>
                </div>
              </header>

              {values.length === 1 ? (
                <Single value={values[0]} onCopied={() => toolTracker(SLUG).copied('single')} />
              ) : (
                <Rows values={values} onCopied={() => toolTracker(SLUG).copied('single')} />
              )}
            </section>
          )}

          {strength === null ? null : (
            <div className="space-y-2">
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Fact
                  term="Entropy"
                  value={`${strength.bits} bits${strength.upperBound ? ' at most' : ''}`}
                />
                <Fact
                  term="Drawn from"
                  value={`${strength.poolSize.toLocaleString('en-US')} ${strength.poolNoun}`}
                />
                <Fact term="Equally likely results" value={possibilities(strength.bits)} />
              </dl>

              {caveats.map((caveat) => (
                <p key={caveat} className="flex gap-1.5 text-xs text-fg-muted">
                  <Icon name="info" size={14} label="Note" className="mt-0.5 shrink-0" />
                  <span>{caveat}</span>
                </p>
              ))}
            </div>
          )}




        </div>
      </Tabs>

      <section
        aria-labelledby={CHECK_HEADING_ID}
        className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4"
      >
        <div className="space-y-1">
          <h2 id={CHECK_HEADING_ID} className="text-sm font-medium text-fg">
            Check a password you already have
          </h2>
          <p className="text-sm text-fg-muted">
            This scores a password whose origin is unknown, so it looks for the things that make a
            long password guessable anyway: dictionary words, keyboard runs, a repeated character, a
            year on the end. The figure above a generated password is different — that one is exact
            arithmetic on a uniform draw, and it needs no guessing at all. Typing here makes no
            network request, which you can confirm in your browser’s developer tools.
          </p>
        </div>

        <Field label="Password to check" htmlFor={CHECK_ID} optional>
          <Input
            id={CHECK_ID}
            value={check}
            type={reveal ? 'text' : 'password'}
            iconLeft="lock"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              markStarted();
              setCheck(event.target.value);
            }}
            suffix={
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-label={reveal ? 'Hide the password' : 'Show the password'}
                className="rounded p-1 text-fg-subtle transition-colors duration-fast hover:text-fg"
              >
                <Icon name={reveal ? 'eye-off' : 'eye'} size={18} />
              </button>
            }
          />
        </Field>

        {assessed === null ? null : <Report report={assessed} />}
      </section>

    </ToolWorkspace>
  );
}

