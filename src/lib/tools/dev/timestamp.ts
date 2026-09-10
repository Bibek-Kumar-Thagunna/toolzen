/**
 * Unix timestamp to human date, and back, with timezones that are actually right.
 *
 * Two policies, each learned from the bug it prevents:
 *
 * 1. Zones go through `Intl.DateTimeFormat` and `formatToParts`, never through
 *    arithmetic on a stored offset. "New York is UTC-5" is wrong for eight months
 *    of the year, wrong permanently for the zones that have changed their rules,
 *    and cannot express Lord Howe Island's 30-minute shift. Node and every
 *    browser already carry the IANA database; this file asks it instead of
 *    guessing, and every offset it reports was measured rather than assumed.
 * 2. Calendar answers — day of the year, ISO week, leap year, weekday — come from
 *    the calc/dates.ts engine, applied to the *local* calendar fields of the
 *    requested zone. Deriving them from the UTC instant instead is the classic
 *    off-by-one that tells someone it is Tuesday when their own clock says Monday.
 *
 * Isomorphic: `Intl` and `Date` only, so the same code runs on the server and in
 * the tab.
 */

import {
  civilToDayNumber,
  dayOfYear,
  isLeapYear,
  isoWeekNumber,
  isoWeekYear,
  parseDateInput,
  weekdayName,
} from '../calc/dates.ts';
import { fail, parseLooseNumber } from '../calc/round.ts';
import type { Failure } from '../calc/round.ts';

/** The four units a bare number is ever in. */
export type TimestampUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';

const UNIT_LABELS: Record<TimestampUnit, string> = {
  seconds: 'seconds',
  milliseconds: 'milliseconds',
  microseconds: 'microseconds',
  nanoseconds: 'nanoseconds',
};

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** How far a JavaScript `Date` reaches either side of 1970: about 273,790 years. */
const MAX_DATE_MS = 8.64e15;

/**
 * Guess which unit a bare number is in.
 *
 * The rule everyone uses is digit count: a present-day timestamp is 10 digits in
 * seconds (1700000000), 13 in milliseconds, 16 in microseconds and 19 in
 * nanoseconds. The cut-offs below sit an order of magnitude above the largest
 * plausible value in each unit —
 *
 *     |value| < 1e11  seconds       (1e11 seconds after 1970 is the year 5138)
 *     |value| < 1e14  milliseconds  (1e14 milliseconds is the same year 5138)
 *     |value| < 1e17  microseconds
 *     otherwise       nanoseconds
 *
 * — so each unit keeps the whole decade around the present day and a spare, and
 * small numbers such as 0 or 86400 read as seconds, which is what someone typing
 * a value by hand means. `fromTimestamp` reports the guess as a warning; a caller
 * near a boundary should pass `unit` and not rely on this.
 *
 * The sign is ignored, so pre-1970 timestamps are classified the same way.
 */
export function detectUnit(value: number): TimestampUnit {
  const abs = Math.abs(value);
  if (abs < 1e11) return 'seconds';
  if (abs < 1e14) return 'milliseconds';
  if (abs < 1e17) return 'microseconds';
  return 'nanoseconds';
}

/** Exact for seconds and milliseconds; the finer units divide, so they can round. */
function toMilliseconds(value: number, unit: TimestampUnit): number {
  switch (unit) {
    case 'seconds':
      return value * 1000;
    case 'milliseconds':
      return value;
    case 'microseconds':
      return value / 1000;
    case 'nanoseconds':
      return value / 1e6;
  }
}

export interface TimestampBreakdown {
  unit: TimestampUnit;
  /** Whole seconds since 1970. Same number as `unixSeconds`. */
  seconds: number;
  /** Milliseconds since 1970. Same number as `unixMilliseconds`. */
  milliseconds: number;
  /** UTC, always with milliseconds: `2023-11-14T22:13:20.000Z`. */
  iso: string;
  /** The same instant as wall clock in the chosen zone: `2023-11-14T17:13:20.000-05:00`. */
  isoLocal: string;
  /** `Tue, 14 Nov 2023 22:13:20 GMT` — the form HTTP headers and `Date` use. */
  utcString: string;
  /** `Tue, 14 Nov 2023 17:13:20 -0500` — the form email headers use, in the chosen zone. */
  rfc2822: string;
  /** "3 days ago", "in 2 months". Measured against `opts.now`. */
  relative: string;
  dayOfWeek: string;
  dayOfYear: number;
  /** ISO 8601 week, as `2026-W01`. The year is the ISO week year, not always the calendar one. */
  isoWeek: string;
  quarter: number;
  isLeapYear: boolean;
  unixSeconds: number;
  unixMilliseconds: number;
  /** The IANA zone actually used, after any default was applied. */
  timezoneName: string;
  /**
   * Minutes east of UTC: Asia/Kolkata is +330, New York is -300 or -240. This is
   * the sign the offset is printed with, and the opposite of the one
   * `Date.prototype.getTimezoneOffset()` returns.
   */
  timezoneOffsetMinutes: number;
}

/** Formatters are expensive to build and immutable once built, so they are cached. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * `hourCycle: 'h23'` rather than `hour12: false`, which in some ICU builds
 * resolves to h24 and prints midnight as "24:00". `era` is asked for so that
 * instants before 1 AD — reachable at the far end of the `Date` range — are not
 * silently read as positive years.
 */
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, made);
  return made;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What a clock in that zone reads at that instant. */
function wallClockAt(ms: number, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = read('hour');
  const era = parts.find((part) => part.type === 'era')?.value ?? 'AD';
  return {
    // ICU counts BC years from 1, so 1 BC is astronomical year 0.
    year: era.startsWith('B') ? 1 - read('year') : read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Read wall-clock fields as though they were UTC. `civilToDayNumber` rather than
 * `Date.UTC`, because `Date.UTC` maps years 0-99 into the 1900s.
 */
function wallClockAsUtcMs(wall: WallClock): number {
  return (
    civilToDayNumber(wall) * MS_PER_DAY +
    wall.hour * 3_600_000 +
    wall.minute * MS_PER_MINUTE +
    wall.second * 1000
  );
}

/**
 * The zone's offset at that instant, measured rather than looked up: format the
 * instant in the zone, read the clock back, and the gap between those fields and
 * the same instant read as UTC *is* the offset.
 *
 * Rounded to the nearest minute for the pre-1900 zones whose offsets carry
 * seconds — Europe/Amsterdam was +00:19:32 until 1937.
 */
function offsetFromWall(wall: WallClock, ms: number): number {
  const truncatedToSecond = Math.floor(ms / 1000) * 1000;
  return Math.round((wallClockAsUtcMs(wall) - truncatedToSecond) / MS_PER_MINUTE);
}

function offsetMinutesAt(ms: number, timeZone: string): number {
  return offsetFromWall(wallClockAt(ms, timeZone), ms);
}

function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Validated by construction: `Intl` throws a `RangeError` for a zone it does not know. */
function resolveZone(timeZone: string | undefined): { ok: true; zone: string } | Failure {
  const zone = timeZone === undefined || timeZone.trim() === '' ? hostTimeZone() : timeZone.trim();
  try {
    partsFormatter(zone);
    return { ok: true, zone };
  } catch {
    return fail(
      `"${zone}" is not a timezone this computer knows. Use an IANA name such as America/New_York, Europe/London or UTC.`,
    );
  }
}

const pad = (value: number, width: number): string => String(Math.abs(value)).padStart(width, '0');

/** `Z` for UTC, otherwise `+05:30`. RFC 2822 wants no colon and never `Z`. */
function offsetLabel(minutes: number, colon = true): string {
  if (minutes === 0 && colon) return 'Z';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}${colon ? ':' : ''}${pad(abs % 60, 2)}`;
}

/** ISO 8601 writes years outside 0-9999 with a sign and six digits, as `toISOString` does. */
function formatYear(year: number): string {
  return year < 0 || year > 9999 ? `${year < 0 ? '-' : '+'}${pad(year, 6)}` : pad(year, 4);
}

const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Largest step in each unit before moving up to the next one. */
const RELATIVE_DIVISIONS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.34524],
  ['month', 12],
];

let relativeFormatter: Intl.RelativeTimeFormat | null = null;

/**
 * "3 days ago", "in 2 months", "yesterday". `Intl.RelativeTimeFormat` writes the
 * words; the cascade below only decides which unit reads most naturally, biggest
 * unit that still gives a number above one.
 */
function relativeTime(ms: number, now: number): string {
  const formatter = (relativeFormatter ??= new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }));
  let delta = (ms - now) / 1000;
  for (const [unit, step] of RELATIVE_DIVISIONS) {
    if (Math.abs(delta) < step) return formatter.format(Math.round(delta), unit);
    delta /= step;
  }
  return formatter.format(Math.round(delta), 'year');
}

function buildBreakdown(rawMs: number, unit: TimestampUnit, zone: string, now: number): TimestampBreakdown {
  const ms = Math.round(rawMs);
  const wall = wallClockAt(ms, zone);
  const offset = offsetFromWall(wall, ms);
  const dayNumber = civilToDayNumber(wall);
  const date = new Date(ms);
  // Positive remainder even for pre-1970 instants, where `ms % 1000` goes negative.
  const fraction = ((ms % 1000) + 1000) % 1000;
  const clock = `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}:${pad(wall.second, 2)}`;
  const day = `${formatYear(wall.year)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
  return {
    unit,
    seconds: Math.floor(ms / 1000),
    milliseconds: ms,
    iso: date.toISOString(),
    isoLocal: `${day}T${clock}.${pad(fraction, 3)}${offsetLabel(offset)}`,
    utcString: date.toUTCString(),
    rfc2822: `${weekdayName(dayNumber).slice(0, 3)}, ${pad(wall.day, 2)} ${MONTH_ABBREVIATIONS[wall.month - 1]} ${formatYear(wall.year)} ${clock} ${offsetLabel(offset, false)}`,
    relative: relativeTime(ms, now),
    dayOfWeek: weekdayName(dayNumber),
    dayOfYear: dayOfYear(wall),
    isoWeek: `${isoWeekYear(wall)}-W${pad(isoWeekNumber(wall), 2)}`,
    quarter: Math.ceil(wall.month / 3),
    isLeapYear: isLeapYear(wall.year),
    unixSeconds: Math.floor(ms / 1000),
    unixMilliseconds: ms,
    timezoneName: zone,
    timezoneOffsetMinutes: offset,
  };
}

export interface FromTimestampOptions {
  /** Skip the guess in `detectUnit` and say what the number is. */
  unit?: TimestampUnit;
  /** IANA name. Defaults to whatever zone this computer is set to. */
  timeZone?: string;
  /** What "now" means for the `relative` field. Defaults to `Date.now()`. */
  now?: number;
}

export type FromTimestampResult =
  | { ok: true; result: TimestampBreakdown; warnings: string[] }
  | Failure;

/** Enough of the input to quote back in an error without pasting an essay. */
function quote(input: unknown): string {
  const text = String(input);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/**
 * Turn a Unix timestamp into every form of the same instant.
 *
 * `warnings` is where the guesswork is admitted: which unit the number was read
 * as when the caller did not say, and any precision lost on the way. Render them —
 * a timestamp read in the wrong unit is out by a factor of a thousand and still
 * looks like a perfectly plausible date.
 */
export function fromTimestamp(input: string | number, opts: FromTimestampOptions = {}): FromTimestampResult {
  const value = typeof input === 'number' ? input : parseLooseNumber(String(input ?? ''));
  if (value === null || !Number.isFinite(value)) {
    if (typeof input === 'string' && input.trim() === '') return fail('Enter a timestamp.');
    return fail(`"${quote(input)}" is not a number. Paste a Unix timestamp such as 1700000000.`);
  }

  const unit = opts.unit ?? detectUnit(value);
  const warnings: string[] = [];
  if (opts.unit === undefined) {
    warnings.push(
      `No unit was given, so ${value} was read as ${UNIT_LABELS[unit]}. Set the unit yourself if that is wrong — the answer changes by a factor of a thousand each way.`,
    );
  }

  const exact = toMilliseconds(value, unit);
  if (!Number.isFinite(exact) || Math.abs(exact) > MAX_DATE_MS) {
    return fail(
      `Read as ${UNIT_LABELS[unit]}, that is further from 1970 than a date can reach. The limit is about 273,790 years either side.`,
    );
  }
  const ms = Math.round(exact);
  if (ms !== exact) {
    warnings.push(
      `A date only holds whole milliseconds, so this was rounded to the nearest one and the last part of the ${UNIT_LABELS[unit]} value was dropped.`,
    );
  }

  const zone = resolveZone(opts.timeZone);
  if (!zone.ok) return zone;
  return { ok: true, result: buildBreakdown(ms, unit, zone.zone, opts.now ?? Date.now()), warnings };
}

export interface ToTimestampInput {
  /** `YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY` — anything `parseDateInput` reads. */
  date: string;
  /** `14:30`, `14:30:05`, `14:30:05.250` or `2:30 pm`. Midnight when left out. */
  time?: string;
  /** The zone the date and time are *in*. Defaults to this computer's zone. */
  timeZone?: string;
}

export type ToTimestampResult =
  | { ok: true; unixSeconds: number; unixMilliseconds: number; iso: string; warnings: string[] }
  | Failure;

interface TimeOfDay {
  ok: true;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const TIME_PATTERN = /^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?(?:[.,](\d{1,3}))?\s*([ap]\.?m\.?)?$/i;

function parseTimeOfDay(text: string): TimeOfDay | Failure {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, hour: 0, minute: 0, second: 0, millisecond: 0 };

  const match = TIME_PATTERN.exec(trimmed);
  if (!match) return fail(`"${quote(text)}" is not a time. Write it as 14:30, 14:30:05 or 2:30 pm.`);

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  const millisecond = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  const suffix = match[5]?.toLowerCase().replace(/\./g, '');
  if (suffix) {
    if (hour < 1 || hour > 12) {
      return fail(`With am or pm the hour has to be between 1 and 12, so ${hour} does not work.`);
    }
    hour = suffix === 'pm' ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
  }
  if (hour > 23) return fail(`There is no ${hour} o'clock — a day runs from 0:00 to 23:59.`);
  if (minute > 59) return fail(`There is no minute ${minute} — minutes run from 0 to 59.`);
  if (second > 59) return fail(`There is no second ${second} — seconds run from 0 to 59.`);
  return { ok: true, hour, minute, second, millisecond };
}

/**
 * Find the instant whose clock in `zone` reads the wall time packed into
 * `localMs` (those fields read as though they were UTC).
 *
 * Why one guess and one correction is enough: reading the fields as UTC puts the
 * first guess at most 14 hours from the truth, since real offsets run from -12:00
 * to +14:00. The offset measured there is therefore either the right one or the
 * one on the other side of a single transition, so subtracting it lands inside
 * the correct offset period and measuring again settles the matter. When the two
 * measurements agree, that is the answer. When they disagree, the wall time
 * itself sits in a transition — it either happens twice (the clocks went back) or
 * never happens (they went forward) — and no amount of iterating produces a third
 * answer to converge on.
 */
function resolveInstant(localMs: number, zone: string): { instant: number; offset: number; gap: boolean } {
  const first = offsetMinutesAt(localMs, zone);
  const guess = localMs - first * MS_PER_MINUTE;
  const second = offsetMinutesAt(guess, zone);
  if (second === first) return { instant: guess, offset: first, gap: false };

  const corrected = localMs - second * MS_PER_MINUTE;
  const third = offsetMinutesAt(corrected, zone);
  if (third === second) return { instant: corrected, offset: second, gap: false };

  // Neither reading is self-consistent, so this wall time fell into the hole a
  // spring-forward leaves behind. Subtracting the smaller (further west) offset
  // gives the later of the two candidates: the requested time pushed forward by
  // the length of the jump, which is the choice Temporal and java.time also make.
  return {
    instant: localMs - Math.min(second, third) * MS_PER_MINUTE,
    offset: Math.max(second, third),
    gap: true,
  };
}

/**
 * When the clocks go back, one wall time happens twice and only one instant can
 * be handed back. This looks for the other one so the warning can admit it.
 */
function ambiguousAlternative(localMs: number, instant: number, offset: number, zone: string): number | null {
  for (const probe of [instant - MS_PER_DAY, instant + MS_PER_DAY]) {
    const other = offsetMinutesAt(probe, zone);
    if (other === offset) continue;
    const candidate = localMs - other * MS_PER_MINUTE;
    if (candidate !== instant && offsetMinutesAt(candidate, zone) === other) return candidate;
  }
  return null;
}

function clockLabel(wall: WallClock): string {
  return `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}:${pad(wall.second, 2)}`;
}

/**
 * The other direction: a date and time **as read on a clock in `timeZone`** to the
 * instant it names.
 *
 * Twice a year a wall time is either missing or doubled, and there is no answer
 * that is simply correct. The convention followed here is the one Temporal calls
 * "compatible", which java.time and ICU also use: a time in the hole a
 * spring-forward leaves is pushed forward by the length of the jump, and a time
 * the clocks handed out twice resolves to the first of the two. Picking by rule
 * rather than by whichever guess the arithmetic happened to land on is what makes
 * the answer the same in every zone.
 *
 * `warnings` carries anything the conversion had to decide on the user's behalf,
 * which is not in the sketch of this function's shape but has to be somewhere:
 * silently choosing one of two instants an hour apart is the sort of thing people
 * only discover much later.
 */
export function toTimestamp(input: ToTimestampInput): ToTimestampResult {
  const date = parseDateInput(input.date);
  if (!date.ok) return date;
  const time = parseTimeOfDay(input.time ?? '');
  if (!time.ok) return time;
  const zone = resolveZone(input.timeZone);
  if (!zone.ok) return zone;

  const wanted: WallClock = {
    year: date.civil.year,
    month: date.civil.month,
    day: date.civil.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  };
  const localMs = wallClockAsUtcMs(wanted) + time.millisecond;
  const warnings = [...date.warnings];

  const resolved = resolveInstant(localMs, zone.zone);
  let instant = resolved.instant;
  let offset = resolved.offset;
  if (resolved.gap) {
    warnings.push(
      `${clockLabel(wanted)} never happened on ${date.iso} in ${zone.zone} — the clocks jumped forward that day — so ${clockLabel(wallClockAt(instant, zone.zone))} was used instead.`,
    );
  } else {
    const alternative = ambiguousAlternative(localMs, instant, offset, zone.zone);
    if (alternative !== null) {
      // Both instants read the same on the clock. Which one `resolveInstant`
      // returned depends on where its first guess landed, so take the earlier
      // deliberately instead.
      if (alternative < instant) {
        instant = alternative;
        offset = offsetMinutesAt(alternative, zone.zone);
      }
      warnings.push(
        `${clockLabel(wanted)} happened twice on ${date.iso} in ${zone.zone} because the clocks went back. The earlier of the two, at ${offsetLabel(offset)}, was used.`,
      );
    }
  }

  return {
    ok: true,
    unixSeconds: Math.floor(instant / 1000),
    unixMilliseconds: instant,
    iso: new Date(instant).toISOString(),
    warnings,
  };
}

/** Everything about right now. An unknown zone falls back to UTC, and says so in `timezoneName`. */
export function nowBreakdown(timeZone?: string): TimestampBreakdown {
  const now = Date.now();
  const zone = resolveZone(timeZone);
  return buildBreakdown(now, 'milliseconds', zone.ok ? zone.zone : 'UTC', now);
}

/**
 * A short list for a dropdown, ordered west to east so the offsets climb. The
 * full IANA set is around 600 entries, most of them aliases of each other, which
 * is a menu nobody can use.
 */
const CURATED_ZONES = [
  'UTC',
  'Pacific/Pago_Pago',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Mexico_City',
  'America/Bogota',
  'America/New_York',
  'America/Toronto',
  'America/Santiago',
  'America/Halifax',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Africa/Lagos',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/Athens',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Asia/Jerusalem',
  'Asia/Riyadh',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Fiji',
] as const;

let curatedCache: string[] | null = null;

/**
 * The curated list, minus anything this runtime does not recognise.
 *
 * `Intl.supportedValuesOf` lists only *canonical* zone names, so a zone the IANA
 * database has since turned into an alias (Europe/Kiev became a link to
 * Europe/Kyiv) drops out on a new runtime while the old name would drop out on an
 * old one. Filtering means the menu never offers a zone that would then fail to
 * format. It is typed defensively because the function is newer than the rest of
 * `Intl` and older runtimes simply do not have it; without it the literal list is
 * returned as-is.
 */
export function listCommonTimeZones(): string[] {
  if (curatedCache) return [...curatedCache];
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let supported: Set<string> | null = null;
  try {
    supported = typeof intl.supportedValuesOf === 'function' ? new Set(intl.supportedValuesOf('timeZone')) : null;
  } catch {
    supported = null;
  }
  // UTC is kept whatever the runtime says: every implementation formats it.
  curatedCache = CURATED_ZONES.filter((zone) => zone === 'UTC' || supported === null || supported.has(zone));
  return [...curatedCache];
}
