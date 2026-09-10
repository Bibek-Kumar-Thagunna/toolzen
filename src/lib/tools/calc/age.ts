/**
 * Age calculator.
 *
 * Pure whenever `asOf` is supplied — which every page and every test does — so
 * there is no hidden clock and a test can pin the date; omitting it falls back to
 * today's UTC day. Like dates.ts it works entirely in UTC calendar days and
 * ignores the time of day — nobody wants their age reported to the minute, and
 * pretending to that precision would only introduce timezone bugs.
 */

import {
  addMonthsClamped,
  calendarBreakdown,
  civilToDayNumber,
  dayNumberToCivil,
  daysInMonth,
  parseDateInput,
  toIsoDate,
  weekdayName,
} from './dates.ts';
import type { CivilDate, DateInput, ParseDateOptions, WeekdayName } from './dates.ts';
import { display, fail } from './round.ts';
import type { Explained, Failure } from './round.ts';

const MS_PER_DAY = 86_400_000;

export const ZODIAC_SIGNS = [
  'Capricorn', 'Aquarius', 'Pisces', 'Aries', 'Taurus', 'Gemini',
  'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius',
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

/**
 * Conventional tropical-zodiac cut-offs: the first day of each sign, by month.
 * The sun's actual ingress wobbles by up to a day from year to year, so these are
 * the popular dates rather than an ephemeris — which is the right trade for a
 * fun field next to the real answer.
 */
const ZODIAC_STARTS: Array<{ month: number; day: number; sign: ZodiacSign }> = [
  { month: 1, day: 20, sign: 'Aquarius' },
  { month: 2, day: 19, sign: 'Pisces' },
  { month: 3, day: 21, sign: 'Aries' },
  { month: 4, day: 20, sign: 'Taurus' },
  { month: 5, day: 21, sign: 'Gemini' },
  { month: 6, day: 21, sign: 'Cancer' },
  { month: 7, day: 23, sign: 'Leo' },
  { month: 8, day: 23, sign: 'Virgo' },
  { month: 9, day: 23, sign: 'Libra' },
  { month: 10, day: 23, sign: 'Scorpio' },
  { month: 11, day: 22, sign: 'Sagittarius' },
  { month: 12, day: 22, sign: 'Capricorn' },
];
/** The sign for a calendar date, using the conventional cut-offs above. */
export function zodiacSign(civil: CivilDate): ZodiacSign {
  const start = ZODIAC_STARTS[civil.month - 1];
  if (!start) return 'Capricorn';
  if (civil.day >= start.day) return start.sign;
  // Before the cut-off you belong to the sign that began in the previous month.
  const previous = ZODIAC_STARTS[(civil.month + 10) % 12];
  return previous ? previous.sign : 'Capricorn';
}

export const CHINESE_ZODIAC_ANIMALS = [
  'Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake',
  'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig',
] as const;

export type ChineseZodiacAnimal = (typeof CHINESE_ZODIAC_ANIMALS)[number];

/**
 * The animal for a Gregorian year. 1924, 1936 … 2020 are Rat years, hence the
 * offset of 4.
 *
 * Caveat, surfaced to the user rather than buried: the Chinese year begins at
 * Chinese New Year, which falls somewhere between 21 January and 20 February.
 * Someone born before that date belongs to the *previous* animal. Pinning the
 * exact new-year date needs a lunisolar ephemeris, so instead of quietly being
 * wrong for six weeks of every year the result carries `chineseZodiacUncertain`
 * for dates before 21 February.
 */
export function chineseZodiacAnimal(year: number): ChineseZodiacAnimal {
  const index = (((year - 4) % 12) + 12) % 12;
  return CHINESE_ZODIAC_ANIMALS[index] ?? 'Rat';
}

/**
 * True when the animal above cannot be trusted, i.e. any birth date before
 * 21 February — see the note on `chineseZodiacAnimal`.
 */
function chineseZodiacIsUncertain(civil: CivilDate): boolean {
  return civil.month === 1 || (civil.month === 2 && civil.day < 21);
}

/**
 * The date on which the birthday is *observed* in `year`.
 *
 * Leap-day convention: a 29 February birthday is observed on **28 February** in
 * a common year. `addMonthsClamped` already clamps to the end of the target
 * month, so one call covers that case and leaves every other date untouched.
 *
 * The asymmetry with `years`/`months`/`days` is deliberate. Those stay strict
 * calendar arithmetic, so on 28 February 2026 someone born on 29 February 1996
 * is still 29 years, 11 months and 30 days old — the 29th has not come round —
 * even though 28 February is the day they blow out thirty candles. For that one
 * day, in common years, for leap-day births only, `nextBirthday.turning` reads
 * one more than `years`.
 */
function observedBirthday(birth: CivilDate, year: number): CivilDate {
  return addMonthsClamped(birth, (year - birth.year) * 12);
}

/**
 * "January 2026 (31 days)" — names the month a day borrow drew on, so the page
 * can show where the leftover days came from. Locale and time zone are pinned so
 * a server render, a client re-render and CI all produce the same string.
 */
function monthLabel(civil: CivilDate): string {
  const firstOfMonth = civilToDayNumber({ year: civil.year, month: civil.month, day: 1 });
  const name = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(firstOfMonth * MS_PER_DAY),
  );
  return `${name} ${civil.year} (${daysInMonth(civil.year, civil.month)} days)`;
}

/** "1 day", "2 days", "0 days" — the formula and the steps are read by people. */
function plural(count: number, noun: string): string {
  return `${display(count)} ${noun}${Math.abs(count) === 1 ? '' : 's'}`;
}

export interface AgeInput extends ParseDateOptions {
  birthDate: DateInput;
  /**
   * The day to measure to. Defaults to today's UTC calendar day, but every page
   * and every test passes it explicitly: a client knows the visitor's offset, so
   * it should send their local day as `YYYY-MM-DD` and get an answer that turns
   * over at their midnight rather than at UTC's.
   */
  asOf?: DateInput;
}

export interface AgeResult extends Explained {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  /** Whole weeks lived. The odd days are in the shown working. */
  totalWeeks: number;
  /** Whole calendar months lived — `years * 12 + months`, not days / 30. */
  totalMonths: number;
  totalHours: number;
  totalMinutes: number;
  nextBirthday: {
    /** `YYYY-MM-DD`, observed — so 28 February for a leap-day birth in a common year. */
    date: string;
    /** 0 when it is today. Never negative. */
    inDays: number;
    dayOfWeek: WeekdayName;
    /** The age reached on that date. */
    turning: number;
  };
  bornOnDayOfWeek: WeekdayName;
  zodiac: string;
  chineseZodiac: ChineseZodiacAnimal;
  /** True when Chinese New Year makes the animal a coin toss. Show it. */
  chineseZodiacUncertain: boolean;
  isBirthdayToday: boolean;
}

/**
 * How old someone is on a given day, plus the trimmings people come to an age
 * calculator for.
 *
 * The years/months/days split is calendar borrow logic delegated to
 * `calendarBreakdown` — never `totalDays / 365.25`, which is out by a day or
 * more for most people and by three for a leap-day birth. Everything else is
 * counted in whole UTC days, so a daylight-saving change cannot move an
 * answer by one.
 */
export function calculateAge(input: AgeInput): { ok: true; result: AgeResult } | Failure {
  const birth = parseDateInput(input.birthDate, input);
  if (!birth.ok) return fail(`Date of birth: ${birth.error}`);

  const asOf = parseDateInput(input.asOf ?? new Date(), input);
  if (!asOf.ok) return fail(`Date to measure to: ${asOf.error}`);

  if (birth.dayNumber > asOf.dayNumber) {
    return fail(
      `That date of birth is in the future: ${birth.iso} comes after ${asOf.iso}. Check the year.`,
    );
  }

  const { years, months, days } = calendarBreakdown(birth.civil, asOf.civil);
  const totalDays = asOf.dayNumber - birth.dayNumber;
  const totalMonths = years * 12 + months;

  // The most recent monthly anniversary. The leftover `days` are counted from
  // here, so when it sits in the previous month this is the month the borrow
  // drew its length from.
  const anchor = addMonthsClamped(birth.civil, totalMonths);
  const borrowed = anchor.year !== asOf.civil.year || anchor.month !== asOf.civil.month;

  // The birthday in this year if it is still to come (or is today), otherwise
  // next year's. Decided by day number, so the date, the weekday and the
  // countdown can never describe different days.
  const thisYear = civilToDayNumber(observedBirthday(birth.civil, asOf.civil.year));
  const nextDay =
    thisYear >= asOf.dayNumber
      ? thisYear
      : civilToDayNumber(observedBirthday(birth.civil, asOf.civil.year + 1));
  const nextCivil = dayNumberToCivil(nextDay);
  const inDays = nextDay - asOf.dayNumber;
  const turning = nextCivil.year - birth.civil.year;

  const steps = [
    {
      label: 'Age',
      value: `${plural(years, 'year')}, ${plural(months, 'month')}, ${plural(days, 'day')}`,
    },
    { label: 'Whole months lived', value: display(totalMonths) },
    { label: 'Last monthly anniversary', value: toIsoDate(anchor) },
    {
      label: 'Days since then',
      value: borrowed
        ? `${display(days)}, borrowed from ${monthLabel(anchor)}`
        : display(days),
    },
    { label: 'Total days', value: display(totalDays) },
    {
      label: 'Total weeks',
      value: `${plural(Math.floor(totalDays / 7), 'week')} and ${plural(totalDays % 7, 'day')}`,
    },
    { label: 'Total hours', value: display(totalDays * 24) },
    { label: 'Total minutes', value: display(totalDays * 24 * 60) },
    { label: 'Born on a', value: weekdayName(birth.dayNumber) },
    {
      label: inDays === 0 ? 'Birthday' : 'Next birthday',
      value:
        inDays === 0
          ? `Today — turning ${display(turning)}`
          : `${toIsoDate(nextCivil)} (${weekdayName(nextDay)}), ${plural(inDays, 'day')} away — turning ${display(turning)}`,
    },
    // AgeResult has no warnings field, and an ambiguity the reader cannot see is
    // a bug, so anything the parser flagged is shown as part of the working.
    ...[...birth.warnings, ...asOf.warnings].map((note) => ({ label: 'Note', value: note })),
  ];

  return {
    ok: true,
    result: {
      years,
      months,
      days,
      totalDays,
      totalWeeks: Math.floor(totalDays / 7),
      totalMonths,
      totalHours: totalDays * 24,
      totalMinutes: totalDays * 24 * 60,
      nextBirthday: {
        date: toIsoDate(nextCivil),
        inDays,
        dayOfWeek: weekdayName(nextDay),
        turning,
      },
      bornOnDayOfWeek: weekdayName(birth.dayNumber),
      zodiac: zodiacSign(birth.civil),
      chineseZodiac: chineseZodiacAnimal(birth.civil.year),
      chineseZodiacUncertain: chineseZodiacIsUncertain(birth.civil),
      isBirthdayToday: inDays === 0,
      formula: `${birth.iso} to ${asOf.iso} = ${plural(years, 'year')} + ${plural(months, 'month')} + ${plural(days, 'day')} (${plural(totalDays, 'day')} in all)`,
      steps,
    },
  };
}

