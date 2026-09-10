import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMonthsClamped,
  addToDate,
  businessDaysBetween,
  calendarBreakdown,
  civilToDayNumber,
  countWeekdays,
  dateDifference,
  dayNumberToCivil,
  dayOfYear,
  daysInMonth,
  isLeapYear,
  isWeekend,
  isoWeekNumber,
  isoWeekYear,
  parseDateInput,
  toIsoDate,
  weekdayName,
} from './dates.ts';
import type { CivilDate } from './dates.ts';
import type { Failure } from './round.ts';

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

function expectOk<T>(result: ({ ok: true } & T) | Failure): { ok: true } & T {
  if (!result.ok) assert.fail(`expected success, got error: ${result.error}`);
  return result;
}

function expectFail<T>(result: ({ ok: true } & T) | Failure): string {
  if (result.ok) assert.fail('expected a friendly error, got a result');
  return result.error;
}

/** Brute-force reference implementation for the O(1) weekday count. */
function bruteForceWeekdays(startDay: number, endDay: number): number {
  let count = 0;
  for (let day = startDay; day < endDay; day += 1) {
    if (!isWeekend(day)) count += 1;
  }
  return count;
}
test('isLeapYear and daysInMonth follow the Gregorian rule', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(1900), false, 'divisible by 100 but not 400');
  assert.equal(isLeapYear(2000), true, 'divisible by 400');
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('civil dates round-trip through day numbers', () => {
  const random = mulberry32(31337);
  for (let i = 0; i < 500; i += 1) {
    const year = 1900 + Math.floor(random() * 200);
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * daysInMonth(year, month));
    const civil: CivilDate = { year, month, day };
    assert.deepEqual(dayNumberToCivil(civilToDayNumber(civil)), civil);
  }
  assert.equal(civilToDayNumber({ year: 1970, month: 1, day: 1 }), 0);
  assert.equal(weekdayName(0), 'Thursday', '1970-01-01 was a Thursday');
});

test('parseDateInput: ISO form', () => {
  const parsed = expectOk(parseDateInput('2026-02-28'));
  assert.deepEqual(parsed.civil, { year: 2026, month: 2, day: 28 });
  assert.equal(parsed.iso, '2026-02-28');
  assert.deepEqual(parsed.warnings, []);
  assert.equal(expectOk(parseDateInput('2026-1-5')).iso, '2026-01-05');
  assert.equal(expectOk(parseDateInput('2026-02-28T13:45:00.000Z')).iso, '2026-02-28');
});

test('parseDateInput: unambiguous slashed dates need no warning', () => {
  const dayFirst = expectOk(parseDateInput('25/12/2026'));
  assert.equal(dayFirst.iso, '2026-12-25');
  assert.deepEqual(dayFirst.warnings, [], '25 cannot be a month, so there is nothing to warn about');

  const monthFirst = expectOk(parseDateInput('12/25/2026'));
  assert.equal(monthFirst.iso, '2026-12-25');
  assert.deepEqual(monthFirst.warnings, []);
});

test('parseDateInput: ambiguous slashed dates warn and honour dayFirst', () => {
  const us = expectOk(parseDateInput('12/03/2026'));
  assert.equal(us.iso, '2026-12-03');
  assert.equal(us.warnings.length, 1);
  assert.match(us.warnings[0] ?? '', /either way round/);

  const uk = expectOk(parseDateInput('12/03/2026', { dayFirst: true }));
  assert.equal(uk.iso, '2026-03-12');
  assert.equal(uk.warnings.length, 1);

  assert.deepEqual(expectOk(parseDateInput('03/03/2026')).warnings, [], 'same number both ways');
});
test('parseDateInput: two-digit years are expanded, with a warning', () => {
  const recent = expectOk(parseDateInput('01/02/26'));
  assert.equal(recent.civil.year, 2026);
  assert.ok(recent.warnings.some((warning) => /two-digit year/.test(warning)));
  assert.equal(expectOk(parseDateInput('01/02/85')).civil.year, 1985);
});

test('parseDateInput: impossible dates get a sentence naming the problem', () => {
  assert.match(expectFail(parseDateInput('2026-02-30')), /no 30 February in 2026/);
  assert.match(expectFail(parseDateInput('2026-13-01')), /no month 13/);
  assert.match(expectFail(parseDateInput('not a date')), /YYYY-MM-DD/);
  assert.match(expectFail(parseDateInput('')), /Enter a date/);
  assert.equal(expectOk(parseDateInput('2024-02-29')).iso, '2024-02-29', 'leap day is real');
  assert.match(expectFail(parseDateInput('2026-02-29')), /no 29 February in 2026/);
});

test('dayOfYear and ISO week numbers', () => {
  assert.equal(dayOfYear('2026-01-01'), 1);
  assert.equal(dayOfYear('2024-12-31'), 366, '2024 was a leap year');
  assert.equal(dayOfYear('2026-12-31'), 365);
  assert.equal(dayOfYear('rubbish'), 0, 'never NaN');

  // 2026-01-01 is a Thursday, so it is in week 1 by the first-Thursday rule.
  assert.equal(isoWeekNumber('2026-01-01'), 1);
  assert.equal(isoWeekYear('2026-01-01'), 2026);

  // 2024-12-30 is a Monday whose week contains Thursday 2025-01-02, so it is
  // week 1 of 2025 even though the calendar year is still 2024.
  assert.equal(isoWeekNumber('2024-12-30'), 1);
  assert.equal(isoWeekYear('2024-12-30'), 2025);

  assert.equal(isoWeekNumber('2026-12-31'), 53);
  assert.equal(isoWeekNumber('2026-06-15'), 25);
});

test('countWeekdays matches a brute-force loop over 400 random ranges', () => {
  const random = mulberry32(20240101);
  for (let i = 0; i < 400; i += 1) {
    const start = Math.floor(random() * 40000) - 10000;
    const length = Math.floor(random() * 900);
    const end = start + length;
    assert.equal(
      countWeekdays(start, end),
      bruteForceWeekdays(start, end),
      `mismatch for [${start}, ${end})`,
    );
  }
  assert.equal(countWeekdays(10, 10), 0, 'empty range');
  assert.equal(countWeekdays(10, 5), 0, 'reversed range');
});
test('addMonthsClamped: 31 January + 1 month is the end of February', () => {
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(addMonthsClamped({ year: 2024, month: 1, day: 31 }, 1), { year: 2024, month: 2, day: 29 });
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 3, day: 31 }, 1), { year: 2026, month: 4, day: 30 });
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 12, day: 15 }, 1), { year: 2027, month: 1, day: 15 });
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 1, day: 15 }, -1), { year: 2025, month: 12, day: 15 });
  assert.deepEqual(addMonthsClamped({ year: 2026, month: 3, day: 31 }, -1), { year: 2026, month: 2, day: 28 });
});

test('calendarBreakdown: the leap-day case that catches everyone out', () => {
  // The 29th never comes round in 2026, so the last month is not complete.
  assert.deepEqual(
    calendarBreakdown({ year: 1996, month: 2, day: 29 }, { year: 2026, month: 2, day: 28 }),
    { years: 29, months: 11, days: 30 },
  );
  // Leftover days run from the monthly anniversary (20 Feb) to the end date, so
  // it is February's length — the month before the end date — that decides them.
  assert.deepEqual(
    calendarBreakdown({ year: 2026, month: 1, day: 20 }, { year: 2026, month: 3, day: 10 }),
    { years: 0, months: 1, days: 18 },
  );
  // Same span one leap year earlier: February is a day longer, so is the answer.
  assert.deepEqual(
    calendarBreakdown({ year: 2024, month: 1, day: 20 }, { year: 2024, month: 3, day: 10 }),
    { years: 0, months: 1, days: 19 },
  );
});

test('calendarBreakdown: 2000-01-31 to 2000-03-01 is 1 month 1 day', () => {
  // 31 Jan + 1 month clamps to 29 Feb 2000, which is one day short of 1 March.
  assert.deepEqual(
    calendarBreakdown({ year: 2000, month: 1, day: 31 }, { year: 2000, month: 3, day: 1 }),
    { years: 0, months: 1, days: 1 },
  );
  assert.deepEqual(
    calendarBreakdown({ year: 2000, month: 1, day: 31 }, { year: 2000, month: 2, day: 29 }),
    { years: 0, months: 0, days: 29 },
  );
});

test('calendarBreakdown: same day, and exact anniversaries', () => {
  const day: CivilDate = { year: 2026, month: 5, day: 4 };
  assert.deepEqual(calendarBreakdown(day, day), { years: 0, months: 0, days: 0 });
  assert.deepEqual(calendarBreakdown({ year: 1990, month: 5, day: 4 }, day), { years: 36, months: 0, days: 0 });
  assert.deepEqual(calendarBreakdown({ year: 2026, month: 4, day: 4 }, day), { years: 0, months: 1, days: 0 });
});
test('calendarBreakdown: the breakdown always reconstructs the end date', () => {
  const random = mulberry32(987654);
  for (let i = 0; i < 1000; i += 1) {
    const startDay = Math.floor(random() * 40000);
    const endDay = startDay + Math.floor(random() * 20000);
    const from = dayNumberToCivil(startDay);
    const to = dayNumberToCivil(endDay);
    const parts = calendarBreakdown(from, to);
    assert.ok(parts.days >= 0, `negative days for ${toIsoDate(from)} → ${toIsoDate(to)}`);
    assert.ok(parts.months >= 0 && parts.months < 12, `months out of range: ${parts.months}`);
    const anchor = addMonthsClamped(from, parts.years * 12 + parts.months);
    assert.equal(
      civilToDayNumber(anchor) + parts.days,
      endDay,
      `${toIsoDate(from)} + ${parts.years}y ${parts.months}m ${parts.days}d did not land on ${toIsoDate(to)}`,
    );
  }
});

test('dateDifference: the everyday case', () => {
  const result = expectOk(dateDifference({ from: '2026-01-01', to: '2026-03-15' }));
  assert.equal(result.totalDays, 73);
  assert.deepEqual(
    { years: result.years, months: result.months, days: result.days },
    { years: 0, months: 2, days: 14 },
  );
  assert.equal(result.weeks, 10);
  assert.equal(result.remainderDays, 3);
  assert.equal(result.weekdays + result.weekendDays, result.totalDays);
  assert.equal(result.totalHours, 73 * 24);
  assert.equal(result.totalMinutes, 73 * 24 * 60);
  assert.equal(result.reversed, false);
  assert.ok(result.formula.length > 0 && result.steps.length > 0);
});

test('dateDifference: includeEndDate adds exactly one day, consistently', () => {
  const exclusive = expectOk(dateDifference({ from: '2026-01-05', to: '2026-01-09' }));
  const inclusive = expectOk(dateDifference({ from: '2026-01-05', to: '2026-01-09', includeEndDate: true }));
  assert.equal(exclusive.totalDays, 4);
  assert.equal(inclusive.totalDays, 5);
  assert.equal(exclusive.weekdays, 4, 'Mon to Thu');
  assert.equal(inclusive.weekdays, 5, 'Mon to Fri');
  assert.equal(inclusive.days, 5);

  const sameDay = expectOk(dateDifference({ from: '2026-01-05', to: '2026-01-05' }));
  assert.equal(sameDay.totalDays, 0);
  assert.equal(expectOk(dateDifference({ from: '2026-01-05', to: '2026-01-05', includeEndDate: true })).totalDays, 1);
});

test('dateDifference: reversed dates are swapped, not rejected', () => {
  const result = expectOk(dateDifference({ from: '2026-03-15', to: '2026-01-01' }));
  assert.equal(result.reversed, true);
  assert.equal(result.totalDays, 73);
  assert.equal(result.fromIso, '2026-01-01');
  assert.equal(result.toIso, '2026-03-15');
  assert.ok(result.warnings.some((warning) => /swapped/.test(warning)));
});
test('addToDate: month-end clamping, with the clamp reported', () => {
  const feb = expectOk(addToDate({ date: '2026-01-31', months: 1 }));
  assert.equal(feb.iso, '2026-02-28');
  assert.equal(feb.clamped, true);
  assert.ok(feb.warnings.some((warning) => /moved back/.test(warning)));

  assert.equal(expectOk(addToDate({ date: '2024-01-31', months: 1 })).iso, '2024-02-29');
  assert.equal(expectOk(addToDate({ date: '2026-01-15', months: 1 })).clamped, false);
  assert.equal(expectOk(addToDate({ date: '2026-01-31', months: 2 })).iso, '2026-03-31');
});

test('addToDate: years, weeks and days, forwards and backwards', () => {
  assert.equal(expectOk(addToDate({ date: '2026-03-01', years: 1 })).iso, '2027-03-01');
  assert.equal(expectOk(addToDate({ date: '2024-02-29', years: 1 })).iso, '2025-02-28');
  assert.equal(expectOk(addToDate({ date: '2026-01-01', weeks: 2, days: 3 })).iso, '2026-01-18');
  assert.equal(expectOk(addToDate({ date: '2026-01-01', days: -1 })).iso, '2025-12-31');
  const result = expectOk(addToDate({ date: '2026-01-01', days: 30 }));
  assert.equal(result.netDays, 30);
  assert.equal(result.dayOfWeek, 'Saturday');
});

test('addToDate: businessDaysOnly steps over weekends', () => {
  // Thursday 2026-01-01 + 1 working day is Friday the 2nd; + 2 is Monday the 5th.
  assert.equal(expectOk(addToDate({ date: '2026-01-01', days: 1, businessDaysOnly: true })).iso, '2026-01-02');
  assert.equal(expectOk(addToDate({ date: '2026-01-01', days: 2, businessDaysOnly: true })).iso, '2026-01-05');
  assert.equal(expectOk(addToDate({ date: '2026-01-01', days: 10, businessDaysOnly: true })).iso, '2026-01-15');
  // A working week is five days here, not seven.
  assert.equal(expectOk(addToDate({ date: '2026-01-05', weeks: 1, businessDaysOnly: true })).iso, '2026-01-12');
  assert.equal(expectOk(addToDate({ date: '2026-01-05', days: -1, businessDaysOnly: true })).iso, '2026-01-02');
});

test('addToDate: rejects fractional amounts', () => {
  assert.match(expectFail(addToDate({ date: '2026-01-01', months: 1.5 })), /whole number/);
  assert.match(expectFail(addToDate({ date: 'nonsense', days: 1 })), /^Date: /);
});

test('businessDaysBetween: both endpoints count, matching NETWORKDAYS', () => {
  // Monday 5 to Friday 9 January 2026.
  const week = expectOk(businessDaysBetween({ from: '2026-01-05', to: '2026-01-09' }));
  assert.equal(week.businessDays, 5);
  assert.equal(week.weekdays, 5);
  assert.equal(week.weekendDays, 0);

  const fortnight = expectOk(businessDaysBetween({ from: '2026-01-05', to: '2026-01-16' }));
  assert.equal(fortnight.businessDays, 10);
  assert.equal(fortnight.weekendDays, 2);

  const sameDay = expectOk(businessDaysBetween({ from: '2026-01-05', to: '2026-01-05' }));
  assert.equal(sameDay.businessDays, 1);
  const weekendOnly = expectOk(businessDaysBetween({ from: '2026-01-03', to: '2026-01-04' }));
  assert.equal(weekendOnly.businessDays, 0);
});
test('businessDaysBetween: holidays are taken off once, and only when they count', () => {
  const result = expectOk(
    businessDaysBetween({
      from: '2026-01-05',
      to: '2026-01-16',
      holidays: ['2026-01-07', '2026-01-07', '2026-01-10', '2026-02-01', 'rubbish'],
    }),
  );
  assert.equal(result.weekdays, 10);
  assert.equal(result.businessDays, 9, 'only the one weekday holiday comes off');
  assert.deepEqual(result.holidaysApplied, ['2026-01-07']);
  assert.deepEqual(
    result.holidaysIgnored.map((entry) => entry.reason),
    ['listed twice', 'already a weekend', 'outside the range', 'could not be read as a date'],
  );
});

test('businessDaysBetween: reversed dates swap, and the count agrees with a walk', () => {
  const reversed = expectOk(businessDaysBetween({ from: '2026-03-31', to: '2026-01-01' }));
  const forward = expectOk(businessDaysBetween({ from: '2026-01-01', to: '2026-03-31' }));
  assert.equal(reversed.businessDays, forward.businessDays);
  assert.equal(reversed.reversed, true);

  const start = civilToDayNumber({ year: 2026, month: 1, day: 1 });
  const end = civilToDayNumber({ year: 2026, month: 3, day: 31 });
  assert.equal(forward.businessDays, bruteForceWeekdays(start, end + 1));
});
