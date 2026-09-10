'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { AnswerCard, FactGrid, ShownWorking, type Fact } from '@/components/tool/CalcAnswer';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { EmptyState } from '@/components/ui/EmptyState';
import { describedBy, Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import {
  applyPercentChange,
  PERCENT_DIRECTIONS,
  percentChange,
  percentageDifference,
  percentageOfTotal,
  percentOf,
  reversePercentage,
  whatPercent,
  type PercentDirection,
  type Share,
} from '@/lib/tools/calc/percentage';
import {
  display,
  displayPercent,
  parseLooseNumber,
  type Step,
} from '@/lib/tools/calc/round';

/*
 * Percentage calculator — seven questions, one page.
 *
 * Decisions worth keeping:
 *
 * **Everything is computed during render.** No clock, no randomness, no effects:
 * each answer is a pure function of the fields, so the server render and the
 * first client render agree and the page arrives with a real worked example on
 * it rather than an empty shell.
 *
 * **Tabs, not a dropdown.** Seven modes hidden inside a select would hide the
 * feature. The strip scrolls on a narrow screen, which is the accepted cost. No
 * icons on the tabs: seven glyphs would widen the strip on the screens where it
 * is already tightest, and none of these seven questions has an obvious symbol.
 *
 * **A number that will not parse goes in the hint slot, never the error slot.**
 * `Field`'s error slot is a live region, and "-", "1." and "1," are all states a
 * number passes through on the way to being typed. The engines' own refusals —
 * a total of zero, a change measured from zero — are settled answers to complete
 * input, so those go to `ToolWorkspace`'s error, which does announce.
 *
 * **The list mode splits on lines, not on commas.** `parseLooseNumber` reads
 * "1,234" as 1234, so splitting a paste on commas would silently turn one value
 * into two. Newlines, tabs and semicolons are separators; commas are not.
 *
 * **An unreadable line stops the calculation instead of being dropped.** Every
 * share is a fraction of the total, so quietly ignoring one row would change all
 * the other percentages without saying so.
 *
 * **The difference mode also prints the change.** Confusing the two is the error
 * the page exists to prevent, so the answer people did not ask for is shown next
 * to the one they did.
 */

const SLUG = 'percentage-calculator';

const A_ID = 'pct-a';
const B_ID = 'pct-b';
const DIRECTION_ID = 'pct-direction';
const PARTS_ID = 'pct-parts';
const DECIMALS_ID = 'pct-decimals';
const ANSWER_HEADING_ID = 'pct-answer-heading';
const WORKING_HEADING_ID = 'pct-working-heading';

type Mode = 'of' | 'what' | 'change' | 'apply' | 'reverse' | 'difference' | 'share';

const MODE_ORDER: readonly Mode[] = [
  'of',
  'what',
  'change',
  'apply',
  'reverse',
  'difference',
  'share',
];

interface FieldSpec {
  label: string;
  hint: string;
  /** A `%` sign inside the field, for the box that holds a percentage. */
  percent?: boolean;
}

interface ModeSpec {
  /** Short enough to sit in a scrolling strip on a 320px screen. */
  tab: string;
  /** The question in full, restated above the fields. */
  question: string;
  a?: FieldSpec;
  b?: FieldSpec;
  direction?: boolean;
  list?: boolean;
}

const MODE_SPECS: Record<Mode, ModeSpec> = {
  of: {
    tab: '% of a number',
    question: 'What is X% of Y?',
    a: { label: 'Percentage', hint: 'The percentage you want to find.', percent: true },
    b: { label: 'Number', hint: 'The number to take that percentage of.' },
  },
  what: {
    tab: 'What percent',
    question: 'X is what percent of Y?',
    a: { label: 'Number', hint: 'The part you are measuring.' },
    b: { label: 'Total', hint: 'The whole it is part of. Cannot be zero.' },
  },
  change: {
    tab: '% change',
    question: 'What is the percentage change from X to Y?',
    a: { label: 'Starting value', hint: 'What it was before. Cannot be zero.' },
    b: { label: 'New value', hint: 'What it is now.' },
  },
  apply: {
    tab: 'Add or subtract',
    question: 'What is Y after adding or subtracting X%?',
    a: { label: 'Number', hint: 'The number to change.' },
    b: { label: 'Percentage', hint: 'How much to add or take off.', percent: true },
    direction: true,
  },
  reverse: {
    tab: 'Reverse %',
    question: 'What was the amount before X% was applied?',
    a: {
      label: 'Amount you ended up with',
      hint: 'The figure that already has the percentage in it.',
    },
    b: {
      label: 'Percentage applied',
      hint: 'The percentage that was applied to the original amount.',
      percent: true,
    },
    direction: true,
  },
  difference: {
    tab: '% difference',
    question: 'What is the percentage difference between two values?',
    a: { label: 'First number', hint: 'Order does not matter here.' },
    b: { label: 'Second number', hint: 'This measure is symmetric, so it has no baseline.' },
  },
  share: {
    tab: 'Share of a total',
    question: 'What share of the total is each item?',
    list: true,
  },
};

const TABS: TabDescriptor[] = MODE_ORDER.map((mode) => ({
  id: mode,
  label: MODE_SPECS[mode].tab,
}));

const DIRECTION_LABELS: Record<PercentDirection, string> = {
  increase: 'Increase — add the percentage',
  decrease: 'Decrease — take the percentage off',
};

/** Real figures, so the page arrives with a worked example instead of blanks. */
const DEFAULT_FIELDS: Record<Mode, { a: string; b: string }> = {
  of: { a: '15', b: '240' },
  what: { a: '36', b: '240' },
  change: { a: '40', b: '50' },
  apply: { a: '200', b: '15' },
  reverse: { a: '120', b: '20' },
  difference: { a: '40', b: '50' },
  share: { a: '', b: '' },
};

/** Three values whose exact shares need a rounding nudge to reach 100%. */
const DEFAULT_PARTS = '1250\n980\n770';

const DECIMAL_OPTIONS: readonly number[] = [0, 1, 2, 3, 4];
const DEFAULT_DECIMALS = 2;

/**
 * Splits a pasted list.
 *
 * Newlines, tabs and semicolons separate values; a comma never does, because
 * `parseLooseNumber` reads "1,234" as 1234 and splitting there would turn one
 * value into two without saying so.
 *
 * An unreadable entry stops the whole calculation rather than being skipped:
 * every share is a fraction of the total, so dropping a row would silently move
 * all the other percentages.
 */
function parseParts(text: string): { ok: true; values: number[] } | { ok: false; error: string } {
  const entries = text.split(/[\n\r\t;]+/);
  const values: number[] = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const value = parseLooseNumber(trimmed);
    if (value === null) {
      const shown = trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed;
      return {
        ok: false,
        error: `Value ${values.length + 1} reads “${shown}”, which is not a number. Put one value on each line.`,
      };
    }
    values.push(value);
  }

  if (values.length === 0) {
    return { ok: false, error: 'Enter at least one value, one on each line.' };
  }
  return { ok: true, values };
}

/**
 * What the page needs to render, flattened from seven differently-shaped engine
 * results so the JSX below has two branches instead of seven.
 *
 * `waiting` is a field that is mid-edit; `error` is a settled refusal from an
 * engine. Only the second one is announced.
 */
type Outcome =
  | { kind: 'waiting'; reason: string }
  | { kind: 'error'; error: string }
  | {
      kind: 'value';
      headline: string;
      sentence: string;
      facts: Fact[];
      /** Answers to the question next door, when getting the two mixed up is the risk. */
      notes: string[];
      formula: string;
      steps: Step[];
    }
  | {
      kind: 'share';
      total: string;
      count: number;
      shares: Share[];
      adjusted: boolean;
      formula: string;
      steps: Step[];
      table: string;
    };

interface ComputeInput {
  mode: Mode;
  a: string;
  b: string;
  direction: PercentDirection;
  parts: string;
  decimals: number;
}

/**
 * The first field that is not yet a number, so the message names the right box.
 * Only called when at least one of the two failed, so `aOk` settles which.
 */
function waitingFor(spec: ModeSpec, aOk: boolean): Outcome {
  const label = aOk ? (spec.b?.label ?? 'second number') : (spec.a?.label ?? 'first number');
  return { kind: 'waiting', reason: `Enter a number in “${label}” to see the answer.` };
}

function compute(input: ComputeInput): Outcome {
  const mode = input.mode;
  const spec = MODE_SPECS[mode];

  if (mode === 'share') {
    const parsed = parseParts(input.parts);
    if (!parsed.ok) return { kind: 'waiting', reason: parsed.error };

    const result = percentageOfTotal({ parts: parsed.values, decimals: input.decimals });
    if (!result.ok) return { kind: 'error', error: result.error };

    return {
      kind: 'share',
      total: display(result.total),
      count: result.shares.length,
      shares: result.shares,
      adjusted: result.shares.some((share) => share.adjusted),
      formula: result.formula,
      steps: result.steps,
      // Ungrouped figures on purpose: this block is for pasting into a
      // spreadsheet, and "1,250" arrives there as text in too many of them.
      table: [
        'Value\tShare (%)',
        ...result.shares.map(
          (share) => `${share.value}\t${share.roundedPercent.toFixed(input.decimals)}`,
        ),
      ].join('\n'),
    };
  }

  const a = parseLooseNumber(input.a);
  const b = parseLooseNumber(input.b);
  if (a === null || b === null) return waitingFor(spec, a !== null);

  const aText = display(a);
  const bText = display(b);
  const direction = input.direction;

  if (mode === 'of') {
    const result = percentOf({ percent: a, of: b });
    if (!result.ok) return { kind: 'error', error: result.error };
    return {
      kind: 'value',
      headline: result.display,
      sentence: `${aText}% of ${bText} is ${result.display}.`,
      facts: [
        { term: `1% of ${bText}`, value: display(b / 100) },
        { term: 'The remaining part', value: display(b - result.value) },
      ],
      notes: [],
      formula: result.formula,
      steps: result.steps,
    };
  }

  if (mode === 'what') {
    const result = whatPercent({ value: a, of: b });
    if (!result.ok) return { kind: 'error', error: result.error };
    return {
      kind: 'value',
      headline: result.display,
      sentence: `${aText} is ${result.display} of ${bText}.`,
      facts: [
        { term: 'The rest of the total', value: display(b - a) },
        { term: 'As a fraction', value: display(a / b, 6) },
      ],
      notes: [],
      formula: result.formula,
      steps: result.steps,
    };
  }

  if (mode === 'change') {
    const result = percentChange({ from: a, to: b });
    if (!result.ok) return { kind: 'error', error: result.error };
    const back = percentChange({ from: b, to: a });
    const notes: string[] = [];
    if (back.ok && back.direction !== 'none') {
      notes.push(
        `The other way round, ${bText} to ${aText}, is a ${displayPercent(back.magnitude)} ${back.direction}. The two are not mirror images, because each one divides by the value it started from.`,
      );
    }
    return {
      kind: 'value',
      headline: result.display,
      sentence:
        result.direction === 'none'
          ? `${aText} and ${bText} are the same, so nothing changed.`
          : `${aText} to ${bText} is a ${displayPercent(result.magnitude)} ${result.direction}.`,
      facts: [
        { term: 'Absolute change', value: result.changeDisplay },
        { term: 'Divided by', value: display(Math.abs(a)) },
      ],
      notes,
      formula: result.formula,
      steps: result.steps,
    };
  }

  if (mode === 'apply') {
    const result = applyPercentChange({ value: a, percent: b, direction });
    if (!result.ok) return { kind: 'error', error: result.error };
    const notes: string[] = [];
    if (result.factor !== 0) {
      notes.push(
        `Checking it backwards: ${result.display} ÷ ${display(result.factor, 6)} returns ${aText}.`,
      );
    }
    return {
      kind: 'value',
      headline: result.display,
      sentence: `${aText} ${direction === 'increase' ? 'plus' : 'minus'} ${bText}% is ${result.display}.`,
      facts: [
        {
          term: direction === 'increase' ? 'Amount added' : 'Amount taken off',
          value: display(Math.abs(result.change)),
        },
        { term: 'Multiplier', value: display(result.factor, 6) },
      ],
      notes,
      formula: result.formula,
      steps: result.steps,
    };
  }

  if (mode === 'reverse') {
    const result = reversePercentage({ result: a, percent: b, direction });
    if (!result.ok) return { kind: 'error', error: result.error };
    const notes: string[] = [
      direction === 'increase'
        ? `Taking ${bText}% off ${aText} instead would give ${display(a - (a * b) / 100)}, which is the usual mistake: the percentage belongs to the original amount, not to the total you have.`
        : `Adding ${bText}% to ${aText} instead would give ${display(a + (a * b) / 100)}, which is the usual mistake: the percentage belongs to the original amount, not to the reduced one.`,
      `The check: ${direction === 'increase' ? 'adding' : 'taking'} ${bText}% ${direction === 'increase' ? 'to' : 'off'} ${result.display} gives back ${aText}.`,
    ];
    return {
      kind: 'value',
      headline: result.display,
      sentence: `Before the ${bText}% ${direction}, the amount was ${result.display}.`,
      facts: [
        {
          term: direction === 'increase' ? 'The increase itself' : 'The reduction itself',
          value: display(Math.abs(result.change)),
        },
        { term: 'Multiplier that was applied', value: display(result.factor, 6) },
      ],
      notes,
      formula: result.formula,
      steps: result.steps,
    };
  }

  if (mode === 'difference') {
    const result = percentageDifference({ a, b });
    if (!result.ok) return { kind: 'error', error: result.error };
    const asChange = percentChange({ from: a, to: b });
    const notes: string[] = [];
    if (asChange.ok && asChange.direction !== 'none') {
      notes.push(
        `As a percentage change from ${aText} to ${bText} the answer would be ${displayPercent(asChange.magnitude)} instead. Change divides by the value you started from; difference divides by the average of the two, which is why it is the same in either order.`,
      );
    }
    return {
      kind: 'value',
      headline: result.display,
      sentence: `${aText} and ${bText} are ${result.display} apart, measured against their average of ${display(result.mean)}.`,
      facts: [
        { term: 'The gap', value: result.differenceDisplay },
        { term: 'Average of the two', value: display(result.mean) },
      ],
      notes,
      formula: result.formula,
      steps: result.steps,
    };
  }

  // `mode` is `never` at this point — every member of the union returned above.
  // A quiet prompt rather than a thrown error, so a mode added later without a
  // branch here degrades into an instruction instead of a broken page.
  return { kind: 'waiting', reason: 'Pick a question above to get started.' };
}

/**
 * The share table. The rounding column only appears when a nudge was actually
 * applied, so a clean set of figures is not decorated with an empty column, and
 * the marker carries a word rather than only a glyph.
 */
function ShareTable({ shares, adjusted }: { shares: Share[]; adjusted: boolean }) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Each value and its share of the total</caption>
      <thead>
        <tr className="border-b border-border text-2xs uppercase tracking-wide text-fg-muted">
          <th scope="col" className="py-1.5 text-left font-medium">
            Row
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Value
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Share
          </th>
          {adjusted ? (
            <th scope="col" className="py-1.5 pl-3 text-left font-medium">
              Rounding
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {shares.map((share, position) => (
          <tr key={`${position}-${share.value}`} className="border-b border-border-subtle last:border-b-0">
            <th scope="row" className="tabular py-1.5 text-left font-normal text-fg-subtle">
              {position + 1}
            </th>
            <td className="tabular py-1.5 text-right text-fg">{display(share.value)}</td>
            <td className="tabular py-1.5 text-right font-medium text-fg">{share.display}</td>
            {adjusted ? (
              <td className="py-1.5 pl-3 text-2xs text-fg-muted">
                {share.adjusted ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="plus" size={11} />
                    rounded up
                  </span>
                ) : null}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NOT_A_NUMBER =
  'Not a number yet. Digits, a decimal point, thousands separators and a currency symbol are all read fine.';

const PARTS_HINT =
  'One value on each line. A pasted spreadsheet column works, and tabs or semicolons separate values too — but a comma is read as a thousands separator, so 1,234 is one value.';

export function PercentageCalculatorTool() {
  const [mode, setMode] = useState<Mode>('of');
  const [fields, setFields] = useState<Record<Mode, { a: string; b: string }>>(DEFAULT_FIELDS);
  const [direction, setDirection] = useState<PercentDirection>('increase');
  const [parts, setParts] = useState(DEFAULT_PARTS);
  const [decimals, setDecimals] = useState(DEFAULT_DECIMALS);

  const markStarted = useToolStarted(SLUG);

  const spec = MODE_SPECS[mode];
  const current = fields[mode];

  const outcome = useMemo(
    () => compute({ mode, a: current.a, b: current.b, direction, parts, decimals }),
    [mode, current.a, current.b, direction, parts, decimals],
  );

  // Blank is not invalid: it is a field nobody has reached yet, and a red border
  // on an empty box reads as a telling-off rather than as information.
  const aInvalid = current.a.trim() !== '' && parseLooseNumber(current.a) === null;
  const bInvalid = current.b.trim() !== '' && parseLooseNumber(current.b) === null;
  const partsInvalid = parts.trim() !== '' && !parseParts(parts).ok;
  const waiting = outcome.kind === 'waiting' ? outcome.reason : null;

  function setField(key: 'a' | 'b', value: string): void {
    markStarted();
    setFields((previous) => {
      const next: Record<Mode, { a: string; b: string }> = { ...previous };
      next[mode] =
        key === 'a' ? { a: value, b: previous[mode].b } : { a: previous[mode].a, b: value };
      return next;
    });
  }

  return (
    <ToolWorkspace
      label="Percentage calculator"
      intro="Pick the question you actually have. Every answer comes with its working, and the arithmetic runs in this page — nothing you type is sent anywhere."
      error={outcome.kind === 'error' ? outcome.error : null}
    >
      <Tabs
        tabs={TABS}
        value={mode}
        onValueChange={(id) => {
          markStarted();
          setMode(id as Mode);
        }}
        ariaLabel="Which percentage question to answer"
      >
        <div className="space-y-5">
          <p className="text-sm font-medium text-fg">{spec.question}</p>

          {spec.list === true ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Values"
                htmlFor={PARTS_ID}
                hint={partsInvalid && waiting !== null ? waiting : PARTS_HINT}
                className="sm:col-span-2"
              >
                <Textarea
                  id={PARTS_ID}
                  value={parts}
                  rows={6}
                  monospace
                  spellCheck={false}
                  invalid={partsInvalid}
                  aria-describedby={describedBy(PARTS_ID, { hint: true })}
                  onChange={(event) => {
                    markStarted();
                    setParts(event.target.value);
                  }}
                />
              </Field>

              <Field
                label="Decimal places"
                htmlFor={DECIMALS_ID}
                hint="How precisely each share is shown. The column totals exactly 100% either way."
              >
                <Select
                  id={DECIMALS_ID}
                  value={String(decimals)}
                  aria-describedby={describedBy(DECIMALS_ID, { hint: true })}
                  onChange={(event) => {
                    markStarted();
                    setDecimals(Number(event.target.value));
                  }}
                >
                  {DECIMAL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {spec.a === undefined ? null : (
                <Field
                  label={spec.a.label}
                  htmlFor={A_ID}
                  hint={aInvalid ? NOT_A_NUMBER : spec.a.hint}
                >
                  <Input
                    id={A_ID}
                    value={current.a}
                    numeric
                    invalid={aInvalid}
                    autoComplete="off"
                    suffix={spec.a.percent === true ? '%' : undefined}
                    aria-describedby={describedBy(A_ID, { hint: true })}
                    onChange={(event) => setField('a', event.target.value)}
                  />
                </Field>
              )}

              {spec.b === undefined ? null : (
                <Field
                  label={spec.b.label}
                  htmlFor={B_ID}
                  hint={bInvalid ? NOT_A_NUMBER : spec.b.hint}
                >
                  <Input
                    id={B_ID}
                    value={current.b}
                    numeric
                    invalid={bInvalid}
                    autoComplete="off"
                    suffix={spec.b.percent === true ? '%' : undefined}
                    aria-describedby={describedBy(B_ID, { hint: true })}
                    onChange={(event) => setField('b', event.target.value)}
                  />
                </Field>
              )}

              {spec.direction === true ? (
                <Field
                  label="Direction"
                  htmlFor={DIRECTION_ID}
                  hint={
                    mode === 'reverse'
                      ? 'Which way the percentage moved the original amount.'
                      : 'Which way the percentage moves the number.'
                  }
                  className="sm:col-span-2"
                >
                  <Select
                    id={DIRECTION_ID}
                    value={direction}
                    aria-describedby={describedBy(DIRECTION_ID, { hint: true })}
                    onChange={(event) => {
                      markStarted();
                      setDirection(event.target.value as PercentDirection);
                    }}
                  >
                    {PERCENT_DIRECTIONS.map((option) => (
                      <option key={option} value={option}>
                        {DIRECTION_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          )}

          {outcome.kind === 'waiting' ? (
            <EmptyState
              icon="percent"
              title="Waiting on a number"
              description={outcome.reason}
            />
          ) : null}

          {outcome.kind === 'value' ? (
            <div className="space-y-5">
              <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
                <h2 id={ANSWER_HEADING_ID} className="sr-only">
                  Answer
                </h2>
                <AnswerCard
                  headline={outcome.headline}
                  sentence={outcome.sentence}
                  slug={SLUG}
                />

                <FactGrid facts={outcome.facts} />

                {outcome.notes.map((note) => (
                  <p key={note} className="flex items-start gap-1.5 text-xs text-fg-muted">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                    <span>{note}</span>
                  </p>
                ))}
              </section>

              <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
                <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
                  How that was worked out
                </h2>
                <ShownWorking formula={outcome.formula} steps={outcome.steps} slug={SLUG} />
              </section>
            </div>
          ) : null}

          {outcome.kind === 'share' ? (
            <div className="space-y-5">
              <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
                <h2 id={ANSWER_HEADING_ID} className="text-sm font-medium text-fg">
                  {outcome.count} values, totalling{' '}
                  <span className="tabular">{outcome.total}</span>
                </h2>
                <div className="rounded-lg border border-border bg-surface p-3 shadow-xs sm:p-4">
                  <ShareTable shares={outcome.shares} adjusted={outcome.adjusted} />
                </div>
              </section>

              <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
                <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
                  How that was worked out
                </h2>
                <ShownWorking formula={outcome.formula} steps={outcome.steps} slug={SLUG} />
              </section>

              <TextOutput
                slug={SLUG}
                id="pct-share-table"
                label="The same table, tab separated for a spreadsheet"
                value={outcome.table}
                copyTarget="share-table"
                downloadName="shares.tsv"
                rows={Math.min(14, outcome.count + 2)}
                monospace
                footer="Values are written without thousands separators, because too many spreadsheets import “1,250” as text."
              />
            </div>
          ) : null}
        </div>
      </Tabs>
    </ToolWorkspace>
  );
}
