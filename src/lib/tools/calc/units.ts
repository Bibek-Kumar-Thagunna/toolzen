/**
 * The unit converter: one flat table of units, and one code path through it.
 *
 * Every unit says how much of its category's base unit it is worth (`toBase`),
 * and temperature scales add an `offset`:
 *
 *     base  = value × toBase + offset
 *     value = (base − offset) ÷ toBase
 *
 * Celsius, Fahrenheit, Kelvin, Rankine and four historical scales therefore run
 * through exactly the same two lines as millimetres and miles. There is no
 * special case for temperature, which is where converters usually go wrong —
 * typically by getting one direction right and the other subtly wrong.
 *
 * Conversion factors are written as exact definitions wherever one exists (an
 * inch *is* 25.4 mm; a mile *is* 1,609.344 m), and derived from those
 * definitions rather than copied from a search result where they are not. Units
 * that are approximations by nature — the average calendar month, Mach 1 — carry
 * a `note` saying so, and so do the decimal byte units, because the 1,000 vs
 * 1,024 confusion is the reason half the traffic for this tool exists.
 */

import { display, fail, isRealNumber, parseLooseNumber, roundTo, smartDecimals } from './round.ts';
import type { Failure } from './round.ts';

export type UnitCategory =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'time'
  | 'data'
  | 'pressure'
  | 'energy'
  | 'angle';

export interface UnitDef {
  /** Stable, URL-safe key. Also the short form people type. */
  id: string;
  name: string;
  plural: string;
  /** For display. May carry a degree sign or a superscript. */
  symbol: string;
  category: UnitCategory;
  /** How many base units one of these is worth. */
  toBase: number;
  /** Added *after* scaling to reach the base unit. Only temperature needs it. */
  offset?: number;
  /** Shown beside the unit when it is easy to misread. */
  note?: string;
}

export const CATEGORY_LABELS: Readonly<Record<UnitCategory, string>> = {
  length: 'Length',
  mass: 'Mass and weight',
  temperature: 'Temperature',
  area: 'Area',
  volume: 'Volume',
  speed: 'Speed',
  time: 'Time',
  data: 'Digital storage',
  pressure: 'Pressure',
  energy: 'Energy',
  angle: 'Angle',
};

/** Why a 500 GB drive shows up as 465 GiB. */
const DECIMAL_BYTES =
  'Decimal: 1 kB is exactly 1,000 bytes. Storage is sold in these, which is why a "500 GB" drive shows up as 465 GiB — the operating system is counting in binary units of 1,024.';

const BINARY_BYTES =
  'Binary: 1 KiB is exactly 1,024 bytes. This is what most operating systems mean when they write KB, MB or GB.';

/** Degrees are the reference for every other angle unit, so the ratios stay exact. */
const DEG = Math.PI / 180;

/**
 * Fill in the category once per group rather than once per unit. It is one fewer
 * thing to copy wrongly when a unit is added to the wrong list.
 */
function group(
  category: UnitCategory,
  units: ReadonlyArray<Omit<UnitDef, 'category'>>,
): UnitDef[] {
  return units.map((unit) => ({ ...unit, category }));
}

export const UNITS: readonly UnitDef[] = [
  ...group('length', [
    { id: 'nm', name: 'nanometre', plural: 'nanometres', symbol: 'nm', toBase: 1e-9 },
    { id: 'um', name: 'micrometre', plural: 'micrometres', symbol: 'µm', toBase: 1e-6 },
    { id: 'mm', name: 'millimetre', plural: 'millimetres', symbol: 'mm', toBase: 1e-3 },
    { id: 'cm', name: 'centimetre', plural: 'centimetres', symbol: 'cm', toBase: 1e-2 },
    { id: 'm', name: 'metre', plural: 'metres', symbol: 'm', toBase: 1 },
    { id: 'km', name: 'kilometre', plural: 'kilometres', symbol: 'km', toBase: 1e3 },
    { id: 'in', name: 'inch', plural: 'inches', symbol: 'in', toBase: 0.0254 },
    { id: 'ft', name: 'foot', plural: 'feet', symbol: 'ft', toBase: 0.3048 },
    { id: 'yd', name: 'yard', plural: 'yards', symbol: 'yd', toBase: 0.9144 },
    { id: 'mi', name: 'mile', plural: 'miles', symbol: 'mi', toBase: 1609.344 },
    { id: 'nmi', name: 'nautical mile', plural: 'nautical miles', symbol: 'nmi', toBase: 1852,
      note: 'One minute of latitude. Used at sea and in the air.' },
  ]),
  ...group('mass', [
    { id: 'mg', name: 'milligram', plural: 'milligrams', symbol: 'mg', toBase: 1e-6 },
    { id: 'ct', name: 'carat', plural: 'carats', symbol: 'ct', toBase: 2e-4,
      note: 'The gemstone carat: exactly 200 mg.' },
    { id: 'g', name: 'gram', plural: 'grams', symbol: 'g', toBase: 1e-3 },
    { id: 'oz', name: 'ounce', plural: 'ounces', symbol: 'oz', toBase: 0.028349523125 },
    { id: 'lb', name: 'pound', plural: 'pounds', symbol: 'lb', toBase: 0.45359237 },
    { id: 'kg', name: 'kilogram', plural: 'kilograms', symbol: 'kg', toBase: 1 },
    { id: 'st', name: 'stone', plural: 'stones', symbol: 'st', toBase: 6.35029318,
      note: 'Exactly 14 lb. Used for body weight in Britain and Ireland.' },
    { id: 'ton-us', name: 'US short ton', plural: 'US short tons', symbol: 'ton (US)', toBase: 907.18474 },
    { id: 't', name: 'tonne', plural: 'tonnes', symbol: 't', toBase: 1e3,
      note: 'The metric ton: exactly 1,000 kg. Between the US and UK tons in size.' },
    { id: 'ton-uk', name: 'UK long ton', plural: 'UK long tons', symbol: 'ton (UK)', toBase: 1016.0469088 },
  ]),
  ...group('temperature', [
    { id: 'C', name: 'degree Celsius', plural: 'degrees Celsius', symbol: '°C', toBase: 1, offset: 273.15 },
    { id: 'F', name: 'degree Fahrenheit', plural: 'degrees Fahrenheit', symbol: '°F',
      toBase: 5 / 9, offset: (459.67 * 5) / 9 },
    { id: 'K', name: 'kelvin', plural: 'kelvins', symbol: 'K', toBase: 1, offset: 0,
      note: 'Absolute zero is 0 K. Written without a degree sign.' },
    { id: 'R', name: 'degree Rankine', plural: 'degrees Rankine', symbol: '°R', toBase: 5 / 9, offset: 0,
      note: 'Fahrenheit-sized degrees counted from absolute zero.' },
    { id: 'Re', name: 'degree Réaumur', plural: 'degrees Réaumur', symbol: '°Ré', toBase: 1.25, offset: 273.15 },
    { id: 'De', name: 'degree Delisle', plural: 'degrees Delisle', symbol: '°De',
      toBase: -2 / 3, offset: 373.15,
      note: 'A historical scale that runs backwards: more degrees Delisle means colder.' },
    { id: 'N', name: 'degree Newton', plural: 'degrees Newton', symbol: '°N', toBase: 100 / 33, offset: 273.15 },
    { id: 'Ro', name: 'degree Rømer', plural: 'degrees Rømer', symbol: '°Rø',
      toBase: 40 / 21, offset: 273.15 - (7.5 * 40) / 21 },
  ]),
  ...group('area', [
    { id: 'mm2', name: 'square millimetre', plural: 'square millimetres', symbol: 'mm²', toBase: 1e-6 },
    { id: 'cm2', name: 'square centimetre', plural: 'square centimetres', symbol: 'cm²', toBase: 1e-4 },
    { id: 'in2', name: 'square inch', plural: 'square inches', symbol: 'in²', toBase: 0.00064516 },
    { id: 'ft2', name: 'square foot', plural: 'square feet', symbol: 'ft²', toBase: 0.09290304 },
    { id: 'yd2', name: 'square yard', plural: 'square yards', symbol: 'yd²', toBase: 0.83612736 },
    { id: 'm2', name: 'square metre', plural: 'square metres', symbol: 'm²', toBase: 1 },
    { id: 'ac', name: 'acre', plural: 'acres', symbol: 'ac', toBase: 4046.8564224 },
    { id: 'ha', name: 'hectare', plural: 'hectares', symbol: 'ha', toBase: 1e4,
      note: 'Exactly 10,000 m², or about 2.47 acres.' },
    { id: 'km2', name: 'square kilometre', plural: 'square kilometres', symbol: 'km²', toBase: 1e6 },
    { id: 'mi2', name: 'square mile', plural: 'square miles', symbol: 'mi²', toBase: 2589988.110336 },
  ]),
  ...group('volume', [
    { id: 'ml', name: 'millilitre', plural: 'millilitres', symbol: 'mL', toBase: 1e-6 },
    { id: 'cm3', name: 'cubic centimetre', plural: 'cubic centimetres', symbol: 'cm³', toBase: 1e-6,
      note: 'Identical to a millilitre.' },
    { id: 'tsp', name: 'US teaspoon', plural: 'US teaspoons', symbol: 'tsp', toBase: 4.92892159375e-6 },
    { id: 'tbsp', name: 'US tablespoon', plural: 'US tablespoons', symbol: 'tbsp', toBase: 1.478676478125e-5 },
    { id: 'cl', name: 'centilitre', plural: 'centilitres', symbol: 'cL', toBase: 1e-5 },
    { id: 'floz', name: 'US fluid ounce', plural: 'US fluid ounces', symbol: 'fl oz', toBase: 2.95735295625e-5 },
    { id: 'in3', name: 'cubic inch', plural: 'cubic inches', symbol: 'in³', toBase: 1.6387064e-5 },
    { id: 'cup', name: 'US cup', plural: 'US cups', symbol: 'cup', toBase: 2.365882365e-4 },
    { id: 'pt', name: 'US pint', plural: 'US pints', symbol: 'pt', toBase: 4.73176473e-4 },
    { id: 'pt-uk', name: 'imperial pint', plural: 'imperial pints', symbol: 'pt (imp)', toBase: 5.6826125e-4,
      note: 'The UK pint is about 20% larger than the US one.' },
    { id: 'qt', name: 'US quart', plural: 'US quarts', symbol: 'qt', toBase: 9.46352946e-4 },
    { id: 'l', name: 'litre', plural: 'litres', symbol: 'L', toBase: 1e-3 },
    { id: 'gal', name: 'US gallon', plural: 'US gallons', symbol: 'gal', toBase: 3.785411784e-3 },
    { id: 'gal-uk', name: 'imperial gallon', plural: 'imperial gallons', symbol: 'gal (imp)', toBase: 4.54609e-3,
      note: 'The UK gallon is about 20% larger than the US one.' },
    { id: 'ft3', name: 'cubic foot', plural: 'cubic feet', symbol: 'ft³', toBase: 0.028316846592 },
    { id: 'm3', name: 'cubic metre', plural: 'cubic metres', symbol: 'm³', toBase: 1 },
  ]),
  ...group('speed', [
    { id: 'cm/s', name: 'centimetre per second', plural: 'centimetres per second', symbol: 'cm/s', toBase: 1e-2 },
    { id: 'ft/min', name: 'foot per minute', plural: 'feet per minute', symbol: 'ft/min', toBase: 0.3048 / 60 },
    { id: 'km/h', name: 'kilometre per hour', plural: 'kilometres per hour', symbol: 'km/h', toBase: 1000 / 3600 },
    { id: 'ft/s', name: 'foot per second', plural: 'feet per second', symbol: 'ft/s', toBase: 0.3048 },
    { id: 'mph', name: 'mile per hour', plural: 'miles per hour', symbol: 'mph', toBase: 1609.344 / 3600 },
    { id: 'kn', name: 'knot', plural: 'knots', symbol: 'kn', toBase: 1852 / 3600,
      note: 'One nautical mile an hour.' },
    { id: 'm/s', name: 'metre per second', plural: 'metres per second', symbol: 'm/s', toBase: 1 },
    { id: 'km/s', name: 'kilometre per second', plural: 'kilometres per second', symbol: 'km/s', toBase: 1e3 },
    { id: 'mach', name: 'Mach', plural: 'Mach', symbol: 'Mach', toBase: 340.29,
      note: 'Taken here as 340.29 m/s, the speed of sound in dry air at sea level and 15 °C. It drops with altitude and temperature, so treat it as a reference figure rather than a constant.' },
  ]),
  ...group('time', [
    { id: 'ns', name: 'nanosecond', plural: 'nanoseconds', symbol: 'ns', toBase: 1e-9 },
    { id: 'us', name: 'microsecond', plural: 'microseconds', symbol: 'µs', toBase: 1e-6 },
    { id: 'ms', name: 'millisecond', plural: 'milliseconds', symbol: 'ms', toBase: 1e-3 },
    { id: 's', name: 'second', plural: 'seconds', symbol: 's', toBase: 1 },
    { id: 'min', name: 'minute', plural: 'minutes', symbol: 'min', toBase: 60 },
    { id: 'h', name: 'hour', plural: 'hours', symbol: 'h', toBase: 3600 },
    { id: 'd', name: 'day', plural: 'days', symbol: 'd', toBase: 86400 },
    { id: 'wk', name: 'week', plural: 'weeks', symbol: 'wk', toBase: 604800 },
    { id: 'fortnight', name: 'fortnight', plural: 'fortnights', symbol: 'fortnight', toBase: 1209600 },
    { id: 'mo', name: 'month', plural: 'months', symbol: 'mo', toBase: 2629746,
      note: 'An average Gregorian month: 30.436875 days. Real months run from 28 to 31 days, so use this for rough arithmetic only.' },
    { id: 'yr', name: 'year', plural: 'years', symbol: 'yr', toBase: 31556952,
      note: 'An average Gregorian year: 365.2425 days, which accounts for leap years.' },
    { id: 'decade', name: 'decade', plural: 'decades', symbol: 'decade', toBase: 315569520 },
  ]),
  ...group('data', [
    { id: 'bit', name: 'bit', plural: 'bits', symbol: 'bit', toBase: 1 },
    { id: 'B', name: 'byte', plural: 'bytes', symbol: 'B', toBase: 8 },
    { id: 'kbit', name: 'kilobit', plural: 'kilobits', symbol: 'kbit', toBase: 1e3,
      note: 'Connection speeds are quoted in bits per second, not bytes: 8 Mbit/s downloads at about 1 MB/s.' },
    { id: 'kB', name: 'kilobyte', plural: 'kilobytes', symbol: 'kB', toBase: 8e3, note: DECIMAL_BYTES },
    { id: 'KiB', name: 'kibibyte', plural: 'kibibytes', symbol: 'KiB', toBase: 8 * 1024, note: BINARY_BYTES },
    { id: 'Mbit', name: 'megabit', plural: 'megabits', symbol: 'Mbit', toBase: 1e6 },
    { id: 'MB', name: 'megabyte', plural: 'megabytes', symbol: 'MB', toBase: 8e6, note: DECIMAL_BYTES },
    { id: 'MiB', name: 'mebibyte', plural: 'mebibytes', symbol: 'MiB', toBase: 8 * 1024 ** 2, note: BINARY_BYTES },
    { id: 'Gbit', name: 'gigabit', plural: 'gigabits', symbol: 'Gbit', toBase: 1e9 },
    { id: 'GB', name: 'gigabyte', plural: 'gigabytes', symbol: 'GB', toBase: 8e9, note: DECIMAL_BYTES },
    { id: 'GiB', name: 'gibibyte', plural: 'gibibytes', symbol: 'GiB', toBase: 8 * 1024 ** 3, note: BINARY_BYTES },
    { id: 'TB', name: 'terabyte', plural: 'terabytes', symbol: 'TB', toBase: 8e12, note: DECIMAL_BYTES },
    { id: 'TiB', name: 'tebibyte', plural: 'tebibytes', symbol: 'TiB', toBase: 8 * 1024 ** 4, note: BINARY_BYTES },
    { id: 'PB', name: 'petabyte', plural: 'petabytes', symbol: 'PB', toBase: 8e15, note: DECIMAL_BYTES },
  ]),
  ...group('pressure', [
    { id: 'Pa', name: 'pascal', plural: 'pascals', symbol: 'Pa', toBase: 1 },
    { id: 'hPa', name: 'hectopascal', plural: 'hectopascals', symbol: 'hPa', toBase: 100 },
    { id: 'mbar', name: 'millibar', plural: 'millibars', symbol: 'mbar', toBase: 100,
      note: 'Identical to a hectopascal. Weather reports use one or the other.' },
    { id: 'torr', name: 'torr', plural: 'torr', symbol: 'Torr', toBase: 101325 / 760 },
    { id: 'mmHg', name: 'millimetre of mercury', plural: 'millimetres of mercury', symbol: 'mmHg',
      toBase: 133.322387415,
      note: 'Blood pressure is quoted in these. It differs from the torr by about one part in seven million.' },
    { id: 'inHg', name: 'inch of mercury', plural: 'inches of mercury', symbol: 'inHg',
      toBase: 25.4 * 133.322387415 },
    { id: 'kPa', name: 'kilopascal', plural: 'kilopascals', symbol: 'kPa', toBase: 1e3 },
    { id: 'psi', name: 'pound per square inch', plural: 'pounds per square inch', symbol: 'psi',
      toBase: 4.4482216152605 / 0.00064516 },
    { id: 'bar', name: 'bar', plural: 'bars', symbol: 'bar', toBase: 1e5 },
    { id: 'atm', name: 'standard atmosphere', plural: 'standard atmospheres', symbol: 'atm', toBase: 101325,
      note: 'Average air pressure at sea level, and the definition of the atmosphere: exactly 101,325 Pa.' },
    { id: 'MPa', name: 'megapascal', plural: 'megapascals', symbol: 'MPa', toBase: 1e6 },
  ]),
  ...group('energy', [
    { id: 'eV', name: 'electronvolt', plural: 'electronvolts', symbol: 'eV', toBase: 1.602176634e-19 },
    { id: 'erg', name: 'erg', plural: 'ergs', symbol: 'erg', toBase: 1e-7 },
    { id: 'J', name: 'joule', plural: 'joules', symbol: 'J', toBase: 1 },
    { id: 'cal', name: 'calorie', plural: 'calories', symbol: 'cal', toBase: 4.184,
      note: 'The thermochemical calorie. A food label says "calorie" but means the kilocalorie, which is 1,000 of these.' },
    { id: 'ftlb', name: 'foot-pound', plural: 'foot-pounds', symbol: 'ft·lb', toBase: 1.3558179483314004 },
    { id: 'kJ', name: 'kilojoule', plural: 'kilojoules', symbol: 'kJ', toBase: 1e3 },
    { id: 'BTU', name: 'British thermal unit', plural: 'British thermal units', symbol: 'BTU',
      toBase: 1055.05585262, note: 'The international-table BTU, used for heating and air-conditioning ratings.' },
    { id: 'kcal', name: 'kilocalorie', plural: 'kilocalories', symbol: 'kcal', toBase: 4184,
      note: 'The "calorie" printed on food packaging.' },
    { id: 'Wh', name: 'watt hour', plural: 'watt hours', symbol: 'Wh', toBase: 3600 },
    { id: 'MJ', name: 'megajoule', plural: 'megajoules', symbol: 'MJ', toBase: 1e6 },
    { id: 'kWh', name: 'kilowatt hour', plural: 'kilowatt hours', symbol: 'kWh', toBase: 3.6e6,
      note: 'The unit an electricity bill is measured in.' },
    { id: 'therm', name: 'therm', plural: 'therms', symbol: 'therm', toBase: 105505585.262,
      note: 'Exactly 100,000 BTU. Gas bills often use it.' },
    { id: 'MWh', name: 'megawatt hour', plural: 'megawatt hours', symbol: 'MWh', toBase: 3.6e9 },
  ]),
  ...group('angle', [
    { id: 'arcsec', name: 'arcsecond', plural: 'arcseconds', symbol: '″', toBase: DEG / 3600 },
    { id: 'arcmin', name: 'arcminute', plural: 'arcminutes', symbol: '′', toBase: DEG / 60 },
    { id: 'mrad', name: 'milliradian', plural: 'milliradians', symbol: 'mrad', toBase: 1e-3 },
    { id: 'deg', name: 'degree', plural: 'degrees', symbol: '°', toBase: DEG },
    { id: 'grad', name: 'gradian', plural: 'gradians', symbol: 'gon', toBase: DEG * 0.9,
      note: '400 gradians make a full turn. Used in surveying.' },
    { id: 'rad', name: 'radian', plural: 'radians', symbol: 'rad', toBase: 1 },
    { id: 'point', name: 'compass point', plural: 'compass points', symbol: 'point', toBase: DEG * 11.25,
      note: '32 points make a full turn: the old compass rose.' },
    { id: 'sextant', name: 'sextant', plural: 'sextants', symbol: 'sextant', toBase: DEG * 60 },
    { id: 'quadrant', name: 'quadrant', plural: 'quadrants', symbol: 'quadrant', toBase: DEG * 90 },
    { id: 'turn', name: 'turn', plural: 'turns', symbol: 'turn', toBase: DEG * 360 },
  ]),
];

/**
 * Lookup tables built once at module load.
 *
 * Ids and symbols are registered before names and plurals, so a unit's short
 * form can never be shadowed by another unit's spelled-out name. Three passes,
 * cheapest first, resolve a key:
 *  1. Exactly as written, because case genuinely carries meaning here — Mb is a
 *     megabit and MB is a megabyte, eight times larger.
 *  2. Case-insensitively, so "KG" and "5 KM" work.
 *  3. Folded: lower-cased, with µ written as u and spaces removed, so "fl oz",
 *     "floz" and "FL OZ" all land on the same unit.
 */
const EXACT = new Map<string, UnitDef>();
const FOLDED = new Map<string, UnitDef>();

function foldKey(text: string): string {
  return text.toLowerCase().replace(/µ/g, 'u').replace(/\s+/g, '');
}

function register(key: string, unit: UnitDef): void {
  if (key === '') return;
  if (!EXACT.has(key)) EXACT.set(key, unit);
  const folded = foldKey(key);
  if (!FOLDED.has(folded)) FOLDED.set(folded, unit);
}

for (const unit of UNITS) {
  register(unit.id, unit);
  register(unit.symbol, unit);
}
for (const unit of UNITS) {
  register(unit.name, unit);
  register(unit.plural, unit);
}

/** Every unit in a category, in table order. A fresh array, so callers may sort it. */
export function unitsIn(category: UnitCategory): UnitDef[] {
  return UNITS.filter((unit) => unit.category === category);
}

/** Resolves an id, a symbol, a name or a plural. Returns undefined rather than throwing. */
export function findUnit(idOrSymbol: string): UnitDef | undefined {
  if (typeof idOrSymbol !== 'string') return undefined;
  const key = idOrSymbol.trim();
  if (key === '') return undefined;
  return EXACT.get(key) ?? FOLDED.get(key.toLowerCase()) ?? FOLDED.get(foldKey(key));
}

/**
 * Significant figures kept when a converted value becomes text. Ten is enough to
 * write 1,609.344 out in full, and few enough that binary rounding noise — the
 * 1.0000000000000002 that makes a converter look broken — never reaches the page.
 */
const SIGNIFICANT_FIGURES = 10;
/** Above and below these, a grouped digit string is either fake precision or unreadable. */
const EXPONENTIAL_ABOVE = 1e16;
const EXPONENTIAL_BELOW = 1e-9;

function significantDecimals(value: number): number {
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  return Math.min(20, Math.max(0, SIGNIFICANT_FIGURES - 1 - magnitude));
}

/**
 * Decimal places the shortest round-trip form of a number actually uses, so a
 * value that needs three of them is not padded to ten or cut back to two.
 * `String(1.5e-7)` is "1.5e-7", which needs eight.
 */
function naturalDecimals(value: number): number {
  const match = /^([0-9]*)(?:\.([0-9]+))?(?:e([+-][0-9]+))?$/.exec(String(Math.abs(value)));
  if (!match) return 0;
  const fraction = (match[2] ?? '').length;
  const exponent = match[3] === undefined ? 0 : Number(match[3]);
  return Math.max(0, fraction - exponent);
}

/** Compact scientific form for the far ends of the scale, e.g. "1.602177e-19". */
function exponentialText(value: number): string {
  const [mantissa = '', exponent = ''] = value.toExponential(6).split('e');
  const trimmed = mantissa.includes('.')
    ? mantissa.replace(/0+$/, '').replace(/\.$/, '')
    : mantissa;
  return `${trimmed}e${exponent}`;
}

/** The one place a converted number becomes a string. Never "NaN", never noise. */
function formatValue(value: number): string {
  if (!isRealNumber(value)) return '—';
  if (value === 0) return display(0);
  const magnitude = Math.abs(value);
  if (magnitude >= EXPONENTIAL_ABOVE || magnitude < EXPONENTIAL_BELOW) return exponentialText(value);
  const tidy = roundTo(value, significantDecimals(value));
  return display(tidy, Math.min(20, Math.max(smartDecimals(tidy), naturalDecimals(tidy))));
}

const UNWORKABLE = 'These units do not produce a number we can show. Please check them and try again.';

function toBaseValue(value: number, unit: UnitDef): number {
  return value * unit.toBase + (unit.offset ?? 0);
}

/**
 * Out of the base unit, with cancellation noise snapped to zero.
 *
 * 32 °F is exactly 0 °C, but the two scales meet at 255.372…, and subtracting two
 * doubles that agree to fifteen digits leaves −7.1e-15 rather than 0. A result
 * more than twelve orders of magnitude below the terms that produced it is that
 * noise, not a measurement, and rendering it as "−7.105427e-15" is the single
 * most embarrassing thing a converter can do.
 *
 * Units that only scale are untouched by this: with no offset the threshold works
 * out to the answer's own magnitude, so nothing is ever snapped.
 */
function fromBaseValue(base: number, unit: UnitDef): number {
  const offset = unit.offset ?? 0;
  const out = (base - offset) / unit.toBase;
  const scale = Math.max(Math.abs(base), Math.abs(offset)) / Math.abs(unit.toBase);
  return Math.abs(out) < scale * 1e-12 ? 0 : out;
}

function unknownUnit(text: string): Failure {
  return fail(`We do not recognise the unit “${text}”. Choose one from the list.`);
}

/** The unit a category measures in: the one worth exactly one base unit, with no offset. */
function baseUnitOf(category: UnitCategory): UnitDef | undefined {
  return UNITS.find((unit) => unit.category === category && unit.toBase === 1 && !unit.offset);
}

/**
 * The working, on one line.
 *
 * A straight ratio for units that only scale — that is the number a reader can
 * check on a phone. Temperature has an offset, so a single multiplier would be
 * a lie; those show the hop through the base unit instead, which is what the
 * code actually does.
 */
function buildFormula(value: number, from: UnitDef, to: UnitDef, base: number, out: number): string {
  const valueText = formatValue(value);
  if (from.id === to.id) return `${valueText} ${from.symbol} is already in ${to.plural}`;
  if (!from.offset && !to.offset) {
    return `${valueText} ${from.symbol} × ${formatValue(from.toBase / to.toBase)} = ${formatValue(out)} ${to.symbol}`;
  }
  const via = baseUnitOf(from.category);
  const middle = via && via.id !== from.id ? ` → ${formatValue(base)} ${via.symbol}` : '';
  return `${valueText} ${from.symbol}${middle} → ${formatValue(out)} ${to.symbol}`;
}

export interface ConversionSuccess {
  ok: true;
  /** Full precision. Use `formatted` for the page and this for further maths. */
  value: number;
  formatted: string;
  formula: string;
}

/**
 * One value, one pair of units. Both directions go through the base unit, so a
 * conversion and its reverse can never disagree.
 */
export function convert(value: number, from: string, to: string): ConversionSuccess | Failure {
  if (!isRealNumber(value)) return fail('Enter the amount you want to convert.');
  const fromText = typeof from === 'string' ? from.trim() : String(from ?? '');
  const toText = typeof to === 'string' ? to.trim() : String(to ?? '');
  // An empty box is not an unrecognised unit, and saying so would read as nonsense.
  if (fromText === '') return fail('Choose the unit you are converting from.');
  if (toText === '') return fail('Choose the unit you are converting to.');
  const source = findUnit(fromText);
  if (!source) return unknownUnit(fromText);
  const target = findUnit(toText);
  if (!target) return unknownUnit(toText);

  if (source.category !== target.category) {
    return fail(
      `A ${source.name} measures ${CATEGORY_LABELS[source.category].toLowerCase()} and a ` +
        `${target.name} measures ${CATEGORY_LABELS[target.category].toLowerCase()}, ` +
        'so one cannot be converted into the other.',
    );
  }

  const base = toBaseValue(value, source);
  const out = fromBaseValue(base, target);
  if (!isRealNumber(out)) return fail(UNWORKABLE);

  return { ok: true, value: out, formatted: formatValue(out), formula: buildFormula(value, source, target, base, out) };
}

export interface ConvertedUnit {
  unit: UnitDef;
  value: number;
  formatted: string;
}

/**
 * The same amount in every other unit of its category — the table that makes a
 * converter useful rather than merely correct. The source unit is left out,
 * because a row reading "5 km = 5 km" earns its space nowhere.
 */
export function convertAll(value: number, from: string): { ok: true; results: ConvertedUnit[] } | Failure {
  if (!isRealNumber(value)) return fail('Enter the amount you want to convert.');
  const fromText = typeof from === 'string' ? from.trim() : String(from ?? '');
  if (fromText === '') return fail('Choose the unit you are converting from.');
  const source = findUnit(fromText);
  if (!source) return unknownUnit(fromText);

  const base = toBaseValue(value, source);
  const results: ConvertedUnit[] = [];
  for (const unit of unitsIn(source.category)) {
    if (unit.id === source.id) continue;
    const out = fromBaseValue(base, unit);
    if (!isRealNumber(out)) continue;
    results.push({ unit, value: out, formatted: formatValue(out) });
  }
  if (results.length === 0) return fail(UNWORKABLE);
  return { ok: true, results };
}

/** Characters that can belong to the number half of "1,024 MiB". */
function isNumberChar(character: string): boolean {
  return /[0-9,.+\-\s'’_]/.test(character);
}

/**
 * Split "5.5 km" into "5.5" and "km" by walking forward while the characters
 * could still be part of a number.
 *
 * An `e` is only taken as an exponent when a digit sits behind it and digits
 * follow it, so "1e3 m" parses as a thousand metres while the `e` of "1 erg"
 * stays with the unit.
 */
function splitQuantity(text: string): { number: string; unit: string } | null {
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    if (isNumberChar(character)) {
      index += 1;
      continue;
    }
    if ((character === 'e' || character === 'E') && index > 0 && /[0-9]/.test(text.charAt(index - 1))) {
      let peek = index + 1;
      if (text.charAt(peek) === '+' || text.charAt(peek) === '-') peek += 1;
      if (/[0-9]/.test(text.charAt(peek))) {
        index = peek + 1;
        continue;
      }
    }
    break;
  }
  const number = text.slice(0, index);
  if (!/[0-9]/.test(number)) return null;
  return { number, unit: text.slice(index).trim() };
}

/**
 * Free text to a value and a unit: "5.5 km", "72°F", "3ft", "1,024 MiB", "-40 C".
 *
 * Unicode minus and en dash are read as a minus sign, because that is what a
 * copy-and-paste from a web page or a spreadsheet contains.
 */
export function parseQuantity(input: string): { ok: true; value: number; unit: UnitDef } | Failure {
  if (typeof input !== 'string' || input.trim() === '') {
    return fail('Type an amount and a unit, such as “5.5 km”.');
  }
  const text = input.trim().replace(/[−–—]/g, '-');
  const split = splitQuantity(text);
  if (!split) return fail(`We could not find a number in “${text}”. Try something like “5.5 km”.`);
  if (split.unit === '') return fail(`Add a unit after “${split.number.trim()}”, such as “km”.`);

  const value = parseLooseNumber(split.number);
  if (value === null) return fail(`“${split.number.trim()}” is not an amount we can read.`);
  const unit = findUnit(split.unit);
  if (!unit) return unknownUnit(split.unit);
  return { ok: true, value, unit };
}
