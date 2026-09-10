import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateAge } from './age.ts';
import type { AgeResult } from './age.ts';
import { addMonthsClamped, civilToDayNumber, daysInMonth, toIsoDate } from './dates.ts';
import type { Failure } from './round.ts';

type AgeOutcome = { ok: true; result: AgeResult } | Failure;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectOk(outcome: AgeOutcome): AgeResult {
  if (!outcome.ok) assert.fail(`expected success, got error: ${outcome.error}`);
  return outcome.result;
}

function expectFail(outcome: AgeOutcome): string {
  if (outcome.ok) assert.fail('expected a friendly error, got a result');
  return outcome.error;
}

/** The value of one line of the shown working, by label. */
function step(result: AgeResult, label: string): string {
  const found = result.steps.find((entry) => entry.label === label);
  assert.ok(found, `expected a step labelled "${label}"`);
  return found.value;
}

/** Whole days between two ISO dates, computed independently of dates.ts. */
function utcDayDifference(fromIso: string, toIso: string): number {
  const [fromYear = 0, fromMonth = 1, fromDay = 1] = fromIso.split('-').map(Number);
  const [toYear = 0, toMonth = 1, toDay = 1] = toIso.split('-').map(Number);
  const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const to = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86_400_000);
}
/** Every number the page might render, so a NaN cannot slip through unnoticed. */
function assertAllNumbersReal(result: AgeResult): void {
  const numbers = [
    result.years, result.months, result.days,
    result.totalDays, result.totalWeeks, result.totalMonths,
    result.totalHours, result.totalMinutes,
    result.nextBirthday.inDays, result.nextBirthday.turning,
  ];
  for (const value of numbers) {
    assert.ok(Number.isFinite(value), `expected a real number, got ${value}`);
  }
  assert.ok(!/NaN|Infinity|undefined/.test(result.formula), result.formula);
  for (const entry of result.steps) {
    assert.ok(!/NaN|Infinity|undefined/.test(entry.value), `${entry.label}: ${entry.value}`);
  }
}

test('a leap-day birth on 28 February of a common year: 29 years, 11 months, 30 days', () => {
  const result = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-02-28' }));

  // Not 30 years: the 29th never arrives in 2026, so the last completed month
  // ended on 29 January and the leftover days run from there.
  assert.equal(result.years, 29);
  assert.equal(result.months, 11);
  assert.equal(result.days, 30);
  assert.equal(result.totalMonths, 29 * 12 + 11);
  assert.equal(result.totalDays, utcDayDifference('1996-02-29', '2026-02-28'));

  assert.equal(step(result, 'Last monthly anniversary'), '2026-01-29');
  assert.match(step(result, 'Days since then'), /borrowed from January 2026 \(31 days\)/);
  assertAllNumbersReal(result);
});
test('the day borrow takes its length from February, the preceding month', () => {
  // One month after 31 January is the end of February — 29 February in 2000 —
  // and 1 March is one day past it. The pair below pins the borrow to the real
  // length of February rather than to 28, 30 or 31 days.
  const leap = expectOk(calculateAge({ birthDate: '2000-01-31', asOf: '2000-03-01' }));
  assert.deepEqual([leap.years, leap.months, leap.days], [0, 1, 1]);
  assert.equal(step(leap, 'Last monthly anniversary'), '2000-02-29');
  assert.match(step(leap, 'Days since then'), /borrowed from February 2000 \(29 days\)/);
  assert.equal(leap.totalDays, daysInMonth(2000, 2) + 1, '29 days of February, then 1 March');
  assert.equal(leap.totalDays, 30);
  assert.equal(step(leap, 'Age'), '0 years, 1 month, 1 day', 'the working reads as English');

  const common = expectOk(calculateAge({ birthDate: '2001-01-31', asOf: '2001-03-01' }));
  assert.deepEqual([common.years, common.months, common.days], [0, 1, 1]);
  assert.equal(step(common, 'Last monthly anniversary'), '2001-02-28');
  assert.match(step(common, 'Days since then'), /borrowed from February 2001 \(28 days\)/);
  assert.equal(common.totalDays, daysInMonth(2001, 2) + 1);
  assert.equal(common.totalDays, 29, 'one day shorter than the leap year, same 1m 1d');
});

test('a birthday today: no countdown, and the age just turned', () => {
  const result = expectOk(calculateAge({ birthDate: '1990-06-15', asOf: '2026-06-15' }));

  assert.equal(result.isBirthdayToday, true);
  assert.equal(result.nextBirthday.inDays, 0);
  assert.equal(result.nextBirthday.date, '2026-06-15');
  assert.equal(result.nextBirthday.dayOfWeek, 'Monday');
  assert.equal(result.nextBirthday.turning, 36);
  assert.deepEqual([result.years, result.months, result.days], [36, 0, 0]);
  assert.equal(result.nextBirthday.turning, result.years, 'turning is the age just reached');
  assert.equal(result.bornOnDayOfWeek, 'Friday');
  assert.match(step(result, 'Birthday'), /Today — turning 36/);
  assertAllNumbersReal(result);

  // The day before, they are still 35 and the countdown is one day.
  const eve = expectOk(calculateAge({ birthDate: '1990-06-15', asOf: '2026-06-14' }));
  assert.equal(eve.years, 35);
  assert.equal(eve.isBirthdayToday, false);
  assert.equal(eve.nextBirthday.inDays, 1);
  assert.equal(eve.nextBirthday.turning, 36);
});
test('a date of birth in the future is refused, in plain words', () => {
  const error = expectFail(calculateAge({ birthDate: '2026-09-04', asOf: '2026-09-03' }));
  assert.match(error, /future/);
  assert.match(error, /2026-09-04/);
  assert.ok(!/NaN|Infinity/.test(error), error);

  // The same day is fine; only later is refused.
  assert.equal(expectOk(calculateAge({ birthDate: '2026-09-03', asOf: '2026-09-03' })).years, 0);
});

test('a leap-day birthday is observed on 28 February in a common year', () => {
  const beforeIt = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-01-01' }));
  assert.equal(beforeIt.nextBirthday.date, '2026-02-28');
  assert.equal(beforeIt.nextBirthday.inDays, 58);
  assert.equal(beforeIt.nextBirthday.turning, 30);

  const afterIt = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-03-01' }));
  assert.equal(afterIt.nextBirthday.date, '2027-02-28', 'next year is common too');
  assert.equal(afterIt.nextBirthday.dayOfWeek, 'Sunday');
  assert.equal(afterIt.nextBirthday.turning, 31);
  assert.deepEqual([afterIt.years, afterIt.months, afterIt.days], [30, 0, 1]);

  // In a leap year the real date is available and is used.
  const leapYear = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2028-01-01' }));
  assert.equal(leapYear.nextBirthday.date, '2028-02-29');
  assert.equal(leapYear.nextBirthday.inDays, 59);
  assert.equal(leapYear.nextBirthday.turning, 32);

  // Observed on the 28th, so the countdown is over while `years` still says 29:
  // the documented one-day disagreement for leap-day births in a common year.
  const observed = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-02-28' }));
  assert.equal(observed.isBirthdayToday, true);
  assert.equal(observed.nextBirthday.inDays, 0);
  assert.equal(observed.nextBirthday.turning, 30);
  assert.equal(observed.years, 29);
});
test('a newborn: refused the day before, zero on the day itself', () => {
  assert.match(expectFail(calculateAge({ birthDate: '2026-01-15', asOf: '2026-01-14' })), /future/);

  const born = expectOk(calculateAge({ birthDate: '2026-01-15', asOf: '2026-01-15' }));
  assert.deepEqual([born.years, born.months, born.days], [0, 0, 0]);
  assert.equal(born.totalDays, 0);
  assert.equal(born.totalWeeks, 0);
  assert.equal(born.totalMonths, 0);
  assert.equal(born.totalHours, 0);
  assert.equal(born.totalMinutes, 0);
  assert.equal(born.isBirthdayToday, true);
  assert.equal(born.nextBirthday.date, '2026-01-15');
  assert.equal(born.nextBirthday.inDays, 0);
  assert.equal(born.nextBirthday.turning, 0);
  assertAllNumbersReal(born);
});

test('totalDays matches an independent UTC millisecond difference, 50 random pairs', () => {
  const random = mulberry32(29021996);

  for (let index = 0; index < 50; index += 1) {
    const year = 1900 + Math.floor(random() * 150);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * daysInMonth(year, month));
    const offset = Math.floor(random() * 40_000);

    // The end date is built by adding milliseconds to a UTC timestamp and
    // reading the result's UTC fields — no help from dates.ts.
    const birth = { year, month, day };
    const moved = new Date(Date.UTC(year, month - 1, day) + offset * 86_400_000);
    const asOf = {
      year: moved.getUTCFullYear(),
      month: moved.getUTCMonth() + 1,
      day: moved.getUTCDate(),
    };
    const birthIso = toIsoDate(birth);
    const asOfIso = toIsoDate(asOf);
    const label = `${birthIso} to ${asOfIso}`;
    const result = expectOk(calculateAge({ birthDate: birthIso, asOf: asOfIso }));

    assert.equal(result.totalDays, utcDayDifference(birthIso, asOfIso), label);
    assert.equal(result.totalDays, offset, label);
    assert.equal(result.totalWeeks, Math.floor(offset / 7), label);
    assert.equal(result.totalHours, offset * 24, label);
    assert.equal(result.totalMinutes, offset * 24 * 60, label);
    assert.equal(result.totalMonths, result.years * 12 + result.months, label);

    // The breakdown must rebuild the end date exactly: whole months onto the
    // date of birth, then the leftover days.
    const anchor = addMonthsClamped(birth, result.totalMonths);
    assert.equal(civilToDayNumber(anchor) + result.days, civilToDayNumber(asOf), label);
    assert.ok(result.days >= 0 && result.days <= 31, `${label}: ${result.days} days`);
    assert.ok(result.months >= 0 && result.months <= 11, `${label}: ${result.months} months`);
    assert.ok(result.nextBirthday.inDays >= 0 && result.nextBirthday.inDays <= 366, label);
    assertAllNumbersReal(result);
  }
});
test('zodiac signs use the conventional cusp dates', () => {
  const signOf = (iso: string): string =>
    expectOk(calculateAge({ birthDate: iso, asOf: '2026-09-03' })).zodiac;

  assert.equal(signOf('2000-01-19'), 'Capricorn');
  assert.equal(signOf('2000-01-20'), 'Aquarius');
  assert.equal(signOf('1996-02-29'), 'Pisces');
  assert.equal(signOf('2000-03-20'), 'Pisces');
  assert.equal(signOf('2000-03-21'), 'Aries');
  assert.equal(signOf('2000-07-22'), 'Cancer');
  assert.equal(signOf('2000-07-23'), 'Leo');
  assert.equal(signOf('2000-12-21'), 'Sagittarius');
  assert.equal(signOf('2000-12-22'), 'Capricorn');
});

test('the Chinese animal is flagged when Chinese New Year makes it a guess', () => {
  const late = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-09-03' }));
  assert.equal(late.chineseZodiac, 'Rat');
  assert.equal(late.chineseZodiacUncertain, false, 'after 20 February the year is settled');

  const early = expectOk(calculateAge({ birthDate: '1996-01-15', asOf: '2026-09-03' }));
  assert.equal(early.chineseZodiac, 'Rat');
  assert.equal(early.chineseZodiacUncertain, true, 'might still be the Pig');

  assert.equal(expectOk(calculateAge({ birthDate: '2020-06-01', asOf: '2026-09-03' })).chineseZodiac, 'Rat');
  assert.equal(expectOk(calculateAge({ birthDate: '2021-06-01', asOf: '2026-09-03' })).chineseZodiac, 'Ox');
});
test('unreadable dates say which field was wrong, and ambiguity is shown', () => {
  const impossible = expectFail(calculateAge({ birthDate: '1995-02-29', asOf: '2026-09-03' }));
  assert.match(impossible, /Date of birth/);
  assert.match(impossible, /no 29 February in 1995/);
  assert.match(expectFail(calculateAge({ birthDate: 'yesterday', asOf: '2026-09-03' })), /YYYY-MM-DD/);
  assert.match(expectFail(calculateAge({ birthDate: '1990-06-15', asOf: 'soon' })), /measure to/);

  const ambiguous = expectOk(calculateAge({ birthDate: '12/03/1990', asOf: '2026-09-03' }));
  assert.match(step(ambiguous, 'Note'), /either way round/);
  assert.ok(ambiguous.formula.startsWith('1990-12-03'), `month first by default: ${ambiguous.formula}`);

  const ukStyle = expectOk(calculateAge({ birthDate: '12/03/1990', asOf: '2026-09-03', dayFirst: true }));
  assert.ok(ukStyle.formula.startsWith('1990-03-12'), ukStyle.formula);
});

test('asOf defaults to today, and the working carries the real numbers', () => {
  const today = expectOk(calculateAge({ birthDate: '2000-01-01' }));
  assert.ok(today.years >= 25 && today.years < 200, `implausible age: ${today.years}`);
  assertAllNumbersReal(today);

  const pinned = expectOk(calculateAge({ birthDate: '1996-02-29', asOf: '2026-02-28' }));
  assert.equal(
    pinned.formula,
    '1996-02-29 to 2026-02-28 = 29 years + 11 months + 30 days (10,957 days in all)',
  );
  assert.equal(step(pinned, 'Age'), '29 years, 11 months, 30 days');
  assert.equal(step(pinned, 'Whole months lived'), '359');
  assert.equal(step(pinned, 'Total days'), '10,957');
  assert.equal(step(pinned, 'Total weeks'), '1,565 weeks and 2 days');
  assert.equal(step(pinned, 'Total hours'), '262,968');
  assert.equal(step(pinned, 'Born on a'), 'Thursday');
});

