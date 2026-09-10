'use client';

/*
 * Date difference calculator.
 *
 * Decisions worth keeping:
 *
 * **Two tabs, because there are two questions and they have different right
 * answers.** "How long from Monday to Friday" is four days as a duration and five
 * days as a head count, and both readings are in daily use. Rather than pick one
 * and look broken to half the visitors, the calendar tab excludes the end date
 * and the working-days tab includes it — matching a spreadsheet NETWORKDAYS, so a
 * figure from here agrees with a figure from a colleague's sheet. The toggle that
 * flips it is on screen in both tabs with the count it produces stated, so nobody
 * has to guess which convention they are looking at.
 *
 * **The two dates are shared across the tabs.** They are the same two dates
 * whichever question you are asking, and clearing a field on every tab switch
 * would be a small betrayal. Only the end-date convention is per-tab, because
 * that is the part that genuinely differs.
 *
 * **The start date is prefilled with today; the end date is left empty.** Today
 * is one end of most real questions ("how long until", "how long since"), and it
 * arrives from an effect because a server render cannot know the visitor's
 * calendar day. An arbitrary end date would be an answer nobody asked for, so the
 * result area shows its empty state until a second date exists.
 *
 * **No built-in public holidays, and the tool says why.** A national calendar
 * would be quietly wrong for a large fraction of visitors — regions differ,
 * substitute days move, employers add their own — and quietly wrong is the worst
 * failure mode a calculator has. You paste the dates, and every entry is reported
 * back as applied or ignored with the reason, so a typo cannot silently inflate
 * the total.
 *
 * **Half-typed dates stay quiet; finished mistakes announce.** Same split as the
 * rest of this family, using the shared tests in `@/components/tool/dateInput`.
 * The engines are handed normalised ISO dates, so their only remaining refusals
 * are about the range itself rather than about parsing.
 */
import { useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { AnswerCard, FactGrid, ShownWorking, type Fact } from '@/components/tool/CalcAnswer';
import {
  inspectDateField,
  isAmbiguousDate,
  localIsoDay,
  looksCompleteDate,
  plural,
  prettyDate,
} from '@/components/tool/dateInput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { describedBy, Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import {
  businessDaysBetween,
  dateDifference,
  parseDateInput,
  type BusinessDaysSuccess,
  type DateDifferenceSuccess,
} from '@/lib/tools/calc/dates';
import { display } from '@/lib/tools/calc/round';

const SLUG = 'date-difference-calculator';
const FROM_ID = 'dd-from';
const TO_ID = 'dd-to';
const END_ID = 'dd-include-end';
const HOLIDAYS_ID = 'dd-holidays';
const ANSWER_HEADING_ID = 'dd-answer-heading';
const HOLIDAYS_HEADING_ID = 'dd-holidays-heading';
const WORKING_HEADING_ID = 'dd-working-heading';

const DATE_HINT = 'YYYY-MM-DD is unambiguous. 03/04/2026 and 4/3/2026 are read too.';
const HOLIDAYS_HINT =
  'One date per line, or separated by commas. Anything outside the range, on a weekend, or listed twice is reported rather than counted.';

const FROM_WAITING = 'Enter the date the range starts on.';
const TO_WAITING = 'Enter the date the range ends on.';

type Mode = 'gap' | 'working';

const TABS: TabDescriptor[] = [
  { id: 'gap', label: 'Calendar days', icon: 'calendar' },
  { id: 'working', label: 'Working days', icon: 'clock' },
];

/** The end-date switch means something different in each tab, so it says so. */
const END_LABEL = 'Count the end date as a whole day';
const END_NOTE: Record<Mode, { on: string; off: string }> = {
  gap: {
    on: 'Monday to Friday counts as five days — the range treated as a list of days.',
    off: 'Monday to Friday counts as four days — the length of the gap, which is what a duration means.',
  },
  working: {
    on: 'Monday to Friday counts as five working days, the same as a spreadsheet NETWORKDAYS.',
    off: 'Monday to Friday counts as four working days, leaving the last day out.',
  },
};

/** The default differs per tab on purpose — see the header. */
const DEFAULT_INCLUDE_END: Record<Mode, boolean> = { gap: false, working: true };

type Outcome =
  | { kind: 'waiting'; reason: string }
  | { kind: 'error'; error: string }
  | { kind: 'gap'; result: DateDifferenceSuccess }
  | { kind: 'working'; result: BusinessDaysSuccess };

/**
 * Newlines, commas and semicolons all separate holiday dates. A comma is safe
 * here in a way it is not in a list of numbers: no date format uses one as a
 * thousands separator, so pasting `2026-01-01, 2026-01-26` cannot be misread.
 */
function splitHolidays(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** `plural` would give "entrys". */
function entryCount(count: number): string {
  return `${display(count)} ${count === 1 ? 'entry' : 'entries'}`;
}

type ReadDate = { ok: true; iso: string } | { ok: false; outcome: Outcome };

/**
 * One field's text as a normalised ISO date, or the outcome that should replace
 * the answer. A blank or half-typed date is a silent wait; a complete date that
 * cannot exist is an error carrying the parser's own sentence, prefixed with the
 * field it belongs to so a two-field form is not a guessing game.
 */
function readDate(text: string, label: string, dayFirst: boolean, waiting: string): ReadDate {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, outcome: { kind: 'waiting', reason: waiting } };

  const parsed = parseDateInput(trimmed, { dayFirst });
  if (parsed.ok) return { ok: true, iso: parsed.iso };

  return {
    ok: false,
    outcome: looksCompleteDate(trimmed)
      ? { kind: 'error', error: `${label}: ${parsed.error}` }
      : { kind: 'waiting', reason: waiting },
  };
}

interface ComputeInput {
  mode: Mode;
  from: string;
  to: string;
  dayFirst: boolean;
  includeEnd: boolean;
  holidays: string;
}

function compute(input: ComputeInput): Outcome {
  const from = readDate(input.from, 'Start date', input.dayFirst, FROM_WAITING);
  if (!from.ok) return from.outcome;

  const to = readDate(input.to, 'End date', input.dayFirst, TO_WAITING);
  if (!to.ok) return to.outcome;

  if (input.mode === 'gap') {
    const outcome = dateDifference({
      from: from.iso,
      to: to.iso,
      includeEndDate: input.includeEnd,
    });
    return outcome.ok ? { kind: 'gap', result: outcome } : { kind: 'error', error: outcome.error };
  }

  const outcome = businessDaysBetween({
    from: from.iso,
    to: to.iso,
    includeEndDate: input.includeEnd,
    holidays: splitHolidays(input.holidays),
  });
  return outcome.ok ? { kind: 'working', result: outcome } : { kind: 'error', error: outcome.error };
}

/**
 * Engine notes, quietly. The only one reachable from here is the swap, because
 * parsing happened before the engine was called — but rendering whatever the
 * engine returns means a new note never goes unshown.
 */
function Notes({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1.5 text-xs text-fg-muted">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
}

/** Which end the range includes, in words, since the switch is above the answer. */
function endClause(includeEnd: boolean): string {
  return includeEnd ? ', with the end date counted' : ', not counting the end date';
}

function GapAnswer({
  result,
  includeEnd,
}: {
  result: DateDifferenceSuccess;
  includeEnd: boolean;
}) {
  const facts: Fact[] = [
    {
      term: 'Years, months and days',
      value: `${plural(result.years, 'year')}, ${plural(result.months, 'month')}, ${plural(result.days, 'day')}`,
    },
    {
      term: 'Weeks and days',
      value: plural(result.weeks, 'week'),
      note: `+ ${plural(result.remainderDays, 'day')}`,
    },
    { term: 'Monday to Friday days', value: display(result.weekdays) },
    { term: 'Weekend days', value: display(result.weekendDays) },
    { term: 'Total hours', value: display(result.totalHours) },
    { term: 'Total minutes', value: display(result.totalMinutes) },
  ];

  return (
    <div className="space-y-5">
      <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
        <h2 id={ANSWER_HEADING_ID} className="sr-only">
          How long between the two dates
        </h2>
        <AnswerCard
          headline={plural(result.totalDays, 'day')}
          sentence={`${prettyDate(result.fromIso)} to ${prettyDate(result.toIso)}${endClause(includeEnd)}.`}
          slug={SLUG}
        />
        <FactGrid facts={facts} columns={3} />
        <Notes warnings={result.warnings} />
      </section>

      <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
        <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
          How that was worked out
        </h2>
        <ShownWorking formula={result.formula} steps={result.steps} slug={SLUG} />
      </section>
    </div>
  );
}

function WorkingAnswer({
  result,
  includeEnd,
}: {
  result: BusinessDaysSuccess;
  includeEnd: boolean;
}) {
  const facts: Fact[] = [
    { term: 'Calendar days counted', value: display(result.totalDays) },
    { term: 'Monday to Friday days', value: display(result.weekdays) },
    { term: 'Weekend days', value: display(result.weekendDays) },
    { term: 'Holidays taken off', value: display(result.holidaysApplied.length) },
  ];
  const mentionsHolidays = result.holidaysApplied.length + result.holidaysIgnored.length > 0;

  return (
    <div className="space-y-5">
      <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
        <h2 id={ANSWER_HEADING_ID} className="sr-only">
          Working days between the two dates
        </h2>
        <AnswerCard
          headline={plural(result.businessDays, 'working day')}
          sentence={`${prettyDate(result.fromIso)} to ${prettyDate(result.toIso)}${endClause(includeEnd)}. Saturdays and Sundays are never counted.`}
          slug={SLUG}
        />
        <FactGrid facts={facts} columns={2} />
        <Notes warnings={result.warnings} />
      </section>

      {mentionsHolidays ? (
        <section aria-labelledby={HOLIDAYS_HEADING_ID} className="space-y-3">
          <h2 id={HOLIDAYS_HEADING_ID} className="text-sm font-medium text-fg">
            What happened to your holiday list
          </h2>

          {result.holidaysApplied.length > 0 ? (
            <div className="rounded border border-border-subtle bg-surface px-3 py-2">
              <p className="text-2xs text-fg-muted">Taken off the total</p>
              <p className="tabular mt-0.5 break-words text-sm font-medium text-fg">
                {result.holidaysApplied.join(', ')}
              </p>
            </div>
          ) : null}

          {result.holidaysIgnored.length > 0 ? (
            <Alert
              variant="warning"
              title={`${entryCount(result.holidaysIgnored.length)} changed nothing`}
            >
              <ul className="space-y-1">
                {result.holidaysIgnored.map((entry) => (
                  <li key={`${entry.value}-${entry.reason}`}>
                    <span className="tabular font-medium">{entry.value}</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
        <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
          How that was worked out
        </h2>
        <ShownWorking formula={result.formula} steps={result.steps} slug={SLUG} />
      </section>
    </div>
  );
}

export function DateDifferenceCalculatorTool() {
  const [mode, setMode] = useState<Mode>('gap');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dayFirst, setDayFirst] = useState(false);
  const [includeEnd, setIncludeEnd] = useState<Record<Mode, boolean>>(DEFAULT_INCLUDE_END);
  const [holidays, setHolidays] = useState('');
  // Null until mounted. A server render cannot know the visitor's calendar day.
  const [today, setToday] = useState<string | null>(null);

  const markStarted = useToolStarted(SLUG);

  useEffect(() => {
    const day = localIsoDay();
    setToday(day);
    setFrom(day);
    // No `markStarted()`: prefilling today is this page getting ready, not the
    // visitor starting a count.
  }, []);

  const endIncluded = includeEnd[mode];

  const outcome = useMemo(
    () => compute({ mode, from, to, dayFirst, includeEnd: endIncluded, holidays }),
    [mode, from, to, dayFirst, endIncluded, holidays],
  );

  const fromState = inspectDateField(from, dayFirst, DATE_HINT);
  const toState = inspectDateField(to, dayFirst, DATE_HINT);
  const showReading = isAmbiguousDate(from) || isAmbiguousDate(to);

  function todayLink(value: string, apply: (next: string) => void) {
    if (today === null || value === today) return undefined;
    return (
      <Button
        variant="link"
        size="sm"
        onClick={() => {
          markStarted();
          apply(today);
        }}
      >
        Today
      </Button>
    );
  }

  function toggleEnd(next: boolean): void {
    markStarted();
    // Written out rather than `{ ...previous, [mode]: next }`: a computed key of
    // union type widens the object to an index signature.
    setIncludeEnd((previous) =>
      mode === 'gap'
        ? { gap: next, working: previous.working }
        : { gap: previous.gap, working: next },
    );
  }

  return (
    <ToolWorkspace
      label="Date difference calculator"
      intro="Count the days between two dates, or only the working days with your own public holidays taken off. Both counts run in this page — the dates never leave your device."
      error={outcome.kind === 'error' ? outcome.error : null}
    >
      <Tabs
        tabs={TABS}
        value={mode}
        onValueChange={(id) => {
          markStarted();
          setMode(id as Mode);
        }}
        ariaLabel="Which kind of day count"
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Start date"
              htmlFor={FROM_ID}
              hint={fromState.hint ?? undefined}
              labelSuffix={todayLink(from, setFrom)}
            >
              <Input
                id={FROM_ID}
                value={from}
                onChange={(event) => {
                  markStarted();
                  setFrom(event.target.value);
                }}
                invalid={fromState.invalid}
                iconLeft="calendar"
                placeholder={today ?? 'YYYY-MM-DD'}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy(FROM_ID, { hint: true })}
              />
            </Field>

            <Field
              label="End date"
              htmlFor={TO_ID}
              hint={toState.hint ?? undefined}
              labelSuffix={todayLink(to, setTo)}
            >
              <Input
                id={TO_ID}
                value={to}
                onChange={(event) => {
                  markStarted();
                  setTo(event.target.value);
                }}
                invalid={toState.invalid}
                iconLeft="calendar"
                placeholder="2026-12-25"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy(TO_ID, { hint: true })}
              />
            </Field>
          </div>

          {/* One control for a setting that applies to both fields, in one place,
              with the reading it produces stated rather than implied by a switch
              position. Only shown once a date could genuinely be read two ways. */}
          {showReading ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
              <Icon name="info" size={14} className="shrink-0" />
              <span>Slashed dates are being read {dayFirst ? 'day first' : 'month first'}.</span>
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  markStarted();
                  setDayFirst(!dayFirst);
                }}
              >
                {dayFirst ? 'Read month first' : 'Read day first'}
              </Button>
            </p>
          ) : null}

          {/* A real `<label for>` rather than a bare `<p>`, so the sentence is a
              hit target too, and `label` matches it word for word — an
              `aria-label` that paraphrases the visible text breaks WCAG 2.5.3. */}
          <div className="flex items-start gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2.5">
            <Switch
              id={END_ID}
              checked={endIncluded}
              onCheckedChange={toggleEnd}
              label={END_LABEL}
              size="sm"
              className="mt-0.5"
            />
            <div className="min-w-0">
              <label htmlFor={END_ID} className="cursor-pointer select-none text-sm text-fg">
                {END_LABEL}
              </label>
              <p className="mt-0.5 text-xs text-fg-muted">
                {endIncluded ? END_NOTE[mode].on : END_NOTE[mode].off}
              </p>
            </div>
          </div>

          {mode === 'working' ? (
            <Field label="Public holidays" htmlFor={HOLIDAYS_ID} hint={HOLIDAYS_HINT} optional>
              <Textarea
                id={HOLIDAYS_ID}
                value={holidays}
                onChange={(event) => {
                  markStarted();
                  setHolidays(event.target.value);
                }}
                rows={4}
                monospace
                spellCheck={false}
                placeholder={'2026-01-01\n2026-12-25'}
                aria-describedby={describedBy(HOLIDAYS_ID, { hint: true })}
              />
            </Field>
          ) : null}

          {outcome.kind === 'waiting' ? (
            <EmptyState icon="calendar" title="Nothing to count yet" description={outcome.reason} />
          ) : null}

          {/* `error` needs nothing here: ToolWorkspace's error slot is both the
              visible banner and the live region. */}

          {outcome.kind === 'gap' ? (
            <GapAnswer result={outcome.result} includeEnd={endIncluded} />
          ) : null}

          {outcome.kind === 'working' ? (
            <WorkingAnswer result={outcome.result} includeEnd={endIncluded} />
          ) : null}
        </div>
      </Tabs>
    </ToolWorkspace>
  );
}
