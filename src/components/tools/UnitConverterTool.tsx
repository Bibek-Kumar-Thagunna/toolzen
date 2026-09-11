'use client';

/**
 * ============================================================================
 * UNIT CONVERTER
 * ============================================================================
 * Eleven categories, one pair of dropdowns, and the whole category listed
 * underneath.
 *
 * ── Why the full table is shown, not just the answer ──────────────────────
 * "5 km in miles" is the question people type, but it is rarely the only thing
 * they want to know — someone converting a running distance wants metres too,
 * someone converting a recipe wants both millilitres and cups. `convertAll`
 * costs nothing once the value is in base units, and a table turns a single
 * lookup into a page worth bookmarking.
 *
 * ── Why the units swap rather than reset when the category changes ────────
 * Changing category has to change both units, because a kilometre cannot become
 * a kilogram. The first two units of the new category are chosen, which for
 * every category here is the pair people actually want.
 *
 * ── Why the swap button exists ────────────────────────────────────────────
 * Half of all conversions are done in the wrong direction first. Every
 * conversion goes through the base unit, so the reverse is exact rather than
 * approximately exact, and one button beats retyping both dropdowns.
 *
 * ── Temperature is why `offset` exists ────────────────────────────────────
 * Every other unit here is a pure ratio: double the number, double the
 * quantity. Fahrenheit is not — it has a zero in a different place — so the
 * engine scales and *then* adds. A converter that treats °F as a ratio gets
 * every temperature except -40 wrong, and gets it wrong in a way that looks
 * plausible.
 * ============================================================================
 */
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AnswerCard } from '@/components/tool/CalcAnswer';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import {
  CATEGORY_LABELS,
  convert,
  convertAll,
  unitsIn,
  type UnitCategory,
} from '@/lib/tools/calc/units';
import { parseLooseNumber } from '@/lib/tools/calc/round';

const SLUG = 'unit-converter';

const CATEGORY_ORDER: readonly UnitCategory[] = [
  'length',
  'mass',
  'temperature',
  'volume',
  'area',
  'speed',
  'time',
  'data',
  'pressure',
  'energy',
  'angle',
];

/**
 * The pair a category opens on.
 *
 * Named explicitly rather than taken as the first two units in the table,
 * because the tables are ordered smallest-first and that would land somebody on
 * "nanometres to micrometres" — a conversion approximately nobody arrives
 * wanting. These are the pairs the search queries are actually about: cm to
 * inches, kg to pounds, Celsius to Fahrenheit, and so on. The first render is
 * also what a visitor from a search engine sees before touching anything, so
 * it is worth choosing rather than inheriting.
 */
const DEFAULT_PAIRS: Readonly<Record<UnitCategory, readonly [string, string]>> = {
  length: ['cm', 'in'],
  mass: ['kg', 'lb'],
  temperature: ['C', 'F'],
  volume: ['ml', 'floz'],
  area: ['m2', 'ft2'],
  speed: ['km/h', 'mph'],
  time: ['h', 'min'],
  data: ['MB', 'MiB'],
  pressure: ['bar', 'psi'],
  energy: ['kWh', 'MJ'],
  angle: ['deg', 'rad'],
};

function defaultPair(category: UnitCategory): [string, string] {
  const list = unitsIn(category);
  const [wantFrom, wantTo] = DEFAULT_PAIRS[category];
  // Fall back to the table order if a preferred id is ever renamed in the
  // engine, so a typo here degrades to a working converter rather than a blank.
  const from = list.find((unit) => unit.id === wantFrom)?.id ?? list[0]?.id ?? '';
  const to = list.find((unit) => unit.id === wantTo)?.id ?? list[1]?.id ?? from;
  return [from, to];
}

export function UnitConverterTool() {
  const [category, setCategory] = useState<UnitCategory>('length');
  const [amount, setAmount] = useState('1');
  const [from, setFrom] = useState(() => defaultPair('length')[0]);
  const [to, setTo] = useState(() => defaultPair('length')[1]);

  const markStarted = useToolStarted(SLUG);
  const units = useMemo(() => unitsIn(category), [category]);

  const value = parseLooseNumber(amount);

  const outcome = useMemo(() => {
    if (value === null) return null;
    return convert(value, from, to);
  }, [from, to, value]);

  const table = useMemo(() => {
    if (value === null) return null;
    const all = convertAll(value, from);
    return all.ok ? all.results : null;
  }, [from, value]);

  function changeCategory(next: UnitCategory): void {
    markStarted();
    setCategory(next);
    // Both units have to move: a kilometre cannot become a kilogram.
    const [a, b] = defaultPair(next);
    setFrom(a);
    setTo(b);
  }

  function swap(): void {
    markStarted();
    setFrom(to);
    setTo(from);
  }

  const fromUnit = units.find((unit) => unit.id === from);
  const toUnit = units.find((unit) => unit.id === to);

  return (
    <ToolWorkspace
      label="Unit converter"
      error={outcome && !outcome.ok ? outcome.error : null}
    >
      <Field label="What are you converting?" htmlFor="unit-category">
        <Select
          id="unit-category"
          value={category}
          onChange={(event) => changeCategory(event.target.value as UnitCategory)}
        >
          {CATEGORY_ORDER.map((id) => (
            <option key={id} value={id}>
              {CATEGORY_LABELS[id]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <Field label="From" htmlFor="unit-amount" hint={fromUnit?.note}>
          <div className="flex gap-2">
            <Input
              id="unit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                markStarted();
                setAmount(event.target.value);
              }}
              className="min-w-0 flex-1"
            />
            <Select
              value={from}
              aria-label="Convert from"
              onChange={(event) => setFrom(event.target.value)}
              className="w-40 shrink-0"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} ({unit.symbol})
                </option>
              ))}
            </Select>
          </div>
        </Field>

        {/* Between the two on desktop, above the second on a phone — where a
            control that sits between two stacked fields is easy to miss. */}
        <div className="flex justify-center sm:pb-1">
          <Button variant="ghost" size="sm" iconLeft="swap" onClick={swap}>
            Swap
          </Button>
        </div>

        <Field label="To" htmlFor="unit-to" hint={toUnit?.note}>
          <div className="flex gap-2">
            <Input
              readOnly
              value={outcome?.ok ? outcome.formatted : ''}
              aria-label="Converted amount"
              className="tabular min-w-0 flex-1 bg-surface-sunken"
            />
            <Select
              id="unit-to"
              value={to}
              aria-label="Convert to"
              onChange={(event) => setTo(event.target.value)}
              className="w-40 shrink-0"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} ({unit.symbol})
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>

      {outcome?.ok && fromUnit && toUnit ? (
        <>
          <AnswerCard
            slug={SLUG}
            headline={`${outcome.formatted} ${toUnit.symbol}`}
            sentence={outcome.formula}
            copyValue={outcome.formatted}
            copyTarget="conversion"
          />

          {table && table.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-fg">
                The same amount in every {CATEGORY_LABELS[category].toLowerCase()} unit
              </p>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-80 border-collapse text-sm">
                  <tbody>
                    {table.map((row) => (
                      <tr
                        key={row.unit.id}
                        className="border-b border-border-subtle last:border-b-0"
                      >
                        <td className="tabular px-3 py-2 font-medium text-fg">{row.formatted}</td>
                        <td className="px-3 py-2 text-fg-muted">
                          {row.unit.plural} ({row.unit.symbol})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </ToolWorkspace>
  );
}
