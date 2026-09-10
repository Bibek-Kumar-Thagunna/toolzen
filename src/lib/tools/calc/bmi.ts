/**
 * Body mass index: weight ÷ height², plus the figures people actually came for
 * — which band the number falls in, what the healthy range weighs at their
 * height, and how far from it they are.
 *
 * BMI is a ratio, not a diagnosis, and this module is careful never to imply
 * otherwise. A `note` travels on every result saying so in plain words, and
 * nothing here offers advice: the tool reports arithmetic and the WHO's own
 * published band names, and stops there.
 *
 * Two conventions worth stating up front:
 *  - The BMI is rounded to two decimals *before* it is classified, so the number
 *    on the page and the band beside it can never disagree. A raw 24.998 shows
 *    as 25.00, and 25.00 is what gets classified.
 *  - Weight becomes kilograms and height becomes metres at the edge of the
 *    module. Everything after that is metric, so there is exactly one place a
 *    pound or a stone can be got wrong.
 */

import { display, fail, isRealNumber, roundTo } from './round.ts';
import type { Explained, Failure, Step } from './round.ts';

/** WHO adult band, thinnest to heaviest. */
export type BmiCategory =
  | 'underweight-severe'
  | 'underweight-moderate'
  | 'underweight-mild'
  | 'normal'
  | 'overweight'
  | 'obese-1'
  | 'obese-2'
  | 'obese-3';

export interface BmiBand {
  category: BmiCategory;
  label: string;
  /** Inclusive. */
  min: number;
  /** Exclusive. */
  max: number;
}

/**
 * The WHO adult cut-offs — 16, 17, 18.5, 25, 30, 35, 40 — carrying the WHO's own
 * band names rather than the friendlier ones most calculators substitute.
 * "Pre-obese" is the WHO's word for the band a shop-front tool calls
 * "overweight", so the label carries both and neither is invented.
 *
 * `min` is inclusive and `max` exclusive: a BMI of exactly 25.00 is pre-obese
 * and 24.99 is normal. The top band is open-ended, so its `max` is
 * POSITIVE_INFINITY. `formatNumber` renders any non-finite number as an em dash,
 * so a UI that formats it without thinking still shows something sane, but the
 * intended rendering is "40 and above".
 *
 * These are *adult* bands. A child's or teenager's BMI has to be read against
 * age-and-sex percentile charts, because the same number means different things
 * at 8 and at 38. This tool does not attempt those charts.
 */
export const BMI_BANDS: ReadonlyArray<BmiBand> = [
  { category: 'underweight-severe', label: 'Severe thinness', min: 0, max: 16 },
  { category: 'underweight-moderate', label: 'Moderate thinness', min: 16, max: 17 },
  { category: 'underweight-mild', label: 'Mild thinness', min: 17, max: 18.5 },
  { category: 'normal', label: 'Normal range', min: 18.5, max: 25 },
  { category: 'overweight', label: 'Pre-obese (overweight)', min: 25, max: 30 },
  { category: 'obese-1', label: 'Obese class I', min: 30, max: 35 },
  { category: 'obese-2', label: 'Obese class II', min: 35, max: 40 },
  { category: 'obese-3', label: 'Obese class III', min: 40, max: Number.POSITIVE_INFINITY },
];

/**
 * The healthy range is quoted as BMI 18.5 to 24.9, which is the figure every
 * public-health page uses. It is a hair narrower than the normal *band*, which
 * runs to just under 25, so a BMI between 24.9 and 25 sits in the normal band
 * while `weightToHealthyKg` still reports a few hundred grams to lose. Both
 * numbers are right; they answer slightly different questions.
 */
const HEALTHY_MIN_BMI = 18.5;
const HEALTHY_MAX_BMI = 24.9;

/** Plausible human ranges. Outside them the division still works but the answer means nothing. */
const MIN_HEIGHT_CM = 50;
const MAX_HEIGHT_CM = 275;
const MIN_WEIGHT_KG = 2;
const MAX_WEIGHT_KG = 650;

const KG_PER_LB = 0.45359237;
const KG_PER_ST = 6.35029318; // 14 lb
const CM_PER_IN = 2.54;
const CM_PER_FT = 30.48; // 12 in

/**
 * Shown with every result, and deliberately the first thing the copy says about
 * the number. Reading a population screening ratio as a verdict on one body is
 * the single most common mistake people make with BMI, so the caveat is part of
 * the result rather than small print underneath it.
 */
const NOTE =
  'BMI is a population-level screening ratio, not a diagnosis. It compares weight with height and nothing else, so it cannot tell muscle from fat and takes no account of age, sex, ethnicity or body composition. A very muscular person and a sedentary one can share the same BMI. It is not a substitute for an assessment by a health professional.';

const WEIGHT_UNITS = ['kg', 'lb', 'st'] as const;
export type BmiWeightUnit = (typeof WEIGHT_UNITS)[number];

const HEIGHT_UNITS = ['cm', 'm', 'in', 'ft'] as const;
export type BmiHeightUnit = (typeof HEIGHT_UNITS)[number];

export interface BmiInput {
  weight: number;
  height: number;
  /** Default 'kg'. 'st' is stones, as a decimal: 11.5 means eleven and a half stones. */
  weightUnit?: BmiWeightUnit;
  /**
   * Default 'cm'. 'ft' takes a *decimal* number of feet, so 5 ft 9 in is 5.75
   * (because 9 ÷ 12 = 0.75) and never 5.9. A UI that collects feet and inches in
   * two boxes should do that division itself before calling in.
   */
  heightUnit?: BmiHeightUnit;
}

const KG_PER_WEIGHT_UNIT: Readonly<Record<BmiWeightUnit, number>> = {
  kg: 1,
  lb: KG_PER_LB,
  st: KG_PER_ST,
};

const CM_PER_HEIGHT_UNIT: Readonly<Record<BmiHeightUnit, number>> = {
  cm: 1,
  m: 100,
  in: CM_PER_IN,
  ft: CM_PER_FT,
};

/**
 * The weight that produces a given BMI at a given height — the BMI formula
 * inverted, and what draws the "healthy weight for your height" row.
 *
 * Rounded to two decimals, because 10 g is finer than anyone weighs to and
 * because it means this function and the healthy range on a result agree
 * exactly rather than approximately.
 *
 * The signature cannot fail, so unusable input returns 0 rather than NaN: a band
 * table built from this can render an empty cell but never "NaN kg".
 */
export function bmiForHeight(heightCm: number, bmi: number): number {
  if (!isRealNumber(heightCm) || !isRealNumber(bmi)) return 0;
  if (heightCm <= 0 || bmi <= 0) return 0;
  const metres = heightCm / 100;
  return roundTo(bmi * metres * metres, 2);
}

export interface HealthyWeightRange {
  minKg: number;
  maxKg: number;
  minLb: number;
  maxLb: number;
}

export interface BmiResult extends Explained {
  /** Rounded to two decimals: the number shown, and the number classified. */
  bmi: number;
  category: BmiCategory;
  /** The WHO's wording for the band. */
  categoryLabel: string;
  /** What BMI 18.5 to 24.9 weighs at this height. */
  healthyWeightRange: HealthyWeightRange;
  /**
   * Kilograms between the weight given and the nearest edge of that range,
   * signed: negative to lose, positive to gain. `null` when the weight is
   * already inside the range — that is the answer, not a missing value.
   */
  weightToHealthyKg: number | null;
  /** BMI ÷ 25, so 1.00 sits exactly on the top of the normal band. */
  bmiPrime: number;
  /** Weight ÷ height³, in kg/m³. Less height-biased than BMI at the extremes. */
  ponderalIndex: number;
  /** What BMI is and is not. Render it with the result, not behind a tooltip. */
  note: string;
}

/** The band a rounded BMI falls in. */
function bandFor(bmi: number): BmiBand {
  const found = BMI_BANDS.find((band) => bmi < band.max);
  // Unreachable: the top band's max is Infinity, so any real BMI matches.
  return found ?? BMI_BANDS[BMI_BANDS.length - 1];
}

/** "18.5 to under 25", or "40 and above" for the open-ended top band. */
function bandRangeText(band: BmiBand): string {
  return Number.isFinite(band.max)
    ? `${display(band.min)} to under ${display(band.max)}`
    : `${display(band.min)} and above`;
}

/**
 * Units arrive from a query string as often as from a form, so an unrecognised
 * one is a real case rather than a type-system impossibility. `undefined` means
 * "not supplied" and takes the default.
 */
function pickUnit<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T | null {
  if (value === undefined) return fallback;
  return (allowed as readonly string[]).includes(value as string) ? (value as T) : null;
}

/** First failing field wins, so the reader gets one actionable sentence. */
function validateWeight(weight: number, kg: number): Failure | null {
  if (!isRealNumber(weight)) return fail('Enter your weight.');
  if (weight <= 0) return fail('Your weight must be more than zero.');
  if (kg < MIN_WEIGHT_KG) {
    return fail(
      `That weight is lighter than this calculator can work with. Enter at least ${display(MIN_WEIGHT_KG)} kg, which is about 4 lb.`,
    );
  }
  if (kg > MAX_WEIGHT_KG) {
    return fail(
      `That weight is heavier than this calculator can work with. Enter ${display(MAX_WEIGHT_KG)} kg or less, which is about 102 stones.`,
    );
  }
  return null;
}

function validateHeight(height: number, cm: number): Failure | null {
  if (!isRealNumber(height)) return fail('Enter your height.');
  if (height <= 0) return fail('Your height must be more than zero.');
  if (cm < MIN_HEIGHT_CM) {
    return fail(
      `That height is shorter than this calculator can work with. Enter at least ${display(MIN_HEIGHT_CM)} cm, which is about 1 ft 8 in.`,
    );
  }
  if (cm > MAX_HEIGHT_CM) {
    return fail(
      `That height is taller than this calculator can work with. Enter ${display(MAX_HEIGHT_CM)} cm or less, which is about 9 ft.`,
    );
  }
  return null;
}

interface StepContext {
  input: BmiInput;
  weightUnit: BmiWeightUnit;
  heightUnit: BmiHeightUnit;
  kg: number;
  metres: number;
  bmi: number;
  band: BmiBand;
  range: HealthyWeightRange;
  weightToHealthyKg: number | null;
  bmiPrime: number;
  ponderalIndex: number;
}

/** The working, in the order someone would write it out on paper. */
function bmiSteps(context: StepContext): Step[] {
  const { input, weightUnit, heightUnit, kg, metres, bmi, band, range } = context;
  const kgText = display(roundTo(kg, 2));
  const metresText = display(metres, 4);
  const squaredText = display(metres * metres, 4);

  const steps: Step[] = [
    {
      label: 'Weight',
      value:
        weightUnit === 'kg'
          ? `${display(input.weight)} kg`
          : `${display(input.weight)} ${weightUnit} = ${kgText} kg`,
    },
    {
      label: 'Height',
      value:
        heightUnit === 'm'
          ? `${metresText} m`
          : `${display(input.height)} ${heightUnit} = ${metresText} m`,
    },
    { label: 'Height × height', value: squaredText },
    { label: `${kgText} ÷ ${squaredText}`, value: display(bmi, 2) },
    { label: 'WHO band', value: `${band.label} (${bandRangeText(band)})` },
    { label: 'BMI prime (BMI ÷ 25)', value: display(context.bmiPrime, 2) },
    { label: 'Ponderal index (weight ÷ height³)', value: `${display(context.ponderalIndex, 2)} kg/m³` },
    {
      label: `Healthy weight at ${metresText} m`,
      value:
        `${display(range.minKg, 2)} kg to ${display(range.maxKg, 2)} kg` +
        ` (${display(range.minLb, 2)} lb to ${display(range.maxLb, 2)} lb)`,
    },
  ];

  const delta = context.weightToHealthyKg;
  if (delta !== null) {
    steps.push({
      label: 'To reach that range',
      value: `${delta < 0 ? 'lose' : 'gain'} ${display(Math.abs(delta), 2)} kg`,
    });
  }
  return steps;
}

/**
 * The whole tool: BMI, its WHO band, the healthy weight range at that height and
 * the signed distance to it.
 *
 * The band is chosen from the *rounded* BMI, so the figure and the label always
 * tell the same story. Every reported weight is rounded to two decimals, so the
 * range and the "to reach that range" figure reconcile exactly.
 */
export function calculateBmi(input: BmiInput): { ok: true; result: BmiResult } | Failure {
  const weightUnit = pickUnit(input.weightUnit, WEIGHT_UNITS, 'kg');
  if (weightUnit === null) {
    return fail('Choose whether the weight is in kilograms, pounds or stones.');
  }
  const heightUnit = pickUnit(input.heightUnit, HEIGHT_UNITS, 'cm');
  if (heightUnit === null) {
    return fail('Choose whether the height is in centimetres, metres, inches or feet.');
  }

  const kg = input.weight * KG_PER_WEIGHT_UNIT[weightUnit];
  const cm = input.height * CM_PER_HEIGHT_UNIT[heightUnit];
  const bad = validateWeight(input.weight, kg) ?? validateHeight(input.height, cm);
  if (bad) return bad;

  const metres = cm / 100;
  const raw = kg / (metres * metres);
  if (!isRealNumber(raw)) {
    return fail('These numbers do not produce a BMI we can work out. Please check them and try again.');
  }

  const bmi = roundTo(raw, 2);
  const band = bandFor(bmi);
  const minKg = bmiForHeight(cm, HEALTHY_MIN_BMI);
  const maxKg = bmiForHeight(cm, HEALTHY_MAX_BMI);
  const range: HealthyWeightRange = {
    minKg,
    maxKg,
    minLb: roundTo(minKg / KG_PER_LB, 2),
    maxLb: roundTo(maxKg / KG_PER_LB, 2),
  };

  const roundedKg = roundTo(kg, 2);
  const weightToHealthyKg =
    roundedKg < minKg
      ? roundTo(minKg - roundedKg, 2)
      : roundedKg > maxKg
        ? roundTo(maxKg - roundedKg, 2)
        : null;

  const bmiPrime = roundTo(bmi / 25, 2);
  const ponderalIndex = roundTo(kg / (metres * metres * metres), 2);
  const context: StepContext = {
    input,
    weightUnit,
    heightUnit,
    kg,
    metres,
    bmi,
    band,
    range,
    weightToHealthyKg,
    bmiPrime,
    ponderalIndex,
  };

  return {
    ok: true,
    result: {
      bmi,
      category: band.category,
      categoryLabel: band.label,
      healthyWeightRange: range,
      weightToHealthyKg,
      bmiPrime,
      ponderalIndex,
      note: NOTE,
      formula: `${display(roundedKg)} kg ÷ (${display(metres, 4)} m × ${display(metres, 4)} m)`,
      steps: bmiSteps(context),
    },
  };
}
