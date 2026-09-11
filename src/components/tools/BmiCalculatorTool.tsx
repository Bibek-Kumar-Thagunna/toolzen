'use client';

/**
 * ============================================================================
 * BMI CALCULATOR
 * ============================================================================
 * A ratio, a band, and a clear statement of what the number is not.
 *
 * ── The caveat is part of the answer, not small print ─────────────────────
 * Almost every BMI calculator on the web prints a number, colours it red or
 * green, and leaves the reader to conclude that a machine has assessed their
 * health. BMI compares weight with height and nothing else: it cannot tell
 * muscle from fat, and it takes no account of age, sex, ethnicity or build. The
 * engine ships that sentence with every result, and this component renders it
 * directly under the headline rather than behind a tooltip.
 *
 * For the same reason there is no colour coding of the bands. A green figure and
 * a red figure are a verdict; a table with your row marked is information.
 *
 * ── Feet and inches are two boxes, not a decimal ──────────────────────────
 * The engine takes feet as a decimal — 5 ft 9 in is 5.75, not 5.9 — which is a
 * trap for anyone typing what they know. So when the unit is feet, the form
 * shows separate feet and inches boxes and does the division itself. This is
 * the single most common source of a wrong BMI on calculators that accept one
 * box for "height in feet".
 *
 * ── Nothing is computed in an effect ──────────────────────────────────────
 * The result is a pure function of the fields, so the page server-renders with
 * a worked example already on it. Someone arriving from a search sees a real
 * answer before any JavaScript has run.
 * ============================================================================
 */
import { useMemo, useState } from 'react';

import { AnswerCard, FactGrid, ShownWorking, type Fact } from '@/components/tool/CalcAnswer';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import {
  BMI_BANDS,
  calculateBmi,
  type BmiHeightUnit,
  type BmiWeightUnit,
} from '@/lib/tools/calc/bmi';
import { display, formatNumber, parseLooseNumber } from '@/lib/tools/calc/round';

const SLUG = 'bmi-calculator';

const WEIGHT_UNIT_LABELS: Record<BmiWeightUnit, string> = {
  kg: 'Kilograms (kg)',
  lb: 'Pounds (lb)',
  st: 'Stones (st)',
};

const HEIGHT_UNIT_LABELS: Record<BmiHeightUnit, string> = {
  cm: 'Centimetres (cm)',
  m: 'Metres (m)',
  ft: 'Feet and inches',
  in: 'Inches (in)',
};

/** The band's upper edge, with the open-ended top band written as words. */
function bandRange(min: number, max: number): string {
  if (!Number.isFinite(max)) return `${display(min)} and above`;
  if (min === 0) return `Under ${display(max)}`;
  // The bands are inclusive at the bottom and exclusive at the top, so the
  // printed upper figure is one hundredth below the cut-off — which is what
  // makes "24.9" and "25" land in different rows, as they should.
  return `${display(min)} – ${display(max - 0.1)}`;
}

export function BmiCalculatorTool() {
  // A worked example rather than empty boxes: the page is useful before it is
  // touched, and the first thing a visitor sees is a result, not a form.
  const [weight, setWeight] = useState('70');
  const [weightUnit, setWeightUnit] = useState<BmiWeightUnit>('kg');
  const [height, setHeight] = useState('170');
  const [heightUnit, setHeightUnit] = useState<BmiHeightUnit>('cm');
  const [feet, setFeet] = useState('5');
  const [inches, setInches] = useState('9');

  const markStarted = useToolStarted(SLUG);

  const outcome = useMemo(() => {
    const weightValue = parseLooseNumber(weight);
    if (weightValue === null) return { kind: 'incomplete' as const };

    let heightValue: number | null;
    if (heightUnit === 'ft') {
      // See the header: the engine wants decimal feet, and nobody thinks in
      // decimal feet. Inches may be blank — 6 ft flat is a real height.
      const ft = parseLooseNumber(feet);
      const inch = inches.trim() === '' ? 0 : parseLooseNumber(inches);
      heightValue = ft === null || inch === null ? null : ft + inch / 12;
    } else {
      heightValue = parseLooseNumber(height);
    }
    if (heightValue === null) return { kind: 'incomplete' as const };

    const result = calculateBmi({
      weight: weightValue,
      weightUnit,
      height: heightValue,
      heightUnit,
    });
    return result.ok
      ? { kind: 'ok' as const, result: result.result }
      : { kind: 'failed' as const, error: result.error };
  }, [feet, height, heightUnit, inches, weight, weightUnit]);

  const result = outcome.kind === 'ok' ? outcome.result : null;

  const facts: Fact[] = result
    ? [
        {
          term: 'Category',
          value: result.categoryLabel,
          note: 'World Health Organization adult bands',
        },
        {
          term: 'Healthy weight at this height',
          value: `${display(result.healthyWeightRange.minKg)} – ${display(result.healthyWeightRange.maxKg)} kg`,
          note: `${display(result.healthyWeightRange.minLb)} – ${display(result.healthyWeightRange.maxLb)} lb`,
        },
        {
          term: result.weightToHealthyKg === null ? 'Distance to that range' : 'To reach that range',
          value:
            result.weightToHealthyKg === null
              ? 'Already inside it'
              : `${result.weightToHealthyKg < 0 ? 'Lose' : 'Gain'} ${display(Math.abs(result.weightToHealthyKg))} kg`,
        },
        {
          term: 'BMI Prime',
          value: display(result.bmiPrime),
          note: 'BMI ÷ 25 — 1.00 sits exactly on the top of the normal band',
        },
      ]
    : [];

  return (
    <ToolWorkspace
      label="BMI calculator"
      error={outcome.kind === 'failed' ? outcome.error : null}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Weight" htmlFor="bmi-weight">
          <div className="flex gap-2">
            <Input
              id="bmi-weight"
              inputMode="decimal"
              value={weight}
              onChange={(event) => {
                markStarted();
                setWeight(event.target.value);
              }}
              className="min-w-0 flex-1"
            />
            <Select
              value={weightUnit}
              aria-label="Weight unit"
              onChange={(event) => setWeightUnit(event.target.value as BmiWeightUnit)}
              className="w-36 shrink-0"
            >
              {(Object.keys(WEIGHT_UNIT_LABELS) as BmiWeightUnit[]).map((unit) => (
                <option key={unit} value={unit}>
                  {WEIGHT_UNIT_LABELS[unit]}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        <Field
          label="Height"
          htmlFor={heightUnit === 'ft' ? 'bmi-feet' : 'bmi-height'}
          hint={heightUnit === 'ft' ? 'Leave inches blank for a whole number of feet.' : undefined}
        >
          <div className="flex gap-2">
            {heightUnit === 'ft' ? (
              // Two boxes, because 5 ft 9 in is 5.75 ft and nobody types that.
              <div className="flex min-w-0 flex-1 gap-2">
                <Input
                  id="bmi-feet"
                  inputMode="decimal"
                  aria-label="Height in feet"
                  value={feet}
                  onChange={(event) => {
                    markStarted();
                    setFeet(event.target.value);
                  }}
                  suffix="ft"
                  className="min-w-0 flex-1"
                />
                <Input
                  inputMode="decimal"
                  aria-label="Height in inches"
                  value={inches}
                  onChange={(event) => {
                    markStarted();
                    setInches(event.target.value);
                  }}
                  suffix="in"
                  className="min-w-0 flex-1"
                />
              </div>
            ) : (
              <Input
                id="bmi-height"
                inputMode="decimal"
                value={height}
                onChange={(event) => {
                  markStarted();
                  setHeight(event.target.value);
                }}
                className="min-w-0 flex-1"
              />
            )}
            <Select
              value={heightUnit}
              aria-label="Height unit"
              onChange={(event) => setHeightUnit(event.target.value as BmiHeightUnit)}
              className="w-36 shrink-0"
            >
              {(Object.keys(HEIGHT_UNIT_LABELS) as BmiHeightUnit[]).map((unit) => (
                <option key={unit} value={unit}>
                  {HEIGHT_UNIT_LABELS[unit]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>

      {result ? (
        <>
          <AnswerCard
            slug={SLUG}
            headline={display(result.bmi)}
            sentence={`${result.categoryLabel} on the WHO adult scale.`}
            copyValue={`BMI ${display(result.bmi)} — ${result.categoryLabel}`}
            copyTarget="bmi"
          />

          {/* Directly under the number, never behind a tooltip. */}
          <Alert variant="info" title="What this number is">
            {result.note}
          </Alert>

          <FactGrid facts={facts} />

          {/* No colour coding: a green or red figure is a verdict, and a table
              with your row marked is information. */}
          <div>
            <p className="mb-2 text-sm font-medium text-fg">The full scale</p>
            <div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-80 border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-left">
                    <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                      BMI
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                      WHO category
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BMI_BANDS.map((band) => {
                    const here = band.category === result.category;
                    return (
                      <tr
                        key={band.category}
                        aria-current={here ? 'true' : undefined}
                        className={cn(
                          'border-b border-border-subtle last:border-b-0',
                          here ? 'bg-accent-subtle font-medium text-accent-fg' : 'text-fg-muted',
                        )}
                      >
                        <td className="tabular px-3 py-2">{bandRange(band.min, band.max)}</td>
                        <td className="px-3 py-2">
                          {band.label}
                          {here ? <span className="ml-2 text-xs">← you are here</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <ShownWorking slug={SLUG} formula={result.formula} steps={result.steps} />

          <p className="text-sm text-fg-muted">
            Ponderal index: {formatNumber(result.ponderalIndex, { decimals: 1 })} kg/m³ — weight
            divided by height cubed, which is less biased by height than BMI at the extremes.
          </p>
        </>
      ) : null}
    </ToolWorkspace>
  );
}
