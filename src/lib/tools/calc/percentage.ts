/**
 * The percentage family. All seven of these live on one page behind tabs,
 * because they are the same mental model with a different unknown, and because
 * the phrase people search for ("percentage calculator") covers all of them.
 *
 * Two conventions hold across the file:
 *  - Results carry a full-precision `value` *and* a `display` string. Nothing
 *    is rounded on the way through a calculation; rounding happens once, at the
 *    point a number becomes text.
 *  - A `Step` is the operation on the left and its result on the right, so the
 *    page can render the working as a two-column table.
 */

import { display, displayPercent, fail, isRealNumber, roundTo, smartDecimals } from './round.ts';
import type { Explained, Failure } from './round.ts';

/** The direction the user picked. Validated at runtime: inputs arrive from URLs. */
export const PERCENT_DIRECTIONS = ['increase', 'decrease'] as const;
export type PercentDirection = (typeof PERCENT_DIRECTIONS)[number];

/** What a change turned out to be. `none` is a genuine, common answer. */
export type ChangeDirection = PercentDirection | 'none';

export interface PercentValue extends Explained {
  /** Full precision. Use this for further maths, never the display string. */
  value: number;
  /** `value` rounded for the page. */
  display: string;
}

export type PercentResult = ({ ok: true } & PercentValue) | Failure;

/**
 * First failing field wins, so the user is shown one actionable sentence rather
 * than a list. Guards against NaN and Infinity reaching any arithmetic.
 */
function invalid(fields: Array<[unknown, string]>): Failure | null {
  for (const [value, message] of fields) {
    if (!isRealNumber(value)) return fail(message);
  }
  return null;
}

function badDirection(direction: unknown): Failure | null {
  return (PERCENT_DIRECTIONS as readonly string[]).includes(direction as string)
    ? null
    : fail('Choose whether the change is an increase or a decrease.');
}
/** Decimals for an intermediate fraction such as 0.15, so it never shows as "0.2". */
function fractionDecimals(value: number): number {
  return Math.max(4, smartDecimals(value));
}

/* ------------------------------------------------------------------ *
 * 1. What is 15% of 200?
 * ------------------------------------------------------------------ */

export interface PercentOfInput {
  percent: number;
  of: number;
}

export function percentOf(input: PercentOfInput): PercentResult {
  const bad = invalid([
    [input.percent, 'Enter the percentage you want to find.'],
    [input.of, 'Enter the number you want a percentage of.'],
  ]);
  if (bad) return bad;

  const fraction = input.percent / 100;
  const value = fraction * input.of;
  const percentText = display(input.percent);
  const ofText = display(input.of);
  const fractionText = display(fraction, fractionDecimals(fraction));

  return {
    ok: true,
    value,
    display: display(value),
    formula: `${percentText}% of ${ofText} = (${percentText} ÷ 100) × ${ofText}`,
    steps: [
      { label: `${percentText} ÷ 100`, value: fractionText },
      { label: `${fractionText} × ${ofText}`, value: display(value) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 2. 12 is what percent of 60?
 * ------------------------------------------------------------------ */

export interface WhatPercentInput {
  value: number;
  of: number;
}

export function whatPercent(input: WhatPercentInput): PercentResult {
  const bad = invalid([
    [input.value, 'Enter the number you want expressed as a percentage.'],
    [input.of, 'Enter the total to compare it against.'],
  ]);
  if (bad) return bad;
  if (input.of === 0) {
    return fail('The total cannot be zero — nothing can be a percentage of zero.');
  }

  const ratio = input.value / input.of;
  const value = ratio * 100;
  const valueText = display(input.value);
  const ofText = display(input.of);

  return {
    ok: true,
    value,
    display: displayPercent(value),
    formula: `${valueText} ÷ ${ofText} × 100`,
    steps: [
      { label: `${valueText} ÷ ${ofText}`, value: display(ratio, fractionDecimals(ratio)) },
      { label: 'Multiply by 100', value: displayPercent(value) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 3. Percentage change: from 80 to 100 is a 25% increase.
 * ------------------------------------------------------------------ */

export interface PercentChangeInput {
  from: number;
  to: number;
}

export interface PercentChangeSuccess extends PercentValue {
  /** `value` without its sign, for phrasing like "a 25% increase". */
  magnitude: number;
  /** to − from, full precision. */
  change: number;
  changeDisplay: string;
  direction: ChangeDirection;
}

export type PercentChangeResult = ({ ok: true } & PercentChangeSuccess) | Failure;

/**
 * `value` is signed: a decrease is negative, which is what people expect to
 * paste into a spreadsheet.
 *
 * `from = 0` has no finite answer — going from nothing to something is an
 * infinite increase — so it is an error rather than `Infinity`. The one
 * exception is 0 → 0, which is reported as no change, because that is
 * unambiguously what happened even though 0 ÷ 0 is undefined.
 *
 * The denominator is |from|, not from. With a negative starting value the naive
 * (to − from) ÷ from flips the sign, so −50 → −25 would report as a 50%
 * *decrease* even though the number went up. Dividing by the magnitude keeps
 * "increase" meaning "went up", which is the only reading a user will accept.
 */
export function percentChange(input: PercentChangeInput): PercentChangeResult {
  const bad = invalid([
    [input.from, 'Enter the starting value.'],
    [input.to, 'Enter the value it changed to.'],
  ]);
  if (bad) return bad;

  const change = input.to - input.from;

  if (input.from === 0) {
    if (input.to === 0) {
      return {
        ok: true,
        value: 0,
        display: displayPercent(0),
        magnitude: 0,
        change: 0,
        changeDisplay: display(0),
        direction: 'none',
        formula: '0 → 0 is no change',
        steps: [{ label: 'Difference', value: display(0) }],
      };
    }
    return fail(
      'Percentage change cannot start from zero — an increase from nothing is infinite, not a percentage. Compare the two numbers directly instead.',
    );
  }
  const ratio = change / Math.abs(input.from);
  const value = ratio * 100;
  const direction: ChangeDirection = change === 0 ? 'none' : change > 0 ? 'increase' : 'decrease';
  const fromText = display(input.from);
  const toText = display(input.to);

  return {
    ok: true,
    value,
    display: displayPercent(value),
    magnitude: Math.abs(value),
    change,
    changeDisplay: display(change),
    direction,
    formula: `(${toText} − ${fromText}) ÷ |${fromText}| × 100`,
    steps: [
      { label: `${toText} − ${fromText}`, value: display(change) },
      { label: `${display(change)} ÷ ${display(Math.abs(input.from))}`, value: display(ratio, fractionDecimals(ratio)) },
      { label: 'Multiply by 100', value: displayPercent(value) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 4. Increase / decrease a number by a percentage.
 * ------------------------------------------------------------------ */

export interface ApplyPercentChangeInput {
  value: number;
  percent: number;
  direction: PercentDirection;
}

export interface AppliedChangeSuccess extends PercentValue {
  /** The amount added or taken off, signed. */
  change: number;
  changeDisplay: string;
  /** The multiplier applied: 1.2 for +20%, 0.8 for −20%. */
  factor: number;
}

export type AppliedChangeResult = ({ ok: true } & AppliedChangeSuccess) | Failure;

/**
 * A decrease of more than 100% produces a negative result. That is left as-is
 * rather than clamped: the arithmetic is correct, and silently flooring at zero
 * would hide a data-entry mistake from the user.
 */
export function applyPercentChange(input: ApplyPercentChangeInput): AppliedChangeResult {
  const bad =
    invalid([
      [input.value, 'Enter the number you want to change.'],
      [input.percent, 'Enter the percentage to apply.'],
    ]) ?? badDirection(input.direction);
  if (bad) return bad;

  const signed = input.direction === 'decrease' ? -input.percent : input.percent;
  const factor = 1 + signed / 100;
  // Computed as value + (value × p ÷ 100) rather than value × (1 + p ÷ 100).
  // The two are equal in exact arithmetic; the first form avoids the rounding
  // that makes 200 × 1.15 land on 229.99999999999997 in binary floating point.
  const change = (input.value * signed) / 100;
  const value = input.value + change;
  const valueText = display(input.value);
  const percentText = display(Math.abs(input.percent));
  const operator = signed < 0 ? '−' : '+';

  return {
    ok: true,
    value,
    display: display(value),
    change,
    changeDisplay: display(change),
    factor,
    formula: `${valueText} × (1 ${operator} ${percentText} ÷ 100)`,
    steps: [
      { label: `${display(signed)}% of ${valueText}`, value: display(change) },
      { label: 'Multiplier', value: display(factor, fractionDecimals(factor)) },
      { label: `${valueText} ${operator} ${display(Math.abs(change))}`, value: display(value) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 5. Reverse percentage — the one people get wrong.
 * ------------------------------------------------------------------ */

export interface ReversePercentageInput {
  /** The number *after* the change was applied. */
  result: number;
  percent: number;
  direction: PercentDirection;
}

export interface ReversePercentageSuccess extends PercentValue {
  /** How much of `result` was the change itself. */
  change: number;
  changeDisplay: string;
  factor: number;
}

export type ReversePercentageResult = ({ ok: true } & ReversePercentageSuccess) | Failure;

/**
 * "£120 after a 20% increase — what was it before?"
 *
 * The near-universal mistake is to take 20% off £120 and answer £96. The
 * original was multiplied by 1.2, so recovering it means dividing by 1.2, giving
 * £100. The steps returned here spell that out, because the explanation is the
 * reason someone opened this tab.
 */
export function reversePercentage(input: ReversePercentageInput): ReversePercentageResult {
  const bad =
    invalid([
      [input.result, 'Enter the amount you ended up with.'],
      [input.percent, 'Enter the percentage that was applied.'],
    ]) ?? badDirection(input.direction);
  if (bad) return bad;

  const signed = input.direction === 'decrease' ? -input.percent : input.percent;
  const factor = 1 + signed / 100;
  if (factor === 0) {
    return input.direction === 'decrease'
      ? fail('A 100% decrease takes any amount down to zero, so the original cannot be recovered.')
      : fail('A −100% increase takes any amount down to zero, so the original cannot be recovered.');
  }

  const value = input.result / factor;
  const change = input.result - value;
  const resultText = display(input.result);
  const percentText = display(Math.abs(input.percent));
  const operator = signed < 0 ? '−' : '+';

  return {
    ok: true,
    value,
    display: display(value),
    change,
    changeDisplay: display(change),
    factor,
    formula: `${resultText} ÷ (1 ${operator} ${percentText} ÷ 100)`,
    steps: [
      { label: 'Multiplier that was applied', value: display(factor, fractionDecimals(factor)) },
      { label: `${resultText} ÷ ${display(factor, fractionDecimals(factor))}`, value: display(value) },
      { label: 'Of which the change was', value: display(change) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 6. Percentage difference — not the same thing as percentage change.
 * ------------------------------------------------------------------ */

export interface PercentageDifferenceInput {
  a: number;
  b: number;
}

export interface PercentageDifferenceSuccess extends PercentValue {
  /** |a − b| */
  difference: number;
  differenceDisplay: string;
  /** (a + b) ÷ 2, the reference the difference is measured against. */
  mean: number;
}

export type PercentageDifferenceResult = ({ ok: true } & PercentageDifferenceSuccess) | Failure;

/**
 * Percentage *difference* vs percentage *change* — the distinction that sends
 * people in circles:
 *
 *  - Change is directional and has a baseline. 40 → 50 is a 25% increase
 *    (10 ÷ 40); 50 → 40 is a 20% decrease (10 ÷ 50). The two are not equal,
 *    because the denominator is whichever number came first.
 *  - Difference is symmetric and has no baseline. It divides by the mean of the
 *    two numbers, so 40 vs 50 is 22.22% (10 ÷ 45) whichever order you give
 *    them. Use it when neither number is "before".
 *
 * Always non-negative, and undefined when the mean is zero (a and b equal and
 * opposite), because there is then no scale to measure against.
 */
export function percentageDifference(input: PercentageDifferenceInput): PercentageDifferenceResult {
  const bad = invalid([
    [input.a, 'Enter the first number.'],
    [input.b, 'Enter the second number.'],
  ]);
  if (bad) return bad;

  const mean = (input.a + input.b) / 2;
  if (mean === 0) {
    return fail(
      'These two numbers average out to zero, so there is no scale to measure the difference against.',
    );
  }

  const difference = Math.abs(input.a - input.b);
  const ratio = difference / Math.abs(mean);
  const value = ratio * 100;

  return {
    ok: true,
    value,
    display: displayPercent(value),
    difference,
    differenceDisplay: display(difference),
    mean,
    formula: `|${display(input.a)} − ${display(input.b)}| ÷ ((${display(input.a)} + ${display(input.b)}) ÷ 2) × 100`,
    steps: [
      { label: 'Difference', value: display(difference) },
      { label: 'Average of the two', value: display(mean) },
      { label: `${display(difference)} ÷ ${display(Math.abs(mean))} × 100`, value: displayPercent(value) },
    ],
  };
}
/* ------------------------------------------------------------------ *
 * 7. Share of a total, with the column guaranteed to sum to 100%.
 * ------------------------------------------------------------------ */

export interface PercentageOfTotalInput {
  parts: number[];
  /** Decimals the shares are shown to. Default 2. */
  decimals?: number;
}

export interface Share {
  /** The part as supplied. */
  value: number;
  /** Exact share, full precision. */
  percent: number;
  /** Share nudged so the whole column sums to exactly 100. */
  roundedPercent: number;
  display: string;
  /** True when largest-remainder gave this row the spare 0.01. */
  adjusted: boolean;
}

export interface PercentageOfTotalSuccess extends Explained {
  total: number;
  shares: Share[];
}

export type PercentageOfTotalResult = ({ ok: true } & PercentageOfTotalSuccess) | Failure;
/**
 * Each part's share of the total, rounded so the column adds up to exactly 100%.
 *
 * Rounding each share independently is what produces the 33.33 + 33.33 + 33.33 =
 * 99.99 that makes a table look broken. The largest-remainder (Hare–Niemeyer)
 * method fixes it: floor every share to the target precision, count how many
 * hundredths are missing from 100, then hand them out one each to the rows with
 * the biggest discarded remainder. Ties go to the earlier row, so the output is
 * deterministic and a re-render never reshuffles the table.
 *
 * Negative parts are rejected. A "share of the total" is only meaningful when
 * the parts accumulate, and mixing signs produces shares above 100% or below 0%,
 * which would be worse than an error message.
 */
export function percentageOfTotal(input: PercentageOfTotalInput): PercentageOfTotalResult {
  const parts = input.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return fail('Enter at least one value to work out its share.');
  }
  if (parts.some((part) => !isRealNumber(part))) {
    return fail('Every value must be a number.');
  }
  if (parts.some((part) => part < 0)) {
    return fail('Every value must be zero or more — a share of a total cannot be negative.');
  }

  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total === 0) {
    return fail('The values add up to zero, so there is no total to take a share of.');
  }

  const decimals = Math.min(6, Math.max(0, Math.trunc(input.decimals ?? 2) || 0));
  const scale = 10 ** decimals;
  const targetUnits = Math.round(100 * scale);

  // Floor each share into integer units of 10^-decimals, keeping the remainder.
  // roundTo() first, so that 14.000000000000002 units does not floor to 13.
  const rows = parts.map((part, index) => {
    const percent = (part / total) * 100;
    const exactUnits = roundTo(percent * scale, 6);
    const units = Math.floor(exactUnits);
    return { index, part, percent, units, remainder: exactUnits - units, adjusted: false };
  });
  let spare = targetUnits - rows.reduce((sum, row) => sum + row.units, 0);
  const byRemainder = rows
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const row of byRemainder) {
    if (spare <= 0) break;
    row.units += 1;
    row.adjusted = true;
    spare -= 1;
  }

  const shares: Share[] = rows.map((row) => {
    const roundedPercent = row.units / scale;
    return {
      value: row.part,
      percent: row.percent,
      roundedPercent,
      display: displayPercent(roundedPercent, decimals),
      adjusted: row.adjusted,
    };
  });

  return {
    ok: true,
    total,
    shares,
    formula: `each value ÷ ${display(total)} × 100`,
    steps: [
      { label: 'Total', value: display(total) },
      { label: 'Rounded to', value: `${decimals} decimal place${decimals === 1 ? '' : 's'}` },
      {
        label: 'Adjusted so the column sums to 100%',
        value: shares.some((share) => share.adjusted) ? 'yes' : 'not needed',
      },
    ],
  };
}
