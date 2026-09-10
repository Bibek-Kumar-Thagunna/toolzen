/**
 * Calendar arithmetic for the date calculators, and the shared primitives that
 * age.ts builds on.
 *
 * Timezone policy, stated once because every off-by-one bug in a date tool comes
 * from getting this wrong: everything here works in **UTC**. A `Date` is read by
 * its UTC calendar fields, and a `YYYY-MM-DD` string is anchored to UTC midnight.
 * The engine is therefore pure and DST-proof, and the timezone decision belongs
 * to the UI: a client component knows the user's offset, so it should format the
 * local calendar day as `YYYY-MM-DD` and pass that string in. `<input type=
 * "date">` already produces exactly that.
 */

import { display, fail, isRealNumber } from './round.ts';
import type { Explained, Failure } from './round.ts';

const MS_PER_DAY = 86_400_000;

/** A calendar date with no time and no zone. `month` is 1-12, not 0-11. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** What every public function here accepts for a date. */
export type DateInput = Date | string;

/** Proleptic Gregorian, which is what every calendar app on earth uses. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 30;
}

/**
 * Days since 1970-01-01. Built with setUTCFullYear rather than Date.UTC because
 * Date.UTC maps years 0-99 into the 1900s, which would silently corrupt any
 * historical date.
 */
export function civilToDayNumber(civil: CivilDate): number {
  const date = new Date(0);
  date.setUTCFullYear(civil.year, civil.month - 1, civil.day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.round(date.getTime() / MS_PER_DAY);
}
export function dayNumberToCivil(dayNumber: number): CivilDate {
  const date = new Date(dayNumber * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** UTC midnight on that calendar day. Safe to hand to the UI or to Intl. */
export function civilToDate(civil: CivilDate): Date {
  return new Date(civilToDayNumber(civil) * MS_PER_DAY);
}

export function toIsoDate(civil: CivilDate): string {
  const year = String(civil.year).padStart(4, '0');
  const month = String(civil.month).padStart(2, '0');
  const day = String(civil.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 0 = Sunday … 6 = Saturday. Day 0 of the epoch was a Thursday. */
export function dayOfWeek(dayNumber: number): number {
  return ((dayNumber % 7) + 11) % 7;
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export function weekdayName(dayNumber: number): WeekdayName {
  return WEEKDAY_NAMES[dayOfWeek(dayNumber)] ?? 'Sunday';
}

/**
 * Saturday and Sunday. Deliberately not configurable: a Fri/Sat weekend is a
 * real requirement in parts of the world, but guessing it from a browser locale
 * would be worse than not offering it, and the holidays list covers the cases
 * that matter most.
 */
export function isWeekend(dayNumber: number): boolean {
  const dow = dayOfWeek(dayNumber);
  return dow === 0 || dow === 6;
}

function isValidCivil(civil: CivilDate): boolean {
  return (
    Number.isInteger(civil.year) &&
    Number.isInteger(civil.month) &&
    Number.isInteger(civil.day) &&
    civil.year >= 1 &&
    civil.year <= 9999 &&
    civil.month >= 1 &&
    civil.month <= 12 &&
    civil.day >= 1 &&
    civil.day <= daysInMonth(civil.year, civil.month)
  );
}
export interface ParseDateOptions {
  /**
   * How to read a slashed date whose first two numbers are both 1-12.
   * Defaults to false (month first) to match the site locale, but `warnings`
   * always reports which reading was used, so the UI can offer a toggle rather
   * than letting the user find out from a wrong answer.
   */
  dayFirst?: boolean;
}

export interface ParsedDate {
  ok: true;
  date: Date;
  civil: CivilDate;
  iso: string;
  dayNumber: number;
  /** Non-fatal notes. Render them; ambiguity the user cannot see is a bug. */
  warnings: string[];
}

export type ParseDateResult = ParsedDate | Failure;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const ISO_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const SLASHED_PATTERN = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/;

/** POSIX two-digit year window: 69-99 is last century, 00-68 is this one. */
function expandTwoDigitYear(year: number): number {
  return year >= 69 ? 1900 + year : 2000 + year;
}

function ok(civil: CivilDate, warnings: string[]): ParsedDate {
  const dayNumber = civilToDayNumber(civil);
  return {
    ok: true,
    civil,
    dayNumber,
    date: new Date(dayNumber * MS_PER_DAY),
    iso: toIsoDate(civil),
    warnings,
  };
}

function noSuchDate(civil: CivilDate): Failure {
  if (civil.month < 1 || civil.month > 12) {
    return fail(`There is no month ${civil.month} — months run from 1 to 12.`);
  }
  if (civil.year < 1 || civil.year > 9999) {
    return fail('Enter a year between 1 and 9999.');
  }
  const name = MONTH_NAMES[civil.month - 1] ?? 'that month';
  return fail(`There is no ${civil.day} ${name} in ${civil.year}.`);
}
/**
 * Parse `YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY`. Also accepts `.` or `-` as
 * the separator, a two-digit year, and a full ISO timestamp (the time is
 * discarded — these calculators work in whole days).
 *
 * A slashed date is only ambiguous when both leading numbers could be a month.
 * 25/12/2026 can only be day-first and is read as such with no warning; 12/03/2026
 * genuinely cannot be resolved from the text, so `dayFirst` decides and a warning
 * records the decision.
 */
export function parseDateInput(value: DateInput, options: ParseDateOptions = {}): ParseDateResult {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fail('That date could not be read. Enter it as YYYY-MM-DD.');
    const civil = { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
    return isValidCivil(civil) ? ok(civil, []) : noSuchDate(civil);
  }
  if (typeof value !== 'string') return fail('Enter a date.');

  const trimmed = value.trim();
  if (trimmed === '') return fail('Enter a date.');

  // Tolerate a full timestamp so a round-tripped toISOString() just works.
  const text = trimmed.split(/[T\s]/)[0] ?? trimmed;
  const warnings: string[] = [];

  const iso = ISO_PATTERN.exec(text);
  if (iso) {
    const civil = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return isValidCivil(civil) ? ok(civil, warnings) : noSuchDate(civil);
  }

  const slashed = SLASHED_PATTERN.exec(text);
  if (!slashed) {
    return fail('Enter the date as YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY.');
  }

  const first = Number(slashed[1]);
  const second = Number(slashed[2]);
  const rawYear = slashed[3] ?? '';
  const year = rawYear.length === 2 ? expandTwoDigitYear(Number(rawYear)) : Number(rawYear);
  if (rawYear.length === 2) {
    warnings.push(`A two-digit year is guesswork: "${rawYear}" was read as ${year}.`);
  }

  let dayFirst = options.dayFirst ?? false;
  if (first > 12 && second <= 12) {
    dayFirst = true; // 25/12/2026 — only one reading is possible.
  } else if (second > 12 && first <= 12) {
    dayFirst = false;
  } else if (first <= 12 && second <= 12 && first !== second) {
    warnings.push(
      `${text} could be read either way round. Taken as ${dayFirst ? 'day' : 'month'} first.`,
    );
  }

  const civil = dayFirst
    ? { year, month: second, day: first }
    : { year, month: first, day: second };
  return isValidCivil(civil) ? ok(civil, warnings) : noSuchDate(civil);
}
/** Anything the small helpers below will take. */
export type DateLike = DateInput | CivilDate;

function isCivilDate(value: DateLike): value is CivilDate {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && 'year' in value;
}

/**
 * Normalise to a CivilDate, or null when the input cannot be read. Callers that
 * must report a problem to the user should use `parseDateInput` instead, which
 * carries a sentence explaining what was wrong.
 */
export function toCivilDate(value: DateLike): CivilDate | null {
  if (isCivilDate(value)) return isValidCivil(value) ? value : null;
  const parsed = parseDateInput(value);
  return parsed.ok ? parsed.civil : null;
}

/**
 * 1-366. Returns 0 — never NaN — when the date cannot be read, since 0 is not a
 * valid day of the year and so cannot be mistaken for an answer.
 */
export function dayOfYear(value: DateLike): number {
  const civil = toCivilDate(value);
  if (!civil) return 0;
  return civilToDayNumber(civil) - civilToDayNumber({ year: civil.year, month: 1, day: 1 }) + 1;
}

/**
 * ISO 8601 week number, 1-53. Weeks start on Monday and week 1 is the week
 * containing the first Thursday of January, which is why the last days of
 * December can belong to week 1 of the following year — see `isoWeekYear`.
 * Returns 0 when the date cannot be read.
 */
export function isoWeekNumber(value: DateLike): number {
  const civil = toCivilDate(value);
  if (!civil) return 0;
  const thursday = isoThursday(civilToDayNumber(civil));
  const year = dayNumberToCivil(thursday).year;
  const firstThursday = isoThursday(civilToDayNumber({ year, month: 1, day: 4 }));
  return 1 + Math.round((thursday - firstThursday) / 7);
}

/** The year the ISO week belongs to, which is not always the calendar year. */
export function isoWeekYear(value: DateLike): number {
  const civil = toCivilDate(value);
  if (!civil) return 0;
  return dayNumberToCivil(isoThursday(civilToDayNumber(civil))).year;
}

/** The Thursday of the ISO week containing `dayNumber`. */
function isoThursday(dayNumber: number): number {
  const mondayBased = (dayOfWeek(dayNumber) + 6) % 7;
  return dayNumber - mondayBased + 3;
}
/**
 * Add whole months, clamping to the end of the target month.
 *
 * 31 January + 1 month is 28 February, or 29 February in a leap year. There is
 * no 31 February, so something has to give, and every calendar application
 * (and every spreadsheet EDATE) clamps to the last valid day rather than
 * spilling into March. The corollary worth knowing: this is not reversible.
 * 31 Jan + 1 month − 1 month is 28 Feb − 1 month = 28 Jan, not 31 Jan.
 */
export function addMonthsClamped(civil: CivilDate, months: number): CivilDate {
  const monthIndex = civil.year * 12 + (civil.month - 1) + months;
  const year = Math.floor(monthIndex / 12);
  // Not `monthIndex % 12`: JS keeps the sign of the dividend, which would give
  // month 0 or a negative month for dates before year 0.
  const month = monthIndex - year * 12 + 1;
  return { year, month, day: Math.min(civil.day, daysInMonth(year, month)) };
}

export interface CalendarBreakdown {
  years: number;
  months: number;
  days: number;
}

/**
 * Split the span between two dates into whole years, whole months and leftover
 * days. `from` must not be after `to`.
 *
 * The rule is that a month has passed only when the day of the month comes round
 * again, so 29 Feb 1996 → 28 Feb 2026 is 29 years 11 months 30 days, not 30
 * years: the 29th never arrives in 2026. That one case is why this is calendar
 * borrow logic and not `totalDays / 365.25`.
 *
 * Mechanically: count the whole months by month index, drop one if the day of
 * the month has not been reached, then anchor that many months onto `from` (with
 * end-of-month clamping) and count the plain days from the anchor to `to`. The
 * borrowed days therefore come from the month *preceding* the end date — 30 in
 * the example above, because January has 31 days — rather than from the start
 * month, which is the mistake that puts these calculators out by a day or three.
 *
 * The invariant, asserted over random ranges in the tests:
 *   addDays(addMonthsClamped(from, years * 12 + months), days) === to
 */
export function calendarBreakdown(from: CivilDate, to: CivilDate): CalendarBreakdown {
  let totalMonths = (to.year - from.year) * 12 + (to.month - from.month);
  if (to.day < from.day) totalMonths -= 1;
  if (totalMonths < 0) totalMonths = 0;

  const anchor = addMonthsClamped(from, totalMonths);
  const days = civilToDayNumber(to) - civilToDayNumber(anchor);

  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days,
  };
}
/**
 * Monday-to-Friday days in the half-open range [startDay, endDay).
 *
 * O(1): every whole week contributes exactly five, and only the ragged tail of
 * at most six days needs looking at. The tests check this against a brute-force
 * loop over hundreds of random ranges, because a formula like this is very easy
 * to get right for the common case and wrong at the boundaries.
 */
export function countWeekdays(startDay: number, endDay: number): number {
  if (endDay <= startDay) return 0;
  const total = endDay - startDay;
  const wholeWeeks = Math.floor(total / 7);
  let weekdays = wholeWeeks * 5;
  for (let day = startDay + wholeWeeks * 7; day < endDay; day += 1) {
    if (!isWeekend(day)) weekdays += 1;
  }
  return weekdays;
}

interface ResolvedDate {
  ok: true;
  civil: CivilDate;
  dayNumber: number;
  warnings: string[];
}

function resolve(value: DateInput, label: string, options: ParseDateOptions): ResolvedDate | Failure {
  const parsed = parseDateInput(value, options);
  if (!parsed.ok) return fail(`${label}: ${parsed.error}`);
  return { ok: true, civil: parsed.civil, dayNumber: parsed.dayNumber, warnings: parsed.warnings };
}

export interface DateDifferenceInput extends ParseDateOptions {
  from: DateInput;
  to: DateInput;
  /**
   * Count the end date itself as a whole day. Off by default, because a
   * difference is a duration: 1 January to 2 January is one day. Turn it on for
   * "how many days am I away for", where both ends are days you are away.
   */
  includeEndDate?: boolean;
}

export interface DateDifferenceSuccess extends Explained, CalendarBreakdown {
  totalDays: number;
  /** Whole weeks, with `remainderDays` left over. */
  weeks: number;
  remainderDays: number;
  weekdays: number;
  weekendDays: number;
  totalHours: number;
  totalMinutes: number;
  /** ISO dates actually used, after any swap. */
  fromIso: string;
  toIso: string;
  /** True when the dates were given the wrong way round and quietly swapped. */
  reversed: boolean;
  warnings: string[];
}

export type DateDifferenceResult = ({ ok: true } & DateDifferenceSuccess) | Failure;
/**
 * How long between two dates, in every unit anyone asks for.
 *
 * Dates given the wrong way round are swapped rather than rejected — people type
 * them in whatever order the form happens to focus — and `reversed` records it so
 * the page can say so.
 *
 * `includeEndDate` is applied by extending the span to the start of the day after
 * `to`, so the calendar breakdown, the day count and the weekday count all agree
 * instead of drifting apart by one.
 */
export function dateDifference(input: DateDifferenceInput): DateDifferenceResult {
  const a = resolve(input.from, 'Start date', input);
  if (!a.ok) return a;
  const b = resolve(input.to, 'End date', input);
  if (!b.ok) return b;

  const reversed = b.dayNumber < a.dayNumber;
  const earlier = reversed ? b : a;
  const later = reversed ? a : b;

  const inclusiveExtra = input.includeEndDate ? 1 : 0;
  const endDay = later.dayNumber + inclusiveExtra;
  const endCivil = inclusiveExtra ? dayNumberToCivil(endDay) : later.civil;

  const totalDays = endDay - earlier.dayNumber;
  const breakdown = calendarBreakdown(earlier.civil, endCivil);
  const weekdays = countWeekdays(earlier.dayNumber, endDay);

  const warnings = [...earlier.warnings, ...later.warnings];
  if (reversed) warnings.push('The dates were the other way round, so they were swapped.');

  return {
    ok: true,
    ...breakdown,
    totalDays,
    weeks: Math.floor(totalDays / 7),
    remainderDays: totalDays % 7,
    weekdays,
    weekendDays: totalDays - weekdays,
    totalHours: totalDays * 24,
    totalMinutes: totalDays * 24 * 60,
    fromIso: toIsoDate(earlier.civil),
    toIso: toIsoDate(later.civil),
    reversed,
    warnings,
    formula: `${toIsoDate(earlier.civil)} → ${toIsoDate(later.civil)}${input.includeEndDate ? ' (end date included)' : ''}`,
    steps: [
      { label: 'Whole years, months and days', value: `${breakdown.years}y ${breakdown.months}m ${breakdown.days}d` },
      { label: 'Total days', value: display(totalDays) },
      { label: 'Weeks and days', value: `${Math.floor(totalDays / 7)}w ${totalDays % 7}d` },
      { label: 'Mon-Fri days', value: display(weekdays) },
      { label: 'Weekend days', value: display(totalDays - weekdays) },
    ],
  };
}
export interface AddToDateInput extends ParseDateOptions {
  date: DateInput;
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  /**
   * Count the weeks/days part in working days, skipping Saturday and Sunday.
   * Years and months stay calendar units — "3 business months" is not a thing —
   * and holidays are not applied here; use `businessDaysBetween` for that.
   */
  businessDaysOnly?: boolean;
}

export interface AddToDateSuccess extends Explained {
  date: Date;
  iso: string;
  civil: CivilDate;
  dayOfWeek: WeekdayName;
  /** Days actually moved, which differs from the input when skipping weekends. */
  netDays: number;
  /** True when a month-end date was clamped, e.g. 31 Jan + 1 month → 28 Feb. */
  clamped: boolean;
  warnings: string[];
}

export type AddToDateResult = ({ ok: true } & AddToDateSuccess) | Failure;

/** Step `count` working days from `dayNumber`, in either direction. */
function advanceBusinessDays(dayNumber: number, count: number): number {
  const step = count < 0 ? -1 : 1;
  let remaining = Math.abs(count);
  let current = dayNumber;
  while (remaining > 0) {
    current += step;
    if (!isWeekend(current)) remaining -= 1;
  }
  return current;
}

export function addToDate(input: AddToDateInput): AddToDateResult {
  const start = resolve(input.date, 'Date', input);
  if (!start.ok) return start;

  const parts: Array<[number | undefined, string]> = [
    [input.years, 'Years must be a whole number.'],
    [input.months, 'Months must be a whole number.'],
    [input.weeks, 'Weeks must be a whole number.'],
    [input.days, 'Days must be a whole number.'],
  ];
  for (const [value, message] of parts) {
    if (value !== undefined && (!isRealNumber(value) || !Number.isInteger(value))) return fail(message);
  }

  const years = input.years ?? 0;
  const months = input.months ?? 0;
  const weeks = input.weeks ?? 0;
  const days = input.days ?? 0;
  // With businessDaysOnly a week is five working days, not seven, so "2 weeks
  // and 3 days" means thirteen working days rather than seventeen.
  const dayCount = input.businessDaysOnly ? weeks * 5 + days : weeks * 7 + days;

  const shifted = addMonthsClamped(start.civil, years * 12 + months);
  const clamped = shifted.day !== start.civil.day;
  const shiftedDay = civilToDayNumber(shifted);
  const finalDay = input.businessDaysOnly
    ? advanceBusinessDays(shiftedDay, dayCount)
    : shiftedDay + dayCount;

  if (!Number.isFinite(finalDay) || Math.abs(finalDay) > 3_000_000) {
    return fail('That lands outside the range of dates this calculator handles.');
  }

  const civil = dayNumberToCivil(finalDay);
  const warnings = [...start.warnings];
  if (clamped) {
    warnings.push(
      `${toIsoDate(start.civil)} has no matching day in that month, so it was moved back to ${toIsoDate(shifted)}.`,
    );
  }

  const pieces: string[] = [];
  if (years) pieces.push(`${years} year${Math.abs(years) === 1 ? '' : 's'}`);
  if (months) pieces.push(`${months} month${Math.abs(months) === 1 ? '' : 's'}`);
  if (weeks) pieces.push(`${weeks} week${Math.abs(weeks) === 1 ? '' : 's'}`);
  if (days) pieces.push(`${days} day${Math.abs(days) === 1 ? '' : 's'}`);

  return {
    ok: true,
    date: new Date(finalDay * MS_PER_DAY),
    iso: toIsoDate(civil),
    civil,
    dayOfWeek: weekdayName(finalDay),
    netDays: finalDay - start.dayNumber,
    clamped,
    warnings,
    formula: `${toIsoDate(start.civil)} ${pieces.length ? `+ ${pieces.join(' + ')}` : 'unchanged'}${input.businessDaysOnly ? ', working days only' : ''}`,
    steps: [
      { label: 'After years and months', value: toIsoDate(shifted) },
      { label: input.businessDaysOnly ? 'Working days added' : 'Days added', value: display(dayCount) },
      { label: 'Result', value: `${toIsoDate(civil)} (${weekdayName(finalDay)})` },
    ],
  };
}
export interface BusinessDaysInput extends ParseDateOptions {
  from: DateInput;
  to: DateInput;
  /** `YYYY-MM-DD` dates to skip. Duplicates and weekend entries are ignored. */
  holidays?: string[];
  /**
   * Defaults to **true** here, unlike `dateDifference`. "How many working days
   * between Monday and Friday" means five, not four, which is also what Excel's
   * NETWORKDAYS answers. The two functions genuinely answer different questions:
   * one counts a duration, this one counts the days you will be at work.
   */
  includeEndDate?: boolean;
}

export interface BusinessDaysSuccess extends Explained {
  businessDays: number;
  /** Mon-Fri days before holidays were taken off. */
  weekdays: number;
  weekendDays: number;
  totalDays: number;
  /** Holidays that actually fell on a working day inside the range. */
  holidaysApplied: string[];
  /** Entries that were ignored, with the reason. */
  holidaysIgnored: Array<{ value: string; reason: string }>;
  fromIso: string;
  toIso: string;
  reversed: boolean;
  warnings: string[];
}

export type BusinessDaysResult = ({ ok: true } & BusinessDaysSuccess) | Failure;

export function businessDaysBetween(input: BusinessDaysInput): BusinessDaysResult {
  const a = resolve(input.from, 'Start date', input);
  if (!a.ok) return a;
  const b = resolve(input.to, 'End date', input);
  if (!b.ok) return b;

  const reversed = b.dayNumber < a.dayNumber;
  const earlier = reversed ? b : a;
  const later = reversed ? a : b;

  const endDay = later.dayNumber + ((input.includeEndDate ?? true) ? 1 : 0);
  const totalDays = Math.max(0, endDay - earlier.dayNumber);
  const weekdays = countWeekdays(earlier.dayNumber, endDay);

  const holidaysApplied: string[] = [];
  const holidaysIgnored: Array<{ value: string; reason: string }> = [];
  const seen = new Set<number>();

  for (const entry of input.holidays ?? []) {
    const parsed = parseDateInput(entry, input);
    if (!parsed.ok) {
      holidaysIgnored.push({ value: String(entry), reason: 'could not be read as a date' });
      continue;
    }
    const day = parsed.dayNumber;
    if (day < earlier.dayNumber || day >= endDay) {
      holidaysIgnored.push({ value: parsed.iso, reason: 'outside the range' });
    } else if (isWeekend(day)) {
      holidaysIgnored.push({ value: parsed.iso, reason: 'already a weekend' });
    } else if (seen.has(day)) {
      holidaysIgnored.push({ value: parsed.iso, reason: 'listed twice' });
    } else {
      seen.add(day);
      holidaysApplied.push(parsed.iso);
    }
  }
  const businessDays = weekdays - holidaysApplied.length;
  const warnings = [...earlier.warnings, ...later.warnings];
  if (reversed) warnings.push('The dates were the other way round, so they were swapped.');

  return {
    ok: true,
    businessDays,
    weekdays,
    weekendDays: totalDays - weekdays,
    totalDays,
    holidaysApplied: holidaysApplied.sort(),
    holidaysIgnored,
    fromIso: toIsoDate(earlier.civil),
    toIso: toIsoDate(later.civil),
    reversed,
    warnings,
    formula: 'Mon-Fri days in the range, minus public holidays that fall on a working day',
    steps: [
      { label: 'Calendar days counted', value: display(totalDays) },
      { label: 'Mon-Fri days', value: display(weekdays) },
      { label: 'Holidays taken off', value: display(holidaysApplied.length) },
      { label: 'Working days', value: display(businessDays) },
    ],
  };
}
