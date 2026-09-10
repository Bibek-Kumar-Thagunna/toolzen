'use client';

/*
 * Age calculator.
 *
 * Decisions worth keeping:
 *
 * **Today's date arrives after mount, and the page is honest about that.** This
 * component is server-rendered once, and a server has no idea what day it is
 * where the visitor is standing. Reading the clock during render would either
 * produce UTC's day (wrong by up to a day either side of midnight) or a
 * hydration mismatch. So `today` starts null, an effect fills it in, and the
 * date of birth field starts empty — which means the pre-hydration paint shows
 * the real empty state ("enter a date of birth") rather than a worked example
 * that flickers into a different one. The other calculators do prefill, because
 * their examples do not depend on the clock.
 *
 * **A text field, not `<input type="date">`.** The native control looks
 * different in every browser, cannot be styled to match anything, and its
 * keyboard entry order follows the browser locale rather than the page. Worse,
 * for the one job this tool exists for — a date forty years ago — its picker is
 * a long way from where it opens. The engine reads YYYY-MM-DD, DD/MM/YYYY and
 * MM/DD/YYYY, so typing is fast and the accepted forms are stated on the field.
 * The cost is genuine ambiguity in a date like 03/12/1990, which is answered by
 * the reading toggle rather than by guessing quietly.
 *
 * **Two error routes, as everywhere else in this family.** A half-typed date is
 * not a mistake: "1996-0" leaves the answer area empty and says nothing. A
 * complete date that cannot exist — 2026-02-30, or a birth date in the future —
 * is a settled mistake, so it goes to `ToolWorkspace`'s error, which announces.
 *
 * **The engine is handed normalised ISO dates.** Ambiguity and two-digit years
 * are resolved here, next to the field that caused them, where a note can sit
 * under the box that needs correcting. The working below is then pure arithmetic
 * with no parser asides in it.
 *
 * **Both answers are shown on a leap-day birthday.** On 28 February someone born
 * on 29 February is turning thirty and is also, strictly, 29 years and 11 months
 * old. Picking one would make the other look like a bug.
 *
 * The judgement calls a date *field* makes while someone is typing — half-typed
 * versus finished-and-wrong, and whether a slashed date could be read two ways —
 * live in `@/components/tool/dateInput`, shared with the date difference
 * calculator so both tools draw those lines in the same place.
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
import { calculateAge, type AgeResult } from '@/lib/tools/calc/age';
import { parseDateInput } from '@/lib/tools/calc/dates';
import { display } from '@/lib/tools/calc/round';

const SLUG = 'age-calculator';
const BIRTH_ID = 'age-birth';
const AS_OF_ID = 'age-as-of';
const ANSWER_HEADING_ID = 'age-answer-heading';
const BIRTHDAY_HEADING_ID = 'age-birthday-heading';
const SIGNS_HEADING_ID = 'age-signs-heading';
const WORKING_HEADING_ID = 'age-working-heading';

const BIRTH_HINT = 'YYYY-MM-DD, 29/02/1996 and 2/29/1996 are all read correctly.';
const AS_OF_HINT = 'Today, taken from your device. Change it for an age on any other day.';

type Outcome =
  | { kind: 'waiting' }
  | { kind: 'error'; error: string }
  | {
      kind: 'value';
      result: AgeResult;
      /** The day the age was measured to, normalised. */
      asOfIso: string;
      /** Day of the month someone was born on, for the observed-birthday note. */
      birthDayOfMonth: number;
      birthYear: number;
    };

interface ComputeInput {
  birth: string;
  /** Null until the effect has read the device's calendar day. */
  asOf: string | null;
  dayFirst: boolean;
}

function computeAge(input: ComputeInput): Outcome {
  const birthText = input.birth.trim();
  if (birthText === '') return { kind: 'waiting' };

  const birth = parseDateInput(birthText, { dayFirst: input.dayFirst });
  if (!birth.ok) {
    return looksCompleteDate(birthText)
      ? { kind: 'error', error: `Date of birth: ${birth.error}` }
      : { kind: 'waiting' };
  }

  // Empty only before the effect runs: an empty field falls back to `today`.
  const asOfText = (input.asOf ?? '').trim();
  if (asOfText === '') return { kind: 'waiting' };

  const asOf = parseDateInput(asOfText, { dayFirst: input.dayFirst });
  if (!asOf.ok) {
    return looksCompleteDate(asOfText)
      ? { kind: 'error', error: `Date to measure to: ${asOf.error}` }
      : { kind: 'waiting' };
  }

  // Normalised ISO in, so the engine's only remaining refusal is a future birth.
  const outcome = calculateAge({ birthDate: birth.iso, asOf: asOf.iso });
  if (!outcome.ok) return { kind: 'error', error: outcome.error };

  return {
    kind: 'value',
    result: outcome.result,
    asOfIso: asOf.iso,
    birthDayOfMonth: birth.civil.day,
    birthYear: birth.civil.year,
  };
}

function ageHeadline(result: AgeResult): string {
  return `${plural(result.years, 'year')}, ${plural(result.months, 'month')} and ${plural(result.days, 'day')}`;
}

/**
 * The answer, in the order the page promises to answer it: the breakdown, the
 * totals people actually ask for, the next birthday, the working, and the two
 * zodiacs last, labelled as the conventions they are.
 */
function AgeAnswer({
  result,
  asOfIso,
  birthYear,
  observedShift,
  isToday,
}: {
  result: AgeResult;
  asOfIso: string;
  birthYear: number;
  /** The next birthday is observed on a different day of the month than the birth. */
  observedShift: boolean;
  isToday: boolean;
}) {
  const next = result.nextBirthday;
  const totals: Fact[] = [
    { term: 'Whole months lived', value: display(result.totalMonths) },
    {
      term: 'Whole weeks lived',
      value: display(result.totalWeeks),
      note: `+ ${plural(result.totalDays % 7, 'day')}`,
    },
    { term: 'Total days', value: display(result.totalDays) },
    { term: 'Total hours', value: display(result.totalHours) },
    { term: 'Total minutes', value: display(result.totalMinutes) },
    { term: 'Born on a', value: result.bornOnDayOfWeek },
  ];

  return (
    <div className="space-y-5">
      <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
        <h2 id={ANSWER_HEADING_ID} className="sr-only">
          Age
        </h2>
        <AnswerCard
          headline={ageHeadline(result)}
          sentence={`Age on ${prettyDate(asOfIso)}${isToday ? ', today' : ''}. Born on a ${result.bornOnDayOfWeek}.`}
          slug={SLUG}
        />
        <FactGrid facts={totals} columns={3} />
      </section>

      <section aria-labelledby={BIRTHDAY_HEADING_ID} className="space-y-3">
        <h2 id={BIRTHDAY_HEADING_ID} className="text-sm font-medium text-fg">
          Next birthday
        </h2>

        {result.isBirthdayToday ? (
          <Alert
            variant="info"
            icon="spark"
            title={`That birthday is today — turning ${display(next.turning)}`}
          >
            {next.turning === result.years
              ? 'Which is why the breakdown above comes out at zero months and zero days.'
              : `The strict count still reads ${plural(result.years, 'year')} and ${plural(result.months, 'month')}, because the date of birth itself does not come round in ${asOfIso.slice(0, 4)}. The completed year ticks over tomorrow. Both figures are true, so both are shown.`}
          </Alert>
        ) : (
          <FactGrid
            columns={3}
            facts={[
              { term: 'Date', value: prettyDate(next.date), note: `(${next.dayOfWeek})` },
              { term: 'Days away', value: plural(next.inDays, 'day') },
              { term: 'Turning', value: display(next.turning) },
            ]}
          />
        )}

        {observedShift ? (
          <p className="flex items-start gap-1.5 text-xs text-fg-muted">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              That date of birth has no anniversary in {next.date.slice(0, 4)}, so the birthday is
              observed on {prettyDate(next.date)} — the same convention payroll and legal systems
              use.
            </span>
          </p>
        ) : null}
      </section>

      <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
        <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
          How that was worked out
        </h2>
        <ShownWorking formula={result.formula} steps={result.steps} slug={SLUG} />
      </section>

      <section aria-labelledby={SIGNS_HEADING_ID} className="space-y-3">
        <h2 id={SIGNS_HEADING_ID} className="text-sm font-medium text-fg">
          Star sign and zodiac animal
        </h2>
        <FactGrid
          facts={[
            { term: 'Star sign', value: result.zodiac, note: '(conventional dates)' },
            {
              term: 'Chinese zodiac',
              value: result.chineseZodiac,
              note: result.chineseZodiacUncertain ? '(may be the previous one)' : undefined,
            },
          ]}
        />
        {result.chineseZodiacUncertain ? (
          <Alert variant="warning" title="That animal may be the previous one">
            The Chinese year begins at the lunar new year, which lands somewhere between 21 January
            and 20 February and moves from year to year. A birth date before 21 February can fall
            either side of it, so check the new-year date for {birthYear} if the animal matters.
          </Alert>
        ) : null}
        <p className="text-xs text-fg-subtle">
          The star sign uses the usual fixed date ranges rather than the sun&rsquo;s real position,
          which wobbles by up to a day from year to year.
        </p>
      </section>
    </div>
  );
}

export function AgeCalculatorTool() {
  const [birth, setBirth] = useState('');
  const [asOf, setAsOf] = useState('');
  const [dayFirst, setDayFirst] = useState(false);
  // Null until mounted. A server render cannot know the visitor's calendar day,
  // and guessing UTC's would be wrong for half the planet around midnight.
  const [today, setToday] = useState<string | null>(null);

  const markStarted = useToolStarted(SLUG);

  useEffect(() => {
    const day = localIsoDay();
    setToday(day);
    setAsOf(day);
    // Deliberately no `markStarted()`: filling in today's date is this page
    // getting ready, not the user starting a calculation.
  }, []);

  // Clearing the second field means "today" rather than "no date at all", so
  // deleting it cannot strand the answer.
  const effectiveAsOf = asOf.trim() === '' ? today : asOf;

  const outcome = useMemo(
    () => computeAge({ birth, asOf: effectiveAsOf, dayFirst }),
    [birth, effectiveAsOf, dayFirst],
  );

  const birthState = inspectDateField(birth, dayFirst, BIRTH_HINT);
  const asOfState = inspectDateField(asOf, dayFirst, AS_OF_HINT);

  // The toggle appears only once a date could genuinely be read either way.
  // Offering it permanently would be one more control to reason about on a page
  // whose whole job is two boxes.
  const showReading = isAmbiguousDate(birth) || isAmbiguousDate(asOf);
  const canReset = today !== null && asOf !== today;
  const isToday = today !== null && outcome.kind === 'value' && outcome.asOfIso === today;
  const observedShift =
    outcome.kind === 'value' &&
    outcome.birthDayOfMonth !== Number(outcome.result.nextBirthday.date.slice(8, 10));

  return (
    <ToolWorkspace
      label="Age calculator"
      intro="Counts real calendar months and days rather than an average year, so the answer matches the way birthdays are actually counted. The arithmetic runs in this page — the date you type is never sent anywhere."
      error={outcome.kind === 'error' ? outcome.error : null}
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Date of birth"
            htmlFor={BIRTH_ID}
            hint={birthState.hint ?? undefined}
          >
            <Input
              id={BIRTH_ID}
              value={birth}
              onChange={(event) => {
                markStarted();
                setBirth(event.target.value);
              }}
              invalid={birthState.invalid}
              iconLeft="calendar"
              placeholder="1996-02-29"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy(BIRTH_ID, { hint: true })}
            />
          </Field>

          <Field
            label="Date to measure to"
            htmlFor={AS_OF_ID}
            hint={asOfState.hint ?? undefined}
            labelSuffix={
              canReset ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    markStarted();
                    setAsOf(today ?? '');
                  }}
                >
                  Back to today
                </Button>
              ) : undefined
            }
          >
            <Input
              id={AS_OF_ID}
              value={asOf}
              onChange={(event) => {
                markStarted();
                setAsOf(event.target.value);
              }}
              invalid={asOfState.invalid}
              iconLeft="calendar"
              placeholder={today ?? 'YYYY-MM-DD'}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={describedBy(AS_OF_ID, { hint: true })}
            />
          </Field>
        </div>

        {/* One control for a setting that applies to both fields, in one place,
            with the reading it produces stated rather than implied by a switch
            position. Same wording and position as the date difference
            calculator, so the two tools are not subtly different products. */}
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

        {outcome.kind === 'waiting' ? (
          <EmptyState
            icon="calendar"
            title="Enter a date of birth"
            description="The age, the totals and the next birthday appear here as soon as the date is complete."
          />
        ) : null}

        {/* `error` needs nothing here: ToolWorkspace's error slot is both the
            visible banner and the live region, so repeating the sentence would
            announce it twice. */}

        {outcome.kind === 'value' ? (
          <AgeAnswer
            result={outcome.result}
            asOfIso={outcome.asOfIso}
            birthYear={outcome.birthYear}
            observedShift={observedShift}
            isToday={isToday}
          />
        ) : null}
      </div>
    </ToolWorkspace>
  );
}
