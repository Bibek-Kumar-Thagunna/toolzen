/*
 * Reading a date somebody typed, and describing what was read.
 *
 * These began inside the age calculator and moved here when the date difference
 * calculator needed the same behaviour. The shared part is not arithmetic — the
 * engines in `src/lib/tools/calc/dates.ts` own that — it is the judgement calls a
 * *field* has to make while a person is still typing into it:
 *
 *  - Is this a half-typed date or a finished mistake? A red border and an
 *    announced error on "1996-0" is a telling-off for typing; the same treatment
 *    on "2026-02-30" is the tool doing its job. `looksCompleteDate` is the line
 *    between them, and every date tool must draw it in the same place or the
 *    family stops feeling like one product.
 *  - Could this date be read two ways? `isAmbiguousDate` answers structurally
 *    rather than by matching the parser's warning prose, which is a message
 *    written for a person and free to be reworded at any time.
 *
 * Not a client module: pure functions of their arguments, no hooks, no JSX. The
 * one that touches the clock, `localIsoDay`, is safe to *define* anywhere and
 * unsafe to *call* during render — see its own note.
 */
import { parseDateInput, toIsoDate } from '@/lib/tools/calc/dates';
import { display } from '@/lib/tools/calc/round';

/** Replaces the static hint while a date is still being typed. */
export const DATE_TYPING_HINT = 'Keep going — a full date such as 1996-02-29 or 29/02/1996.';

/**
 * Pinned locale and time zone, so a formatted date is byte-identical on the
 * server and in the browser. Left to the visitor's locale it would not be, and
 * every date on the page would be a hydration mismatch.
 */
const LONG_DATE = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** `2027-02-28` → `February 28, 2027`. Unreadable input is returned unchanged. */
export function prettyDate(iso: string): string {
  const parsed = parseDateInput(iso);
  return parsed.ok ? LONG_DATE.format(parsed.date) : iso;
}

/**
 * `3 days`, `1 day`. Lives here rather than in a general formatting module
 * because the date tools are the only callers so far; move it out on the third.
 */
export function plural(count: number, noun: string): string {
  return `${display(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Today's *local* calendar day.
 *
 * Only ever safe to call from an effect. A component renders once on the server,
 * where the visitor's calendar day is unknowable: reading the clock during render
 * yields either UTC's day — wrong by one either side of midnight for most of the
 * planet — or a hydration mismatch when the two runs disagree.
 */
export function localIsoDay(): string {
  const now = new Date();
  return toIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

/**
 * True when the text is a whole date attempt rather than one halfway typed.
 * A complete attempt that cannot be a real date is a settled mistake worth
 * announcing; "1996-0" is just a keystroke, so it stays quiet.
 */
export function looksCompleteDate(text: string): boolean {
  return /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[T\s].*)?$/.test(text.trim());
}

/**
 * True when the text is a slashed date whose first two numbers could each be a
 * month, so a reading toggle has to decide which it is. `05/05/2026` is not
 * ambiguous in any way that matters: both readings give the same day.
 */
export function isAmbiguousDate(text: string): boolean {
  const parts = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*$/.exec(text);
  if (!parts) return false;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  return first <= 12 && second <= 12 && first !== second;
}

/** What one date field has to say for itself. Never announced. */
export interface DateFieldState {
  /** Replaces the field's static hint when set. */
  hint: string | null;
  invalid: boolean;
}

/**
 * Inspect one field's text for its own hint line and border state.
 *
 * `invalid` is true on exactly the condition that should send a tool's compute
 * step down its error route — a parse failure on a complete-looking date. Keeping
 * the two in step is what guarantees the red border is never the only signal that
 * something is wrong: the sentence explaining it is on screen at the same time.
 */
export function inspectDateField(
  text: string,
  dayFirst: boolean,
  staticHint: string,
): DateFieldState {
  if (text.trim() === '') return { hint: staticHint, invalid: false };

  const parsed = parseDateInput(text, { dayFirst });
  if (parsed.ok) {
    // A warning here is the parser reporting which reading it took, or that it
    // expanded a two-digit year. Both belong under the box, not in a live region.
    return { hint: parsed.warnings[0] ?? staticHint, invalid: false };
  }

  return looksCompleteDate(text)
    ? { hint: staticHint, invalid: true }
    : { hint: DATE_TYPING_HINT, invalid: false };
}
