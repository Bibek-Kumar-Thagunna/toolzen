import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectUnit,
  fromTimestamp,
  listCommonTimeZones,
  nowBreakdown,
  toTimestamp,
} from './timestamp.ts';
import type { TimestampUnit } from './timestamp.ts';
import type { Failure } from '../calc/round.ts';

function expectOk<T>(result: ({ ok: true } & T) | Failure): { ok: true } & T {
  if (!result.ok) assert.fail(`expected success, got error: ${result.error}`);
  return result;
}

function expectFail<T>(result: ({ ok: true } & T) | Failure): string {
  if (result.ok) assert.fail('expected a friendly error, got a result');
  return result.error;
}

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

test('detectUnit splits the four units at the documented boundaries', () => {
  assert.equal(detectUnit(0), 'seconds', 'a hand-typed small number is seconds');
  assert.equal(detectUnit(86_400), 'seconds');
  assert.equal(detectUnit(1_700_000_000), 'seconds', 'ten digits');
  assert.equal(detectUnit(-1_700_000_000), 'seconds', 'the sign is ignored');
  assert.equal(detectUnit(99_999_999_999), 'seconds', 'just under 1e11');
  assert.equal(detectUnit(1e11), 'milliseconds', 'the first boundary');
  assert.equal(detectUnit(1_700_000_000_000), 'milliseconds', 'thirteen digits');
  assert.equal(detectUnit(99_999_999_999_999), 'milliseconds');
  assert.equal(detectUnit(1e14), 'microseconds', 'the second boundary');
  assert.equal(detectUnit(1_700_000_000_000_000), 'microseconds', 'sixteen digits');
  assert.equal(detectUnit(1e17), 'nanoseconds', 'the third boundary');
  assert.equal(detectUnit(1_700_000_000_000_000_000), 'nanoseconds', 'nineteen digits');
});

test('timestamp 0 is the epoch, in every field', () => {
  const { result, warnings } = expectOk(fromTimestamp(0, { unit: 'seconds', timeZone: 'UTC' }));
  assert.deepEqual(warnings, [], 'the unit was given, so there is nothing to warn about');
  assert.equal(result.iso, '1970-01-01T00:00:00.000Z');
  assert.equal(result.isoLocal, '1970-01-01T00:00:00.000Z', 'UTC prints as Z, not +00:00');
  assert.equal(result.utcString, 'Thu, 01 Jan 1970 00:00:00 GMT');
  assert.equal(result.rfc2822, 'Thu, 01 Jan 1970 00:00:00 +0000');
  assert.equal(result.dayOfWeek, 'Thursday');
  assert.equal(result.dayOfYear, 1);
  assert.equal(result.isoWeek, '1970-W01');
  assert.equal(result.quarter, 1);
  assert.equal(result.isLeapYear, false);
  assert.equal(result.unixSeconds, 0);
  assert.equal(result.unixMilliseconds, 0);
  assert.equal(result.seconds, 0);
  assert.equal(result.milliseconds, 0);
  assert.equal(result.timezoneName, 'UTC');
  assert.equal(result.timezoneOffsetMinutes, 0);
  assert.equal(result.unit, 'seconds');
});

test('1700000000 is 2023-11-14T22:13:20Z, and the calendar fields follow the zone', () => {
  const utc = expectOk(fromTimestamp(1_700_000_000, { unit: 'seconds', timeZone: 'UTC' })).result;
  assert.equal(utc.iso, '2023-11-14T22:13:20.000Z');
  assert.equal(utc.isoLocal, '2023-11-14T22:13:20.000Z');
  assert.equal(utc.utcString, 'Tue, 14 Nov 2023 22:13:20 GMT');
  assert.equal(utc.dayOfWeek, 'Tuesday');
  assert.equal(utc.dayOfYear, 318);
  assert.equal(utc.isoWeek, '2023-W46');
  assert.equal(utc.quarter, 4);

  const newYork = expectOk(
    fromTimestamp(1_700_000_000, { unit: 'seconds', timeZone: 'America/New_York' }),
  ).result;
  assert.equal(newYork.iso, '2023-11-14T22:13:20.000Z', 'the instant does not move');
  assert.equal(newYork.isoLocal, '2023-11-14T17:13:20.000-05:00');
  assert.equal(newYork.rfc2822, 'Tue, 14 Nov 2023 17:13:20 -0500');
  assert.equal(newYork.utcString, 'Tue, 14 Nov 2023 22:13:20 GMT', 'utcString stays in UTC');
  assert.equal(newYork.timezoneOffsetMinutes, -300);
  assert.equal(newYork.dayOfYear, 318);

  // Far enough east that the local date is the next day: the classic off-by-one.
  const kolkata = expectOk(
    fromTimestamp(1_700_000_000, { unit: 'seconds', timeZone: 'Asia/Kolkata' }),
  ).result;
  assert.equal(kolkata.isoLocal, '2023-11-15T03:43:20.000+05:30');
  assert.equal(kolkata.timezoneOffsetMinutes, 330);
  assert.equal(kolkata.dayOfWeek, 'Wednesday', 'not Tuesday, which is what UTC would say');
  assert.equal(kolkata.dayOfYear, 319);
  assert.equal(kolkata.rfc2822, 'Wed, 15 Nov 2023 03:43:20 +0530');
});

test('the same instant written in all four units gives the same answer', () => {
  const values: Array<[number, string]> = [
    [1_700_000_000, 'seconds'],
    [1_700_000_000_000, 'milliseconds'],
    [1_700_000_000_000_000, 'microseconds'],
    [1_700_000_000_000_000_000, 'nanoseconds'],
  ];
  for (const [value, unit] of values) {
    // No unit passed: detectUnit has to get this right on magnitude alone.
    const guessed = expectOk(fromTimestamp(value, { timeZone: 'UTC' }));
    assert.equal(guessed.result.unit, unit, `${value} should read as ${unit}`);
    assert.equal(guessed.result.iso, '2023-11-14T22:13:20.000Z');
    assert.equal(guessed.warnings.length, 1, 'a guessed unit must be admitted');
    assert.match(guessed.warnings[0], new RegExp(unit));
    assert.match(guessed.warnings[0], /thousand/, 'and must say how wrong it could be');
  }
});

test('the input can be text, and precision that will not fit is reported', () => {
  assert.equal(expectOk(fromTimestamp('1700000000', { unit: 'seconds' })).result.unixSeconds, 1_700_000_000);
  assert.equal(expectOk(fromTimestamp('  1700000000  ', { unit: 'seconds' })).result.unixSeconds, 1_700_000_000);
  assert.equal(expectOk(fromTimestamp('1,700,000,000', { unit: 'seconds' })).result.unixSeconds, 1_700_000_000);

  const rounded = expectOk(fromTimestamp(1_700_000_000_123_456, { unit: 'microseconds', timeZone: 'UTC' }));
  assert.equal(rounded.result.unixMilliseconds, 1_700_000_000_123);
  assert.equal(rounded.result.iso, '2023-11-14T22:13:20.123Z');
  assert.equal(rounded.warnings.length, 1);
  assert.match(rounded.warnings[0], /rounded/);
  assert.match(rounded.warnings[0], /microseconds/);

  // Whole milliseconds in a finer unit: nothing is lost, so nothing is said.
  const exact = expectOk(fromTimestamp(1_700_000_000_123_000, { unit: 'microseconds', timeZone: 'UTC' }));
  assert.deepEqual(exact.warnings, []);
  assert.equal(exact.result.iso, '2023-11-14T22:13:20.123Z');
});

test('before 1970 the sub-second part still reads forwards', () => {
  // -1500ms is 1969-12-31T23:59:58.500Z. A naive `ms % 1000` would print .-500
  // here, or roll the clock to 23:59:59 and show .500 of the wrong second.
  const back = expectOk(fromTimestamp(-1500, { unit: 'milliseconds', timeZone: 'UTC' })).result;
  assert.equal(back.iso, '1969-12-31T23:59:58.500Z');
  assert.equal(back.isoLocal, back.iso, 'the two must agree in UTC');
  assert.equal(back.dayOfWeek, 'Wednesday');
  assert.equal(back.unixSeconds, -2, 'floor, not truncation towards zero');
  assert.equal(expectOk(fromTimestamp(-1, { unit: 'seconds', timeZone: 'UTC' })).result.iso, '1969-12-31T23:59:59.000Z');
});

function localAt(ms: number, zone: string): { isoLocal: string; offset: number } {
  const { result } = expectOk(fromTimestamp(ms, { unit: 'milliseconds', timeZone: zone }));
  return { isoLocal: result.isoLocal, offset: result.timezoneOffsetMinutes };
}

test('New York changes offset at the 2026 spring transition, to the second', () => {
  // EST ends at 2026-03-08T07:00:00Z, when local 02:00 becomes 03:00.
  const before = localAt(Date.UTC(2026, 2, 8, 6, 59, 59), 'America/New_York');
  assert.equal(before.isoLocal, '2026-03-08T01:59:59.000-05:00');
  assert.equal(before.offset, -300);

  const after = localAt(Date.UTC(2026, 2, 8, 7, 0, 0), 'America/New_York');
  assert.equal(after.isoLocal, '2026-03-08T03:00:00.000-04:00', 'the 2 a.m. hour does not exist');
  assert.equal(after.offset, -240);

  const midsummer = localAt(Date.UTC(2026, 6, 4, 16, 0, 0), 'America/New_York');
  assert.equal(midsummer.isoLocal, '2026-07-04T12:00:00.000-04:00');
  assert.equal(midsummer.offset, -240);
});

test('New York changes back in the autumn, and the clock repeats an hour', () => {
  // EDT ends at 2026-11-01T06:00:00Z, when local 02:00 becomes 01:00 again.
  const before = localAt(Date.UTC(2026, 10, 1, 5, 59, 59), 'America/New_York');
  assert.equal(before.isoLocal, '2026-11-01T01:59:59.000-04:00');
  assert.equal(before.offset, -240);

  const after = localAt(Date.UTC(2026, 10, 1, 6, 0, 0), 'America/New_York');
  assert.equal(after.isoLocal, '2026-11-01T01:00:00.000-05:00', 'one second later, the clock reads an hour earlier');
  assert.equal(after.offset, -300);

  const midwinter = localAt(Date.UTC(2026, 0, 4, 17, 0, 0), 'America/New_York');
  assert.equal(midwinter.isoLocal, '2026-01-04T12:00:00.000-05:00');
  assert.equal(midwinter.offset, -300);
});

test('half-hour and no-hour zones are reported as they really are', () => {
  // Lord Howe Island shifts by 30 minutes, which no whole-hour model can express.
  assert.equal(localAt(Date.UTC(2026, 0, 15, 0, 0, 0), 'Australia/Lord_Howe').offset, 660);
  assert.equal(localAt(Date.UTC(2026, 6, 15, 0, 0, 0), 'Australia/Lord_Howe').offset, 630);
  assert.equal(localAt(Date.UTC(2026, 6, 15, 0, 0, 0), 'Australia/Lord_Howe').isoLocal, '2026-07-15T10:30:00.000+10:30');

  // Kathmandu is +05:45, and India has never observed summer time.
  assert.equal(localAt(Date.UTC(2026, 0, 15, 0, 0, 0), 'Asia/Kathmandu').offset, 345);
  assert.equal(localAt(Date.UTC(2026, 0, 15, 0, 0, 0), 'Asia/Kolkata').offset, 330);
  assert.equal(localAt(Date.UTC(2026, 6, 15, 0, 0, 0), 'Asia/Kolkata').offset, 330);
});

test('toTimestamp reads a wall clock in the zone it was written in', () => {
  const newYork = expectOk(
    toTimestamp({ date: '2023-11-14', time: '17:13:20', timeZone: 'America/New_York' }),
  );
  assert.equal(newYork.unixSeconds, 1_700_000_000);
  assert.equal(newYork.unixMilliseconds, 1_700_000_000_000);
  assert.equal(newYork.iso, '2023-11-14T22:13:20.000Z');
  assert.deepEqual(newYork.warnings, []);

  // The same clock reading in another zone is a different instant.
  const utc = expectOk(toTimestamp({ date: '2023-11-14', time: '17:13:20', timeZone: 'UTC' }));
  assert.equal(utc.unixSeconds, 1_699_982_000);
  assert.equal(utc.iso, '2023-11-14T17:13:20.000Z');

  assert.equal(expectOk(toTimestamp({ date: '1970-01-01', timeZone: 'UTC' })).unixSeconds, 0, 'no time means midnight');
  assert.equal(
    expectOk(toTimestamp({ date: '2023-11-14', time: '5:13:20 pm', timeZone: 'America/New_York' })).unixSeconds,
    1_700_000_000,
    'am/pm has to reach the same instant as the 24-hour clock',
  );
  assert.equal(
    expectOk(toTimestamp({ date: '2023-11-14', time: '17:13:20.250', timeZone: 'UTC' })).unixMilliseconds,
    1_699_982_000_250,
  );
  assert.equal(expectOk(toTimestamp({ date: '2026-01-01', time: '12:00 am', timeZone: 'UTC' })).iso, '2026-01-01T00:00:00.000Z');
  assert.equal(expectOk(toTimestamp({ date: '2026-01-01', time: '12:00 pm', timeZone: 'UTC' })).iso, '2026-01-01T12:00:00.000Z');
});

test('a wall time that never happened is moved forward, and says so', () => {
  // New York skips 02:00-03:00 on 2026-03-08.
  const gap = expectOk(toTimestamp({ date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' }));
  assert.equal(gap.iso, '2026-03-08T07:30:00.000Z', 'the requested time pushed forward by the jump');
  assert.equal(gap.unixMilliseconds, Date.UTC(2026, 2, 8, 7, 30));
  assert.equal(gap.warnings.length, 1);
  assert.match(gap.warnings[0], /never happened/);
  assert.match(gap.warnings[0], /2026-03-08/);
  assert.match(gap.warnings[0], /03:30:00/, 'the warning has to name the time actually used');

  // Either side of the hole, nothing is ambiguous and nothing is warned about.
  const before = expectOk(toTimestamp({ date: '2026-03-08', time: '01:30', timeZone: 'America/New_York' }));
  assert.equal(before.iso, '2026-03-08T06:30:00.000Z');
  assert.deepEqual(before.warnings, []);
  const after = expectOk(toTimestamp({ date: '2026-03-08', time: '03:00', timeZone: 'America/New_York' }));
  assert.equal(after.iso, '2026-03-08T07:00:00.000Z');
  assert.deepEqual(after.warnings, [], 'the first instant of EDT is not ambiguous');
});

test('a wall time that happened twice picks one and admits it', () => {
  // New York repeats 01:00-02:00 on 2026-11-01.
  const twice = expectOk(toTimestamp({ date: '2026-11-01', time: '01:30', timeZone: 'America/New_York' }));
  assert.equal(twice.unixMilliseconds, Date.UTC(2026, 10, 1, 5, 30), 'the earlier of the two, still on EDT');
  assert.equal(twice.iso, '2026-11-01T05:30:00.000Z');
  assert.equal(twice.warnings.length, 1);
  assert.match(twice.warnings[0], /happened twice/);
  assert.match(twice.warnings[0], /earlier/);
  assert.match(twice.warnings[0], /-04:00/, 'which of the two offsets was used');

  // Later the same day the offset differs from the naive first guess, which is the
  // case an ambiguity check can most easily get wrong in the other direction.
  const later = expectOk(toTimestamp({ date: '2026-11-01', time: '04:00', timeZone: 'America/New_York' }));
  assert.equal(later.iso, '2026-11-01T09:00:00.000Z');
  assert.deepEqual(later.warnings, [], '04:00 happened exactly once');

  // Lord Howe repeats only half an hour, so 01:45 is doubled and 01:15 is not.
  const half = expectOk(toTimestamp({ date: '2026-04-05', time: '01:45', timeZone: 'Australia/Lord_Howe' }));
  assert.equal(half.warnings.length, 1, `expected an ambiguity warning, got ${JSON.stringify(half.warnings)}`);
  assert.match(half.warnings[0], /happened twice/);
  assert.equal(half.iso, '2026-04-04T14:45:00.000Z', 'still on +11:00, the first of the two');
  assert.deepEqual(
    expectOk(toTimestamp({ date: '2026-04-05', time: '01:15', timeZone: 'Australia/Lord_Howe' })).warnings,
    [],
  );
});

test('the earlier of two identical clock times is chosen in every zone', () => {
  // Which instant the arithmetic reaches first depends on the sign of the zone's
  // offset, so the choice has to be made by rule or it varies by zone.
  const cases: Array<[string, string, string, string, string]> = [
    ['America/New_York', '2026-11-01', '01:30', '2026-11-01T05:30:00.000Z', '-04:00'],
    ['Europe/Berlin', '2026-10-25', '02:30', '2026-10-25T00:30:00.000Z', '+02:00'],
    ['Europe/London', '2026-10-25', '01:30', '2026-10-25T00:30:00.000Z', '+01:00'],
    ['Australia/Lord_Howe', '2026-04-05', '01:45', '2026-04-04T14:45:00.000Z', '+11:00'],
    ['Pacific/Auckland', '2026-04-05', '02:30', '2026-04-04T13:30:00.000Z', '+13:00'],
    ['America/Santiago', '2026-04-04', '23:30', '2026-04-05T02:30:00.000Z', '-03:00'],
  ];
  for (const [zone, date, time, iso, offset] of cases) {
    const result = expectOk(toTimestamp({ date, time, timeZone: zone }));
    assert.equal(result.iso, iso, `${time} on ${date} in ${zone}`);
    assert.equal(result.warnings.length, 1, `${zone}: ${JSON.stringify(result.warnings)}`);
    assert.match(result.warnings[0], /happened twice/);
    assert.match(result.warnings[0], /earlier/, 'the rule is the same everywhere');
    assert.ok(result.warnings[0].includes(offset), `${zone} should name ${offset}: ${result.warnings[0]}`);
    // Whichever it picked has to read back as the clock time that was asked for.
    const back = expectOk(fromTimestamp(result.unixMilliseconds, { unit: 'milliseconds', timeZone: zone }));
    assert.equal(back.result.isoLocal.slice(0, 16), `${date}T${time}`);
  }
});

test('toTimestamp refuses input it cannot read, in plain words', () => {
  assert.match(expectFail(toTimestamp({ date: '' })), /Enter a date/);
  assert.match(expectFail(toTimestamp({ date: 'sometime last week' })), /YYYY-MM-DD/);
  assert.match(expectFail(toTimestamp({ date: '2026-02-30' })), /no 30 February/);
  assert.match(expectFail(toTimestamp({ date: '2026-01-01', time: '25:00' })), /no 25 o'clock/);
  assert.match(expectFail(toTimestamp({ date: '2026-01-01', time: '12:75' })), /no minute 75/);
  assert.match(expectFail(toTimestamp({ date: '2026-01-01', time: '12:00:99' })), /no second 99/);
  assert.match(expectFail(toTimestamp({ date: '2026-01-01', time: 'noon' })), /not a time/);
  assert.match(expectFail(toTimestamp({ date: '2026-01-01', time: '13:30 pm' })), /between 1 and 12/);

  const badZone = expectFail(toTimestamp({ date: '2026-01-01', timeZone: 'Middle/Earth' }));
  assert.match(badZone, /Middle\/Earth/, 'the error has to name the zone it did not recognise');
  assert.match(badZone, /IANA|America\/New_York/);
});

test('fromTimestamp refuses input it cannot read, in plain words', () => {
  assert.match(expectFail(fromTimestamp('')), /Enter a timestamp/);
  assert.match(expectFail(fromTimestamp('   ')), /Enter a timestamp/);
  assert.match(expectFail(fromTimestamp('hello')), /1700000000/);
  assert.match(expectFail(fromTimestamp('2023-11-14')), /not a number/);
  assert.match(expectFail(fromTimestamp(Number.NaN)), /not a number/);
  assert.match(expectFail(fromTimestamp(Number.POSITIVE_INFINITY)), /not a number/);
  assert.match(expectFail(fromTimestamp(0, { timeZone: 'Middle/Earth' })), /Middle\/Earth/);
});

const ROUND_TRIP_ZONES = [
  'UTC',
  'America/New_York',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
];

test('toTimestamp undoes fromTimestamp for 100 random instants in 5 zones', () => {
  const random = mulberry32(0xc0ffee);
  const from = Date.UTC(1990, 0, 1);
  const span = Date.UTC(2040, 0, 1) - from;
  const cases: Array<[number, string]> = [];
  for (let i = 0; i < 100; i += 1) {
    const ms = from + Math.floor(random() * span);
    for (const zone of ROUND_TRIP_ZONES) cases.push([ms, zone]);
  }
  // The second pass through a repeated hour: the one case that cannot come back
  // as the instant it went in as, and one that random draws almost never land on.
  const repeated: Array<[number, string]> = [
    [Date.UTC(2026, 10, 1, 6, 30), 'America/New_York'],
    [Date.UTC(2026, 9, 25, 1, 30), 'Europe/Berlin'],
    [Date.UTC(2026, 3, 4, 15, 15), 'Australia/Lord_Howe'],
  ];
  cases.push(...repeated);

  let exact = 0;
  let ambiguous = 0;
  for (const [ms, zone] of cases) {
    const forward = expectOk(fromTimestamp(ms, { unit: 'milliseconds', timeZone: zone }));
    const local = forward.result.isoLocal;
    const date = local.slice(0, 10); // YYYY-MM-DD
    const time = local.slice(11, 23); // HH:MM:SS.mmm
    const back = expectOk(toTimestamp({ date, time, timeZone: zone }));

    if (back.warnings.length === 0) {
      assert.equal(back.unixMilliseconds, ms, `${local} in ${zone} did not come back as ${ms}`);
      exact += 1;
    } else {
      // The only legitimate cause is a wall time the clocks handed out twice, and
      // the earlier of the two is the documented choice.
      ambiguous += 1;
      assert.match(back.warnings[0], /happened twice/, `unexpected warning for ${local} in ${zone}`);
      assert.ok(back.unixMilliseconds < ms, `${local} in ${zone} should have resolved earlier than ${ms}`);
      assert.ok(ms - back.unixMilliseconds <= 3_600_000, 'and by at most an hour');
      const again = expectOk(fromTimestamp(back.unixMilliseconds, { unit: 'milliseconds', timeZone: zone }));
      assert.equal(again.result.isoLocal.slice(0, 23), local.slice(0, 23), 'the clock has to read the same');
    }
  }
  assert.equal(exact + ambiguous, cases.length);
  assert.ok(exact >= 495, `only ${exact} of ${cases.length} instants came back unchanged`);
  assert.ok(ambiguous >= repeated.length, 'the repeated-hour cases have to reach the ambiguous branch');
});

/** The UTC breakdown of a plain date, taken through both directions. */
function utcDay(date: string) {
  const instant = expectOk(toTimestamp({ date, timeZone: 'UTC' }));
  return expectOk(fromTimestamp(instant.unixMilliseconds, { unit: 'milliseconds', timeZone: 'UTC' })).result;
}

test('the ISO week year is not always the calendar year', () => {
  assert.equal(utcDay('2026-01-01').isoWeek, '2026-W01', 'a Thursday, so week 1 of its own year');
  // 2027 starts on a Friday, so its first three days finish 2026's 53rd week.
  assert.equal(utcDay('2027-01-01').isoWeek, '2026-W53');
  assert.equal(utcDay('2026-12-31').isoWeek, '2026-W53');
  assert.equal(utcDay('2027-01-03').isoWeek, '2026-W53');
  assert.equal(utcDay('2027-01-04').isoWeek, '2027-W01', 'the first Monday of the first Thursday week');
  // And the other way round: December 2025 belonging to week 1 of 2026.
  assert.equal(utcDay('2025-12-29').isoWeek, '2026-W01');
  assert.equal(utcDay('2025-12-28').isoWeek, '2025-W52');
});

test('quarter, leap year and day of year come from the local calendar', () => {
  const leap = utcDay('2024-02-29');
  assert.equal(leap.isLeapYear, true);
  assert.equal(leap.dayOfYear, 60);
  assert.equal(leap.quarter, 1);
  assert.equal(leap.dayOfWeek, 'Thursday');
  assert.equal(utcDay('2026-03-31').quarter, 1);
  assert.equal(utcDay('2026-04-01').quarter, 2);
  assert.equal(utcDay('2026-07-01').quarter, 3);
  assert.equal(utcDay('2026-10-01').quarter, 4);
  assert.equal(utcDay('2026-12-31').dayOfYear, 365);
  assert.equal(utcDay('2024-12-31').dayOfYear, 366);
  assert.equal(utcDay('1900-01-01').isLeapYear, false, '1900 is the century that is not a leap year');
  assert.equal(utcDay('2000-01-01').isLeapYear, true);
});

test('the relative wording is measured against the "now" it was given', () => {
  const at = (ms: number, now: number): string =>
    expectOk(fromTimestamp(ms, { unit: 'milliseconds', timeZone: 'UTC', now })).result.relative;
  assert.equal(at(0, 0), 'now');
  assert.equal(at(0, 86_400_000), 'yesterday');
  assert.equal(at(0, 3 * 86_400_000), '3 days ago');
  assert.equal(at(60 * 86_400_000, 0), 'in 2 months');
  assert.equal(at(0, 45_000), '45 seconds ago');
  assert.equal(at(800 * 86_400_000, 0), 'in 2 years');
  assert.equal(at(0, 400 * 86_400_000), 'last year', 'the "auto" wording, not "1 year ago"');
});

test('a timestamp beyond the reach of a date is refused, and the edge is not', () => {
  // A JavaScript Date spans ±8.64e15 ms, about 273,790 years either side of 1970.
  const edge = expectOk(fromTimestamp(8.64e15, { unit: 'milliseconds', timeZone: 'UTC' })).result;
  assert.equal(edge.iso, '+275760-09-13T00:00:00.000Z');
  assert.equal(edge.isoLocal, '+275760-09-13T00:00:00.000Z', 'six-digit years get a sign, as ISO 8601 says');
  assert.equal(expectOk(fromTimestamp(-8.64e15, { unit: 'milliseconds', timeZone: 'UTC' })).result.iso, '-271821-04-20T00:00:00.000Z');

  for (const [value, unit] of [
    [8.64e15 + 1, 'milliseconds'],
    [8.64e12 + 1, 'seconds'],
    [1e18, 'seconds'],
    [-1e18, 'seconds'],
  ] as Array<[number, TimestampUnit]>) {
    const error = expectFail(fromTimestamp(value, { unit }));
    assert.match(error, /273,790/, `${value} ${unit} should have been out of range`);
    assert.match(error, new RegExp(unit), 'and should say which unit it was read as');
  }
});

test('the timezone list is short, usable and every entry actually works', () => {
  const zones = listCommonTimeZones();
  assert.ok(zones.length >= 40, `only ${zones.length} zones offered`);
  assert.equal(zones[0], 'UTC', 'UTC belongs at the top of a dropdown');
  assert.equal(new Set(zones).size, zones.length, 'no duplicates');
  for (const zone of ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney']) {
    assert.ok(zones.includes(zone), `${zone} should be on a list this size`);
  }
  // The point of filtering the list: nothing on it can fail to format.
  for (const zone of zones) {
    const check = fromTimestamp(0, { unit: 'seconds', timeZone: zone });
    assert.ok(check.ok, `${zone} is offered but does not work`);
  }
  const mutated = listCommonTimeZones();
  mutated.push('Nowhere/Special');
  assert.equal(listCommonTimeZones().length, zones.length, 'the cached list must not be handed out by reference');
});

test('nowBreakdown describes this instant, and never throws over a bad zone', () => {
  const before = Date.now();
  const utc = nowBreakdown('UTC');
  const after = Date.now();
  assert.equal(utc.timezoneName, 'UTC');
  assert.equal(utc.timezoneOffsetMinutes, 0);
  assert.equal(utc.unit, 'milliseconds');
  assert.equal(utc.relative, 'now');
  assert.ok(utc.unixMilliseconds >= before && utc.unixMilliseconds <= after);
  assert.equal(utc.unixSeconds, Math.floor(utc.unixMilliseconds / 1000));
  assert.equal(utc.iso, new Date(utc.unixMilliseconds).toISOString());

  // A dropdown can send anything; a "what time is it" panel must still render.
  assert.equal(nowBreakdown('Middle/Earth').timezoneName, 'UTC');
  assert.ok(nowBreakdown().timezoneName.length > 0, 'no argument means this computer’s own zone');
  assert.equal(nowBreakdown('Asia/Kolkata').timezoneOffsetMinutes, 330);
});

