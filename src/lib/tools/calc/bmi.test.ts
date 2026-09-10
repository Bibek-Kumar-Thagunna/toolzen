import test from 'node:test';
import assert from 'node:assert/strict';

import { BMI_BANDS, bmiForHeight, calculateBmi } from './bmi.ts';
import type { BmiCategory, BmiHeightUnit, BmiResult, BmiWeightUnit } from './bmi.ts';
import { roundTo } from './round.ts';
import type { Explained, Failure } from './round.ts';

type BmiOutcome = { ok: true; result: BmiResult } | Failure;

function expectOk(outcome: BmiOutcome): BmiResult {
  if (!outcome.ok) assert.fail(`expected success, got error: ${outcome.error}`);
  return outcome.result;
}

function expectFail(outcome: BmiOutcome): string {
  if (outcome.ok) assert.fail('expected a friendly error, got a result');
  return outcome.error;
}

/** Every engine owes the page a formula and at least one step, free of NaN. */
function assertExplained(value: Explained): void {
  assert.ok(value.formula.length > 0, 'formula must not be empty');
  assert.ok(value.steps.length > 0, 'at least one step of working is required');
  assert.ok(!/NaN|Infinity/.test(value.formula), `formula leaked a non-finite value: ${value.formula}`);
  for (const step of value.steps) {
    assert.ok(step.label.length > 0 && step.value.length > 0, 'steps must be fully populated');
    assert.ok(!/NaN|Infinity/.test(step.value), `step leaked a non-finite value: ${step.value}`);
    assert.ok(!/NaN|Infinity/.test(step.label), `label leaked a non-finite value: ${step.label}`);
  }
}

/** The headline case, and the number this module is judged on. */
test('calculateBmi: 70 kg at 175 cm is 22.86 and in the normal band', () => {
  const result = expectOk(calculateBmi({ weight: 70, height: 175 }));
  assert.equal(result.bmi, 22.86);
  assert.equal(result.category, 'normal');
  assert.equal(result.categoryLabel, 'Normal range');
  assert.equal(result.bmiPrime, roundTo(22.86 / 25, 2));
  assert.equal(result.ponderalIndex, 13.06);
  assert.equal(result.weightToHealthyKg, null, '70 kg is inside the healthy range at 1.75 m');
  assertExplained(result);
  assert.match(result.formula, /70 kg ÷ \(1\.75 m × 1\.75 m\)/);
});

test('the note says plainly that BMI is not a diagnosis', () => {
  const { note } = expectOk(calculateBmi({ weight: 70, height: 175 }));
  assert.match(note, /not a diagnosis/);
  assert.match(note, /population-level screening ratio/);
  assert.match(note, /muscle from fat/);
  assert.match(note, /age, sex, ethnicity or body composition/);
  assert.ok(!/you should|we recommend|try to lose|diet/i.test(note), 'the note must not give advice');
});

/** WHO adult cut-offs. `min` is inclusive, so the boundary belongs to the band above. */
const BOUNDARIES: ReadonlyArray<[number, BmiCategory, BmiCategory]> = [
  [16, 'underweight-moderate', 'underweight-severe'],
  [17, 'underweight-mild', 'underweight-moderate'],
  [18.5, 'normal', 'underweight-mild'],
  [25, 'overweight', 'normal'],
  [30, 'obese-1', 'overweight'],
  [35, 'obese-2', 'obese-1'],
  [40, 'obese-3', 'obese-2'],
];

test('every WHO band boundary lands in the band above it, and a hundredth below in the band under', () => {
  for (const [cutoff, atOrAbove, justBelow] of BOUNDARIES) {
    for (const heightCm of [150, 175, 190.5]) {
      const onIt = expectOk(calculateBmi({ weight: bmiForHeight(heightCm, cutoff), height: heightCm }));
      assert.equal(onIt.bmi, cutoff, `${cutoff} at ${heightCm} cm should round back to the cut-off`);
      assert.equal(onIt.category, atOrAbove, `BMI ${cutoff} at ${heightCm} cm`);

      const under = cutoff - 0.01;
      const below = expectOk(calculateBmi({ weight: bmiForHeight(heightCm, under), height: heightCm }));
      assert.equal(below.bmi, under, `${under} at ${heightCm} cm should round back to itself`);
      assert.equal(below.category, justBelow, `BMI ${under} at ${heightCm} cm`);
    }
  }
});

test('BMI_BANDS is a contiguous, labelled cover of every BMI', () => {
  assert.equal(BMI_BANDS.length, 8);
  assert.equal(BMI_BANDS[0]?.min, 0);
  assert.equal(BMI_BANDS[BMI_BANDS.length - 1]?.max, Number.POSITIVE_INFINITY);
  const seen = new Set<BmiCategory>();
  BMI_BANDS.forEach((band, index) => {
    assert.ok(band.label.length > 0, `band ${band.category} needs a label`);
    assert.ok(!seen.has(band.category), `duplicate band ${band.category}`);
    seen.add(band.category);
    if (index > 0) assert.equal(band.min, BMI_BANDS[index - 1]?.max, 'bands must not leave a gap');
    assert.ok(band.max > band.min, 'every band must be non-empty');
  });
});

const KG_PER_LB = 0.45359237;
const KG_PER_ST = 6.35029318;
const CM_PER_IN = 2.54;
const CM_PER_FT = 30.48;

test('pounds, stones, inches and decimal feet agree with the metric answer', () => {
  for (const [kg, cm] of [
    [70, 175],
    [52.3, 160],
    [113.4, 193],
    [45, 152.4],
  ]) {
    const metric = expectOk(calculateBmi({ weight: kg, height: cm })).bmi;
    const imperial = [
      calculateBmi({ weight: kg / KG_PER_LB, height: cm / CM_PER_IN, weightUnit: 'lb', heightUnit: 'in' }),
      calculateBmi({ weight: kg / KG_PER_ST, height: cm / CM_PER_FT, weightUnit: 'st', heightUnit: 'ft' }),
      calculateBmi({ weight: kg / KG_PER_LB, height: cm / 100, weightUnit: 'lb', heightUnit: 'm' }),
    ];
    for (const outcome of imperial) {
      assert.equal(expectOk(outcome).bmi, metric, `${kg} kg / ${cm} cm should agree to 2dp`);
    }
  }
});

test('5.75 ft is 5 ft 9 in, not 5 ft 75 in', () => {
  const feet = expectOk(calculateBmi({ weight: 70, height: 5.75, heightUnit: 'ft' }));
  const inches = expectOk(calculateBmi({ weight: 70, height: 69, heightUnit: 'in' }));
  assert.equal(feet.bmi, inches.bmi);
  assert.equal(feet.bmi, expectOk(calculateBmi({ weight: 70, height: 175.26 })).bmi);
});

test('healthyWeightRange round-trips through bmiForHeight', () => {
  for (const cm of [50, 152.4, 160, 175, 190.5, 275]) {
    const { healthyWeightRange: range } = expectOk(calculateBmi({ weight: 70, height: cm }));
    assert.equal(range.minKg, bmiForHeight(cm, 18.5));
    assert.equal(range.maxKg, bmiForHeight(cm, 24.9));
    assert.equal(range.minLb, roundTo(range.minKg / KG_PER_LB, 2));
    assert.equal(range.maxLb, roundTo(range.maxKg / KG_PER_LB, 2));
    assert.ok(range.minKg < range.maxKg, 'the range must run upwards');
  }
});

test('bmiForHeight cannot return NaN, even for nonsense input', () => {
  assert.equal(bmiForHeight(175, 25), 76.56);
  assert.equal(bmiForHeight(0, 25), 0);
  assert.equal(bmiForHeight(-175, 25), 0);
  assert.equal(bmiForHeight(175, 0), 0);
  assert.equal(bmiForHeight(Number.NaN, 25), 0);
  assert.equal(bmiForHeight(175, Number.POSITIVE_INFINITY), 0);
});

test('weightToHealthyKg is signed, and lands exactly on the edge of the range', () => {
  const heavy = expectOk(calculateBmi({ weight: 90, height: 175 }));
  assert.equal(heavy.category, 'overweight');
  assert.ok(heavy.weightToHealthyKg !== null && heavy.weightToHealthyKg < 0, 'negative means lose');
  assert.equal(roundTo(90 + (heavy.weightToHealthyKg ?? 0), 2), heavy.healthyWeightRange.maxKg);

  const light = expectOk(calculateBmi({ weight: 55, height: 175 }));
  assert.equal(light.category, 'underweight-mild');
  assert.ok(light.weightToHealthyKg !== null && light.weightToHealthyKg > 0, 'positive means gain');
  assert.equal(roundTo(55 + (light.weightToHealthyKg ?? 0), 2), light.healthyWeightRange.minKg);

  assert.equal(expectOk(calculateBmi({ weight: 60, height: 175 })).weightToHealthyKg, null);
});

test('implausible heights and weights are turned away with a sentence', () => {
  const cases: ReadonlyArray<[Parameters<typeof calculateBmi>[0], RegExp]> = [
    [{ weight: Number.NaN, height: 175 }, /^Enter your weight\.$/],
    [{ weight: 0, height: 175 }, /weight must be more than zero/],
    [{ weight: -70, height: 175 }, /weight must be more than zero/],
    [{ weight: 1.5, height: 175 }, /lighter than this calculator can work with/],
    [{ weight: 651, height: 175 }, /heavier than this calculator can work with/],
    [{ weight: 3, height: 175, weightUnit: 'lb' }, /lighter than/],
    [{ weight: 110, height: 175, weightUnit: 'st' }, /heavier than/],
    [{ weight: 70, height: Number.NaN }, /^Enter your height\.$/],
    [{ weight: 70, height: 0 }, /height must be more than zero/],
    [{ weight: 70, height: 49.9 }, /shorter than this calculator can work with/],
    [{ weight: 70, height: 276 }, /taller than this calculator can work with/],
    [{ weight: 70, height: 1, heightUnit: 'ft' }, /shorter than/],
    [{ weight: 70, height: 10, heightUnit: 'ft' }, /taller than/],
    [{ weight: 70, height: 1.75, weightUnit: 'stone' as BmiWeightUnit }, /kilograms, pounds or stones/],
    [{ weight: 70, height: 1.75, heightUnit: 'metres' as BmiHeightUnit }, /centimetres, metres, inches or feet/],
    [{ weight: 70, height: Number.POSITIVE_INFINITY }, /^Enter your height\.$/],
  ];
  for (const [input, pattern] of cases) {
    const message = expectFail(calculateBmi(input));
    assert.match(message, pattern, `input ${JSON.stringify(input)}`);
    assert.match(message, /\.$/, 'errors are complete sentences');
    assert.match(message, /^[A-Z]/, 'errors start like a sentence');
  }
});

test('the extremes of the accepted range still produce a usable answer', () => {
  for (const input of [
    { weight: 2, height: 50 },
    { weight: 650, height: 275 },
    { weight: 2, height: 275 },
    { weight: 650, height: 50 },
  ]) {
    const result = expectOk(calculateBmi(input));
    assert.ok(Number.isFinite(result.bmi) && result.bmi > 0);
    assert.ok(Number.isFinite(result.ponderalIndex) && Number.isFinite(result.bmiPrime));
    assertExplained(result);
  }
});
