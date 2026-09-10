import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_LABELS,
  UNITS,
  convert,
  convertAll,
  findUnit,
  parseQuantity,
  unitsIn,
} from './units.ts';
import type { UnitCategory, UnitDef } from './units.ts';
import type { Failure } from './round.ts';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as UnitCategory[];

function expectOk<T>(result: ({ ok: true } & T) | Failure): { ok: true } & T {
  if (!result.ok) assert.fail(`expected success, got error: ${result.error}`);
  return result;
}

function expectFail(result: { ok: true } | Failure): string {
  if (result.ok) assert.fail('expected a friendly error, got a result');
  return result.error;
}

function converted(value: number, from: string, to: string): number {
  return expectOk(convert(value, from, to)).value;
}

test('every unit has a unique id and is fully described', () => {
  const ids = new Set<string>();
  for (const unit of UNITS) {
    assert.ok(!ids.has(unit.id), `duplicate unit id: ${unit.id}`);
    ids.add(unit.id);
    assert.ok(unit.symbol.length > 0, `${unit.id} needs a symbol`);
    assert.ok(unit.name.length > 0, `${unit.id} needs a name`);
    assert.ok(unit.plural.length > 0, `${unit.id} needs a plural`);
    assert.ok(CATEGORIES.includes(unit.category), `${unit.id} has an unknown category`);
    assert.ok(Number.isFinite(unit.toBase) && unit.toBase !== 0, `${unit.id} needs a usable toBase`);
    assert.ok(unit.offset === undefined || Number.isFinite(unit.offset), `${unit.id} has a broken offset`);
    if (unit.category !== 'temperature') {
      assert.equal(unit.offset ?? 0, 0, `only temperature should carry an offset: ${unit.id}`);
    }
  }
  assert.equal(ids.size, UNITS.length);
});

test('every category carries at least eight units, a label and exactly one base unit', () => {
  let counted = 0;
  for (const category of CATEGORIES) {
    const units = unitsIn(category);
    counted += units.length;
    assert.ok(units.length >= 8, `${category} has only ${units.length} units`);
    assert.ok(CATEGORY_LABELS[category].length > 0, `${category} needs a label`);
    const bases = units.filter((unit) => unit.toBase === 1 && !unit.offset);
    assert.equal(bases.length, 1, `${category} should have exactly one base unit, found ${bases.length}`);
    assert.ok(units.every((unit) => unit.category === category), 'unitsIn must not leak other categories');
  }
  assert.equal(counted, UNITS.length, 'every unit belongs to a labelled category');
});

test('a unit is findable by its id, symbol, name and plural, with nothing shadowed', () => {
  for (const unit of UNITS) {
    for (const key of [unit.id, unit.symbol, unit.name, unit.plural]) {
      assert.equal(findUnit(key)?.id, unit.id, `${JSON.stringify(key)} should resolve to ${unit.id}`);
      assert.equal(findUnit(` ${key} `)?.id, unit.id, 'surrounding space should not matter');
    }
  }
});

test('findUnit keeps case where case is the whole meaning', () => {
  assert.equal(findUnit('MB')?.id, 'MB');
  assert.equal(findUnit('Mbit')?.id, 'Mbit');
  assert.equal(findUnit('mm')?.id, 'mm');
  assert.equal(findUnit('KM')?.id, 'km', 'a case-insensitive fallback still helps');
  assert.equal(findUnit('°f')?.id, 'F');
  assert.equal(findUnit('FL OZ')?.id, 'floz');
  assert.equal(findUnit('µs')?.id, 'us');
  assert.equal(findUnit('zorkmid'), undefined);
  assert.equal(findUnit(''), undefined);
  assert.equal(findUnit('   '), undefined);
  // A megabyte is eight times a megabit, and the table must not blur them.
  assert.equal(converted(1, 'MB', 'Mbit'), 8);
});

/**
 * Every ordered pair inside a category, there and back. This is the test that
 * catches an offset applied in one direction only, a sign lost on an inverted
 * scale such as Delisle, or a unit quietly landing in the wrong category.
 */
test('a value round-trips through every unit pair in its category', () => {
  let pairs = 0;
  for (const category of CATEGORIES) {
    const units = unitsIn(category);
    for (const from of units) {
      for (const to of units) {
        for (const value of [1, 21.5, 1234.5, 0.004, -17.25]) {
          const there = converted(value, from.id, to.id);
          const back = converted(there, to.id, from.id);
          // Relative to max(1, |value|): temperature offsets make an absolute
          // floor the honest measure for values close to zero.
          const tolerance = 1e-9 * Math.max(1, Math.abs(value));
          assert.ok(
            Math.abs(back - value) <= tolerance,
            `${category}: ${value} ${from.id} → ${there} ${to.id} → ${back} ${from.id}`,
          );
          pairs += 1;
        }
      }
    }
  }
  assert.ok(pairs > 5000, `expected thousands of pairs, checked ${pairs}`);
});

/**
 * A round trip cannot catch a wrong `toBase`, because the error cancels on the
 * way back. These vectors can: each one is an independently known definition, so
 * a mistyped factor has nowhere to hide.
 */
const VECTORS: ReadonlyArray<[number, string, string, number]> = [
  [1, 'mi', 'm', 1609.344],
  [1, 'mi', 'ft', 5280],
  [1, 'in', 'mm', 25.4],
  [1, 'yd', 'in', 36],
  [1, 'nmi', 'm', 1852],
  [1, 'lb', 'kg', 0.45359237],
  [1, 'st', 'lb', 14],
  [1, 'oz', 'g', 28.349523125],
  [1, 'ton-us', 'lb', 2000],
  [1, 'ton-uk', 'lb', 2240],
  [1, 't', 'kg', 1000],
  [1, 'ct', 'mg', 200],
  [1, 'ac', 'm2', 4046.8564224],
  [1, 'ha', 'm2', 10000],
  [1, 'mi2', 'ac', 640],
  [1, 'ft2', 'in2', 144],
  [1, 'yd2', 'ft2', 9],
  [1, 'gal', 'l', 3.785411784],
  [1, 'gal', 'floz', 128],
  [1, 'gal-uk', 'l', 4.54609],
  [1, 'ft3', 'l', 28.316846592],
  [1, 'm3', 'l', 1000],
  [1, 'cup', 'tbsp', 16],
  [1, 'tbsp', 'tsp', 3],
  [1, 'qt', 'pt', 2],
  [1, 'h', 's', 3600],
  [1, 'd', 'h', 24],
  [1, 'wk', 'd', 7],
  [1, 'yr', 'd', 365.2425],
  [1, 'mo', 'd', 30.436875],
  [1, 'B', 'bit', 8],
  [1, 'MiB', 'KiB', 1024],
  [1, 'atm', 'Pa', 101325],
  [1, 'bar', 'Pa', 100000],
  [1, 'mbar', 'hPa', 1],
  [1, 'inHg', 'mmHg', 25.4],
  [1, 'psi', 'Pa', 6894.757293168361],
  [1, 'kWh', 'J', 3600000],
  [1, 'kcal', 'J', 4184],
  [1, 'kcal', 'cal', 1000],
  [1, 'BTU', 'J', 1055.05585262],
  [1, 'therm', 'BTU', 100000],
  [1, 'turn', 'deg', 360],
  [1, 'turn', 'grad', 400],
  [1, 'deg', 'arcmin', 60],
  [1, 'arcmin', 'arcsec', 60],
  [1, 'point', 'deg', 11.25],
  [1, 'mph', 'm/s', 0.44704],
  [1, 'kn', 'm/s', 1852 / 3600],
  [1, 'km/h', 'm/s', 1 / 3.6],
  [1, 'ft/s', 'm/s', 0.3048],
];

test('every conversion factor matches its published definition', () => {
  for (const [value, from, to, expected] of VECTORS) {
    const actual = converted(value, from, to);
    assert.ok(
      Math.abs(actual - expected) <= 1e-12 * Math.abs(expected),
      `${value} ${from} should be ${expected} ${to}, got ${actual}`,
    );
  }
});

test('the definitions that are exact really are exact', () => {
  assert.equal(converted(1, 'mi', 'm'), 1609.344);
  assert.equal(converted(1, 'in', 'mm'), 25.4);
  assert.equal(converted(1, 'GiB', 'B'), 1073741824);
  assert.equal(converted(1, 'GB', 'B'), 1000000000);
  assert.equal(converted(1, 'KiB', 'B'), 1024);
  assert.equal(converted(1, 'TiB', 'B'), 1024 ** 4);
  assert.equal(converted(1, 'TB', 'B'), 1e12);
  assert.equal(converted(1, 'turn', 'deg'), 360);
});

/**
 * The four scales people actually check a converter against. The value is
 * asserted to 1e-9 because 5/9 is not a binary fraction; the *string* is asserted
 * exactly, because "31.999999999999986" on the page is the bug this guards.
 */
test('temperature: the vectors everyone knows by heart', () => {
  const vectors: ReadonlyArray<[number, string, string, number, string]> = [
    [0, 'C', 'F', 32, '32'],
    [0, 'C', 'K', 273.15, '273.15'],
    [-40, 'C', 'F', -40, '-40'],
    [100, 'C', 'F', 212, '212'],
    [0, 'K', 'F', -459.67, '-459.67'],
    [0, 'K', 'C', -273.15, '-273.15'],
    [32, 'F', 'C', 0, '0'],
    [212, 'F', 'K', 373.15, '373.15'],
    [0, 'C', 'R', 491.67, '491.67'],
    [0, 'C', 'Re', 0, '0'],
    [100, 'C', 'Re', 80, '80'],
    [0, 'C', 'De', 150, '150'],
    [100, 'C', 'De', 0, '0'],
    [100, 'C', 'N', 33, '33'],
    [0, 'C', 'Ro', 7.5, '7.5'],
  ];
  for (const [value, from, to, expected, formatted] of vectors) {
    const result = expectOk(convert(value, from, to));
    assert.ok(
      Math.abs(result.value - expected) <= 1e-9,
      `${value} ${from} should be ${expected} ${to}, got ${result.value}`,
    );
    assert.equal(result.formatted, formatted, 'the string on the page must be clean');
  }
});

test('digital storage keeps decimal and binary apart, and the notes say which is which', () => {
  for (const id of ['kB', 'MB', 'GB', 'TB', 'PB']) {
    const note = findUnit(id)?.note ?? '';
    assert.match(note, /^Decimal:/, `${id} must be labelled decimal`);
    assert.match(note, /1,000 bytes/, `${id} must say what a decimal kilobyte is`);
    assert.match(note, /1,024/, `${id} must mention the binary figure it gets confused with`);
  }
  for (const id of ['KiB', 'MiB', 'GiB', 'TiB']) {
    const note = findUnit(id)?.note ?? '';
    assert.match(note, /^Binary:/, `${id} must be labelled binary`);
    assert.match(note, /1,024 bytes/, `${id} must say what a kibibyte is`);
  }
  assert.equal(converted(1, 'kB', 'B'), 1000);
  assert.equal(converted(1, 'KiB', 'B'), 1024);
  assert.equal(converted(1, 'MiB', 'MB'), 1048576 / 1000000);
  // The number on the box against the number the operating system reports.
  assert.equal(expectOk(convert(500, 'GB', 'GiB')).formatted, '465.6612873');
});

/**
 * Significant digits in a formatted string, ignoring grouping commas, any
 * exponent, and the zeros that only place the decimal point. Integers are
 * exempt: a converted value of 10,604,274,253,824 bits is exact, and truncating
 * it would be a lie of a different kind.
 */
function significantDigits(formatted: string): number {
  const bare = (formatted.replace(/^-/, '').replace(/,/g, '').split('e')[0] ?? '');
  if (!bare.includes('.')) return 0;
  return bare.replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
}

const PLAIN = /^-?(?:[0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.[0-9]+)?$/;
const SCIENTIFIC = /^-?[0-9](?:\.[0-9]{1,6})?e[+-][0-9]+$/;

function assertClean(formatted: string, context: string): void {
  assert.ok(
    PLAIN.test(formatted) || SCIENTIFIC.test(formatted),
    `${context}: “${formatted}” is not a shape we would print`,
  );
  assert.ok(
    significantDigits(formatted) <= 10,
    `${context}: “${formatted}” shows binary noise as precision`,
  );
}

/**
 * The failure this guards is cosmetic and fatal: a converter that answers
 * "1.0000000000000002" is not trusted again, however right it is.
 */
test('no conversion in the table renders binary noise', () => {
  let checked = 0;
  for (const unit of UNITS) {
    for (const value of [1, 3, 0.1, 21.5, 1234.5, -17.25, 0.004]) {
      const all = expectOk(convertAll(value, unit.id));
      assert.equal(all.results.length, unitsIn(unit.category).length - 1);
      for (const row of all.results) {
        assertClean(row.formatted, `${value} ${unit.id} → ${row.unit.id}`);
        // convertAll and convert must be the same arithmetic, not merely similar.
        const single = expectOk(convert(value, unit.id, row.unit.id));
        assert.equal(row.value, single.value, 'convertAll must agree with convert');
        assert.equal(row.formatted, single.formatted);
        assert.equal(row.unit.category, unit.category, 'convertAll must not leave the category');
        assert.notEqual(row.unit.id, unit.id, 'the source unit is not a row');
        checked += 1;
      }
    }
  }
  assert.ok(checked > 5000, `expected thousands of rendered values, checked ${checked}`);
});

test('the values people would notice come out clean', () => {
  const clean: ReadonlyArray<[number, string, string, string]> = [
    [1, 'km', 'm', '1,000'],
    [1, 'm', 'km', '0.001'],
    [3, 'ft', 'm', '0.9144'],
    [0.1, 'in', 'mm', '2.54'],
    [1, 'tbsp', 'tsp', '3'],
    [1, 'turn', 'grad', '400'],
    [1, 'ct', 'mg', '200'],
    [1, 'MiB', 'MB', '1.048576'],
    [2, 'mi', 'km', '3.218688'],
    [1, 'l', 'ml', '1,000'],
    [-40, 'C', 'F', '-40'],
    [1, 'kWh', 'J', '3,600,000'],
  ];
  for (const [value, from, to, expected] of clean) {
    assert.equal(expectOk(convert(value, from, to)).formatted, expected, `${value} ${from} → ${to}`);
  }
});

test('the shown working is the arithmetic the code actually does', () => {
  assert.equal(
    expectOk(convert(5.5, 'km', 'ft')).formula,
    '5.5 km × 3,280.839895 = 18,044.61942 ft',
  );
  // A single multiplier would be a lie for a scale with an offset, so those show
  // the hop through the base unit instead.
  assert.equal(expectOk(convert(0, 'C', 'F')).formula, '0 °C → 273.15 K → 32 °F');
  assert.equal(expectOk(convert(0, 'K', 'F')).formula, '0 K → -459.67 °F', 'no pointless K → K hop');
  assert.equal(expectOk(convert(5, 'km', 'km')).formula, '5 km is already in kilometres');
  assert.equal(converted(5, 'km', 'km'), 5);
});

test('no formula anywhere leaks a non-finite number', () => {
  for (const unit of UNITS) {
    for (const other of unitsIn(unit.category)) {
      const { formula } = expectOk(convert(-3.75, unit.id, other.id));
      assert.ok(formula.length > 0, `${unit.id} → ${other.id} needs a formula`);
      assert.ok(
        !/NaN|Infinity|—/.test(formula),
        `${unit.id} → ${other.id} produced “${formula}”`,
      );
      assert.ok(formula.includes(unit.symbol), 'the formula must name the unit given');
    }
  }
});

test('parseQuantity reads the ways people actually type a quantity', () => {
  const cases: ReadonlyArray<[string, number, string]> = [
    ['5.5 km', 5.5, 'km'],
    ['72°F', 72, 'F'],
    ['3ft', 3, 'ft'],
    ['1,024 MiB', 1024, 'MiB'],
    ['-40 C', -40, 'C'],
    ['  12.5  kg  ', 12.5, 'kg'],
    ['−40 °C', -40, 'C'],
    ['1e3 m', 1000, 'm'],
    ['1 erg', 1, 'erg'],
    ['1erg', 1, 'erg'],
    ['0.5 FL OZ', 0.5, 'floz'],
    ['1 000 g', 1000, 'g'],
    ['+7 kn', 7, 'kn'],
  ];
  for (const [input, value, unitId] of cases) {
    const parsed = expectOk(parseQuantity(input));
    assert.equal(parsed.value, value, `value of ${JSON.stringify(input)}`);
    assert.equal(parsed.unit.id, unitId, `unit of ${JSON.stringify(input)}`);
  }
});

function firstUnit(category: UnitCategory): UnitDef {
  const unit = unitsIn(category)[0];
  if (!unit) assert.fail(`${category} has no units`);
  return unit;
}

test('a unit is never converted into a unit of another kind, and the error says why', () => {
  let pairs = 0;
  for (const from of CATEGORIES) {
    for (const to of CATEGORIES) {
      if (from === to) continue;
      const source = firstUnit(from);
      const target = firstUnit(to);
      const message = expectFail(convert(1, source.id, target.id));
      const context = `${source.id} → ${target.id}`;
      assert.ok(message.includes(source.name), `${context}: names the unit given`);
      assert.ok(message.includes(target.name), `${context}: names the unit asked for`);
      assert.ok(message.includes(CATEGORY_LABELS[from].toLowerCase()), `${context}: names ${from}`);
      assert.ok(message.includes(CATEGORY_LABELS[to].toLowerCase()), `${context}: names ${to}`);
      assert.match(message, /cannot be converted into the other\.$/);
      pairs += 1;
    }
  }
  assert.equal(pairs, CATEGORIES.length * (CATEGORIES.length - 1));
});

test('everything that can go wrong says so in one plain sentence', () => {
  const messages = [
    expectFail(convert(Number.NaN, 'km', 'm')),
    expectFail(convert(Number.POSITIVE_INFINITY, 'km', 'm')),
    expectFail(convert(1, '', 'm')),
    expectFail(convert(1, 'km', '   ')),
    expectFail(convert(1, 'zorkmid', 'm')),
    expectFail(convert(1, 'km', 'zorkmid')),
    expectFail(convertAll(Number.NaN, 'km')),
    expectFail(convertAll(1, '')),
    expectFail(convertAll(1, 'zorkmid')),
    expectFail(parseQuantity('')),
    expectFail(parseQuantity('   ')),
    expectFail(parseQuantity('km')),
    expectFail(parseQuantity('5.5')),
    expectFail(parseQuantity('5.5 zorkmids')),
    expectFail(parseQuantity('1..2 km')),
    expectFail(parseQuantity(null as unknown as string)),
  ];
  for (const message of messages) {
    assert.match(message, /\.$/, `not a sentence: ${message}`);
    assert.match(message, /^[A-Z“]/, `does not start like a sentence: ${message}`);
    assert.ok(!/NaN|Infinity|undefined|null/.test(message), `leaks a machine word: ${message}`);
  }
});

test('each failure is the right failure, not merely a failure', () => {
  assert.equal(expectFail(convert(Number.NaN, 'km', 'm')), 'Enter the amount you want to convert.');
  assert.equal(expectFail(convert(1, '', 'm')), 'Choose the unit you are converting from.');
  assert.equal(expectFail(convert(1, 'km', '   ')), 'Choose the unit you are converting to.');
  assert.equal(
    expectFail(convert(1, 'zorkmid', 'm')),
    'We do not recognise the unit “zorkmid”. Choose one from the list.',
  );
  assert.equal(expectFail(parseQuantity('')), 'Type an amount and a unit, such as “5.5 km”.');
  assert.equal(
    expectFail(parseQuantity('km')),
    'We could not find a number in “km”. Try something like “5.5 km”.',
  );
  assert.equal(expectFail(parseQuantity('5.5')), 'Add a unit after “5.5”, such as “km”.');
  assert.equal(expectFail(parseQuantity('1..2 km')), '“1..2” is not an amount we can read.');
});

test('parseQuantity feeds convert without a step in between', () => {
  const parsed = expectOk(parseQuantity('1,024 MiB'));
  assert.equal(expectOk(convert(parsed.value, parsed.unit.id, 'GiB')).formatted, '1');
  const cold = expectOk(parseQuantity('-40 °C'));
  assert.equal(expectOk(convert(cold.value, cold.unit.id, 'F')).formatted, '-40');
});

test('convertAll answers the whole category at once', () => {
  const length = expectOk(convertAll(1, 'km'));
  assert.equal(length.results.length, unitsIn('length').length - 1);
  const metres = length.results.find((row) => row.unit.id === 'm');
  assert.equal(metres?.value, 1000);
  assert.equal(metres?.formatted, '1,000');
  assert.ok(!length.results.some((row) => row.unit.id === 'km'), 'no "1 km = 1 km" row');

  const freezing = expectOk(convertAll(0, 'C'));
  assert.equal(freezing.results.find((row) => row.unit.id === 'F')?.formatted, '32');
  assert.equal(freezing.results.find((row) => row.unit.id === 'K')?.formatted, '273.15');
  assert.equal(freezing.results.find((row) => row.unit.id === 'De')?.formatted, '150');
});
