/**
 * Shared numeric plumbing for every calculator engine.
 *
 * Two jobs live here:
 *   1. Rounding that behaves the way a person expects rather than the way
 *      IEEE-754 binary floats happen to fall out (`roundTo`).
 *   2. Turning a full-precision number into the string the page renders
 *      (`smartDecimals`, `formatNumber`), and turning whatever the user typed
 *      back into a number (`parseLooseNumber`).
 *
 * Nothing here touches the DOM, the network or the clock, so the engines can be
 * imported from a Server Component, a Client Component or a unit test alike.
 */

/** One line of shown working: a short label and an already-formatted value. */
export interface Step {
  label: string;
  value: string;
}

/**
 * Mixed into every calculator result. The product promise is that each page
 * shows its working, so the engine — not the React component — owns both the
 * formula string and the ordered intermediate values.
 */
export interface Explained {
  /** Human-readable formula with the user's actual numbers substituted in. */
  formula: string;
  /** Ordered intermediate steps, each a short label + value string. */
  steps: Step[];
}

/**
 * The failure half of every engine's return type. `error` is rendered verbatim,
 * so it is always a complete sentence aimed at a non-technical reader.
 */
export interface Failure {
  ok: false;
  error: string;
}

export function fail(error: string): Failure {
  return { ok: false, error };
}

/**
 * True only for numbers we are willing to hand to the UI. Engines run this over
 * user input and over anything a division produced, because the one thing a
 * calculator must never render is `NaN` or `Infinity`.
 */
export function isRealNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
/**
 * Multiply `value` by 10^shift by editing its decimal exponent as text.
 *
 * `1.005 * 100` is 100.49999999999999, because neither 1.005 nor the product is
 * representable in binary. `Number('1.005e2')` is exactly 100.5, because the
 * decimal literal is parsed once, directly to the nearest double. That single
 * difference is what makes `roundTo` agree with a pocket calculator.
 */
function shiftExponent(value: number, shift: number): number {
  const text = String(value);
  const scientific = /^([+-]?[0-9]*\.?[0-9]+)[eE]([+-]?[0-9]+)$/.exec(text);
  if (scientific) {
    return Number(`${scientific[1]}e${Number(scientific[2]) + shift}`);
  }
  return Number(`${text}e${shift}`);
}

/**
 * Used when the exponent-shifted path overflows or underflows (|value| close to
 * Number.MAX_VALUE or Number.MIN_VALUE). `toFixed` is the one that gets 1.005
 * wrong, which is why it is the fallback rather than the implementation.
 */
function fixedFallback(value: number, places: number): number {
  const out = Number(value.toFixed(places));
  return Number.isFinite(out) ? out : value;
}

/**
 * Round half away from zero to `decimals` places.
 *
 * Half away from zero — rather than `Math.round`'s half up — is what people mean
 * by "to 2 dp": -1.005 becomes -1.01, not -1.00.
 *
 * Correct for the cases that catch out the naive `Math.round(v * 100) / 100`:
 *   roundTo(1.005, 2)  === 1.01
 *   roundTo(2.675, 2)  === 2.68
 *   roundTo(-1.005, 2) === -1.01
 */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const places = Math.min(100, Math.max(0, Math.trunc(decimals) || 0));

  const shifted = shiftExponent(value, places);
  if (!Number.isFinite(shifted)) return fixedFallback(value, places);

  const rounded = shifted < 0 ? -Math.round(-shifted) : Math.round(shifted);
  const restored = shiftExponent(rounded, -places);
  if (!Number.isFinite(restored)) return fixedFallback(value, places);

  // Normalise -0 to 0 so a value rounded away from zero never renders as "-0".
  return restored === 0 ? 0 : restored;
}
/** Round money. Only ever called at the boundary of a calculation, never inside a loop. */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

/**
 * How many decimal places make a number informative without making it noisy.
 *
 * Integers show none. Anything at or above 1 shows two, which is what money and
 * percentages want. Below 1 we keep roughly four significant digits so that
 * 0.000123 does not collapse to "0.00".
 *
 * This is a *maximum*: `formatNumber` does not pad with trailing zeros unless
 * asked to, so 0.5 still renders as "0.5" rather than "0.5000".
 */
export function smartDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Number.isInteger(value)) return 0;
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  const magnitude = Math.floor(Math.log10(abs)); // -1 for 0.5, -4 for 0.000123
  return Math.min(10, 3 - magnitude);
}

export interface FormatNumberOptions {
  /** Maximum fraction digits. Defaults to `smartDecimals(value)`, or 2 for currency. */
  decimals?: number;
  /** Also pin the *minimum* fraction digits, so 2 renders as "2.00". */
  padDecimals?: boolean;
  /** Group thousands. Default true. */
  thousands?: boolean;
  /** ISO 4217 code such as 'GBP'. Implies `padDecimals`. */
  currency?: string;
  /**
   * BCP 47 tag. Defaults to 'en-US' rather than the host default, so a
   * calculator produces the same string during a server render, a client
   * re-render and in CI.
   */
  locale?: string;
}

/** Never returns "NaN" or "∞"; non-finite input renders as an em dash. */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  if (!Number.isFinite(value)) return '—';
  const requested = options.decimals ?? (options.currency ? 2 : smartDecimals(value));
  const decimals = Math.min(20, Math.max(0, Math.trunc(requested) || 0));
  const pad = options.padDecimals ?? options.currency !== undefined;
  const intl: Intl.NumberFormatOptions = {
    useGrouping: options.thousands ?? true,
    minimumFractionDigits: pad ? decimals : 0,
    maximumFractionDigits: decimals,
  };
  if (options.currency) {
    intl.style = 'currency';
    intl.currency = options.currency;
  }
  return new Intl.NumberFormat(options.locale ?? 'en-US', intl).format(value);
}
/** The engine-side default for any plain number handed to the page. */
export function display(value: number, decimals?: number): string {
  return formatNumber(value, { decimals: decimals ?? smartDecimals(value) });
}

/** Money inside the shown working: always two decimals, always grouped. */
export function displayMoney(value: number): string {
  return formatNumber(value, { decimals: 2, padDecimals: true });
}

/** A percentage inside the shown working. Trailing zeros are trimmed. */
export function displayPercent(value: number, decimals?: number): string {
  return `${formatNumber(value, { decimals: decimals ?? Math.max(2, smartDecimals(value)) })}%`;
}

/**
 * Normalise a lone `,` or `.` in an otherwise clean numeric string.
 *
 * The asymmetry is deliberate, because the two characters are not equally
 * ambiguous in practice:
 *  - A lone comma followed by exactly three digits is a thousands group, so
 *    "1,234" is 1234. A comma followed by anything else is a decimal comma, so
 *    "1,5" is 1.5.
 *  - A lone dot is always a decimal point, so "1.234" is 1.234 — never 1234.
 *    Writing a dot as a thousands separator implies a locale that also writes a
 *    decimal comma, and such input almost always contains a comma too (handled
 *    before this function) or repeats the dot (handled below).
 *  - A repeated separator can only be a thousands group: "1.234.567", and also
 *    "1,00,000" — the Indian lakh grouping puts two digits in the middle groups,
 *    so the check below accepts groups of two or three rather than three only.
 *    Anything else (e.g. "1..2") is left alone for the caller's final numeric
 *    regex to reject.
 */
function normaliseLoneSeparator(text: string, separator: ',' | '.'): string {
  const parts = text.split(separator);
  if (parts.length > 2) {
    const looksGrouped =
      /^[+-]?\d{1,3}$/.test(parts[0] ?? '') &&
      parts.slice(1).every((part) => /^\d{2,3}$/.test(part));
    return looksGrouped ? parts.join('') : text;
  }
  const head = parts[0] ?? '';
  const tail = parts[1] ?? '';
  if (separator === ',' && /^\d{3}$/.test(tail) && /^[+-]?\d+$/.test(head)) {
    return head + tail;
  }
  return `${head}.${tail}`;
}
/**
 * Tolerant parse of whatever a person typed into a number field.
 *
 * Accepts thousands separators (comma, ordinary space, non-breaking space,
 * apostrophe, underscore), a leading or trailing currency symbol, a percent
 * sign, accounting negatives in parentheses, scientific notation, and a comma
 * used as the decimal separator.
 *
 * Two conventions worth stating, because the input is genuinely ambiguous:
 *  - When both `.` and `,` are present, whichever appears *last* is the decimal
 *    separator. "1,234.56" and "1.234,56" therefore both parse to 1234.56.
 *  - A percent sign is stripped, not divided by 100: "12%" is 12, because every
 *    calculator here takes a percentage as a whole number.
 *
 * Returns null — never NaN — when the input is not a number.
 */
export function parseLooseNumber(input: string): number | null {
  if (typeof input !== 'string') return null;

  let text = input.trim();
  if (text === '') return null;

  // Accounting negative: "(1,234.56)" means -1234.56.
  let negative = false;
  if (text.length > 2 && text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text
    .replace(/\p{Sc}/gu, '') // any Unicode currency symbol: $ € £ ¥ ₹ ₽ ฿ …
    .replace(/%/g, '')
    // `\s` already covers NBSP, thin space and figure space in JS regexes.
    .replace(/[\s'’_]/g, '');
  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    text = text.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    text = normaliseLoneSeparator(text, ',');
  } else if (lastDot !== -1) {
    text = normaliseLoneSeparator(text, '.');
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
