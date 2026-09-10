'use client';

/*
 * EMI calculator.
 *
 * Decisions worth keeping:
 *
 * **The rate and the term are shared across both tabs; only the fourth quantity
 * changes.** "What is the payment on this amount" and "what amount does this
 * payment support" are the same formula solved for different unknowns, over the
 * same rate and the same term. Clearing those two fields on a tab switch would be
 * a small betrayal, and it is the same rule the date difference calculator
 * follows with its two dates.
 *
 * **Everything is computed during render.** No clock, no randomness, no effects:
 * every figure is a pure function of the fields, so the server render and the
 * first client render agree and the page arrives with a worked example already on
 * it. The schedule is at most 600 rows of integer arithmetic, which is cheap
 * enough to redo on a keystroke.
 *
 * **The summary always describes the loan as scheduled, never the loan with an
 * overpayment folded in.** An extra payment produces a second, separate run, and
 * its figures live in their own section under their own heading. Mixing the two
 * would give a card whose total interest disagreed with the table under it.
 *
 * **A refusal about the extra payment never takes the instalment off the page.**
 * The extra is optional, so its problems are reported beside it and the primary
 * answer stands. Only a refusal about the loan itself — an impossible term, an
 * instalment below a cent — reaches `ToolWorkspace`'s error, which announces.
 *
 * **The schedule is behind a disclosure, and the rows are not rendered until it
 * is opened.** A native `<details>` would have been fewer lines, but its content
 * is still built: React would reconcile several thousand cells on every keystroke
 * for a table nobody has asked to see. A disclosure button with `aria-expanded`
 * over a conditionally-rendered body costs one piece of state and pays for itself
 * on a 30-year loan.
 *
 * **Amounts carry no currency symbol.** The formula is identical in every
 * currency and this tool has no idea which one a visitor means, so printing a
 * symbol would be a guess with a flag attached. Grouped thousands and two
 * decimals are enough to read an amount as money.
 *
 * **The estimate is labelled as an estimate, permanently.** A figure from here
 * and a figure from a lender rarely agree to the cent, because fees, insurance,
 * day-count conventions and the lender's own rounding sit outside the formula.
 * That line is on screen before anything is typed, not tucked into the FAQ.
 */
import { useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { AnswerCard, FactGrid, ShownWorking, type Fact } from '@/components/tool/CalcAnswer';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { describedBy, Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import {
  amortisationSchedule,
  calculateAffordability,
  calculateEmi,
  interestSaved,
  yearlySummary,
  type EmiSuccess,
  type InterestSavedSuccess,
  type ScheduleRow,
  type ScheduleSuccess,
  type YearSummary,
} from '@/lib/tools/calc/emi';
import {
  display,
  displayMoney,
  displayPercent,
  parseLooseNumber,
  roundMoney,
  type Explained,
  type Step,
} from '@/lib/tools/calc/round';

const SLUG = 'emi-calculator';

const AMOUNT_ID = 'emi-amount';
const PAYMENT_ID = 'emi-payment';
const RATE_ID = 'emi-rate';
const TERM_ID = 'emi-term';
const EXTRA_ID = 'emi-extra';
const SCHEDULE_TEXT_ID = 'emi-schedule-text';
const ANSWER_HEADING_ID = 'emi-answer-heading';
const EXTRA_HEADING_ID = 'emi-extra-heading';
const WORKING_HEADING_ID = 'emi-working-heading';
const SCHEDULE_HEADING_ID = 'emi-schedule-heading';
const SCHEDULE_BODY_ID = 'emi-schedule-body';

type Mode = 'payment' | 'borrow';

const TABS: TabDescriptor[] = [
  { id: 'payment', label: 'Monthly payment', icon: 'calculator' },
  { id: 'borrow', label: 'What it supports', icon: 'swap' },
];

/** The term is entered in whichever unit the loan is usually quoted in. */
type TermUnit = 'months' | 'years';
const TERM_UNITS: readonly TermUnit[] = ['months', 'years'];
const UNIT_LABELS: Record<TermUnit, string> = { months: 'Months', years: 'Years' };

/** Field labels, in one place: the waiting sentences name the box by its label. */
const LABELS = {
  amount: 'Amount borrowed',
  payment: 'Monthly payment',
  rate: 'Interest rate',
  term: 'Term',
} as const;

const NOT_A_NUMBER =
  'Not a number yet. Digits, a decimal point, thousands separators and a currency symbol are all read fine.';
const AMOUNT_HINT =
  'No currency symbol is needed, and none is shown: the formula is the same in any currency.';
const RATE_HINT = 'The nominal annual rate. The monthly rate is this figure divided by twelve.';
const TERM_HINT = 'Whole months only, up to 600. Years are converted, so 4.5 years is 54 months.';
const EXTRA_HINT = 'Paid on top of every instalment, so all of it comes off the balance.';
const PAYMENT_HINT = 'What you can pay each month. The amount it supports is worked out below.';

/*
 * A worked example rather than four empty boxes. A 20-year loan is the case where
 * the interest share is worth seeing — it comes out at roughly half of everything
 * paid — and because nothing here reads a clock, the answer below is on the page
 * that arrives from the server rather than appearing a moment after it.
 */
const DEFAULT_AMOUNT = '250000';
const DEFAULT_PAYMENT = '1500';
const DEFAULT_RATE = '8.5';
const DEFAULT_TERM = '20';
const DEFAULT_UNIT: TermUnit = 'years';

/**
 * The term in months, whatever unit it was typed in.
 *
 * Years are multiplied by twelve and then snapped: 4.5 × 12 is exactly 54, but
 * plenty of decimals that should land on a whole month arrive a billionth short
 * in binary floating point, and the engine rejects a fractional month. The snap
 * is tight enough that a genuinely fractional term — 4.3 years, 51.6 months — is
 * still refused, with the engine's own sentence saying why.
 */
function termToMonths(value: number, unit: TermUnit): number {
  if (unit === 'months') return value;
  const months = value * 12;
  const whole = Math.round(months);
  return Math.abs(months - whole) < 1e-9 ? whole : months;
}

function monthsText(months: number): string {
  return `${display(months)} month${months === 1 ? '' : 's'}`;
}

/** "(5 years)", but only when the term divides evenly — otherwise it is noise. */
function yearsNote(months: number): string | undefined {
  if (months <= 0 || months % 12 !== 0) return undefined;
  const years = months / 12;
  return `${display(years)} ${years === 1 ? 'year' : 'years'}`;
}

type Outcome =
  | { kind: 'waiting'; reason: string }
  | { kind: 'error'; error: string }
  | {
      kind: 'payment';
      result: EmiSuccess & Explained;
      months: number;
      /** The two figures the answer restates, so the card confirms the question. */
      principal: number;
      rate: number;
      /** The loan as scheduled. Every figure in the summary comes from this run. */
      baseline: ScheduleSuccess;
      /** The run the table shows: the same loan, plus any extra payment applied. */
      schedule: ScheduleSuccess;
      /** The extra actually applied, which is 0 whenever it could not be. */
      extra: number;
      saving: InterestSavedSuccess | null;
      /** Why there is no comparison, when the field is not simply empty. */
      savingNote: string | null;
    }
  | {
      kind: 'borrow';
      principal: number;
      payment: number;
      rate: number;
      months: number;
      formula: string;
      steps: Step[];
    };

/** A field's number, or the sentence naming the box that is still waiting. */
type Reading = { ok: true; value: number } | { ok: false; reason: string };

function readNumber(text: string, label: string): Reading {
  const value = parseLooseNumber(text);
  if (value === null) {
    return { ok: false, reason: `Enter a number in “${label}” to see the answer.` };
  }
  return { ok: true, value };
}

/**
 * Whether a field earns a red border.
 *
 * Blank is not invalid: it is a box nobody has reached yet, and a red border on
 * an empty field reads as a telling-off rather than as information. Note that
 * only *unreadable* text is marked — a number the engine goes on to refuse, such
 * as a 700-month term, is a perfectly good number, and its refusal is a sentence
 * rather than a colour.
 */
function looksWrong(text: string): boolean {
  return text.trim() !== '' && parseLooseNumber(text) === null;
}

/**
 * The optional extra payment, resolved into an amount to apply and, when there is
 * something to say about it, a sentence.
 *
 * A half-typed number gets no sentence: the field's own hint already says it is
 * not a number yet, and a second copy of that under the answer would be nagging.
 */
function readExtra(text: string): { amount: number; note: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { amount: 0, note: null };

  const value = parseLooseNumber(trimmed);
  if (value === null) return { amount: 0, note: null };
  if (value <= 0) {
    return { amount: 0, note: 'An extra payment has to be more than zero to change anything.' };
  }
  return { amount: value, note: null };
}

interface ComputeInput {
  mode: Mode;
  amount: string;
  payment: string;
  rate: string;
  term: string;
  unit: TermUnit;
  extra: string;
}

function compute(input: ComputeInput): Outcome {
  const rate = readNumber(input.rate, LABELS.rate);
  if (!rate.ok) return { kind: 'waiting', reason: rate.reason };

  const term = readNumber(input.term, LABELS.term);
  if (!term.ok) return { kind: 'waiting', reason: term.reason };
  const months = termToMonths(term.value, input.unit);

  if (input.mode === 'borrow') {
    const payment = readNumber(input.payment, LABELS.payment);
    if (!payment.ok) return { kind: 'waiting', reason: payment.reason };

    const outcome = calculateAffordability({
      emi: payment.value,
      annualRatePercent: rate.value,
      months,
    });
    if (!outcome.ok) return { kind: 'error', error: outcome.error };

    return {
      kind: 'borrow',
      principal: outcome.principal,
      payment: payment.value,
      rate: rate.value,
      months,
      formula: outcome.formula,
      steps: outcome.steps,
    };
  }

  const amount = readNumber(input.amount, LABELS.amount);
  if (!amount.ok) return { kind: 'waiting', reason: amount.reason };

  const loan = { principal: amount.value, annualRatePercent: rate.value, months };
  const result = calculateEmi(loan);
  if (!result.ok) return { kind: 'error', error: result.error };

  // Two runs of the same loan, because the summary and the table answer different
  // questions once an overpayment exists. Both are integer arithmetic over at
  // most 600 months, so running both costs nothing worth optimising.
  const baseline = amortisationSchedule(loan);
  if (!baseline.ok) return { kind: 'error', error: baseline.error };

  const extra = readExtra(input.extra);
  // A refusal from here can only be about the extra payment — the loan itself has
  // already produced an instalment — so the table falls back to the loan as
  // scheduled and the sentence goes beside the extra field instead of replacing
  // the answer.
  const wanted =
    extra.amount > 0 ? amortisationSchedule(loan, { extraMonthlyPayment: extra.amount }) : baseline;
  const applied = wanted.ok ? extra.amount : 0;

  let saving: InterestSavedSuccess | null = null;
  let savingNote = wanted.ok ? extra.note : wanted.error;
  if (applied > 0) {
    const compared = interestSaved({ ...loan, extraMonthlyPayment: applied });
    if (compared.ok) saving = compared;
    else savingNote = compared.error;
  }

  return {
    kind: 'payment',
    result,
    months,
    principal: amount.value,
    rate: rate.value,
    baseline,
    schedule: wanted.ok ? wanted : baseline,
    extra: applied,
    saving,
    savingNote,
  };
}

/**
 * The schedule as tab-separated text.
 *
 * Ungrouped figures on purpose — "1,250.00" lands in too many spreadsheets as
 * text — and it carries every column the table leaves out, because the reason to
 * take a schedule elsewhere is usually to reconcile it against something.
 */
function scheduleText(rows: ScheduleRow[]): string {
  const header = [
    'Month',
    'Opening balance',
    'Payment',
    'Interest',
    'Capital',
    'Closing balance',
    'Interest to date',
    'Capital to date',
  ].join('\t');
  const lines = rows.map((row) =>
    [
      row.period,
      row.openingBalance.toFixed(2),
      row.payment.toFixed(2),
      row.interest.toFixed(2),
      row.principal.toFixed(2),
      row.closingBalance.toFixed(2),
      row.cumulativeInterest.toFixed(2),
      row.cumulativePrincipal.toFixed(2),
    ].join('\t'),
  );
  return [header, ...lines].join('\n');
}

const HEAD_CELL = 'py-1.5 pl-2 text-right text-2xs font-medium text-fg-muted';
const MONEY_CELL = 'tabular py-1.5 pl-2 text-right text-fg';

/**
 * Every payment, one row each.
 *
 * Five columns rather than seven: the opening balance is the previous row's
 * closing balance, and the cumulative columns are a running sum of two of the
 * others. Both are in the copyable text below the table, and leaving them out is
 * what lets this fit a 320px screen without sideways scrolling — which for a
 * table of nothing but numbers is worth more than completeness on screen.
 */
function MonthTable({ rows }: { rows: ScheduleRow[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">
        Every payment in order, split into interest and capital, with the balance left after each
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-1.5 pr-2 text-left text-2xs font-medium text-fg-muted">
            Month
          </th>
          <th scope="col" className={HEAD_CELL}>
            Payment
          </th>
          <th scope="col" className={HEAD_CELL}>
            Interest
          </th>
          <th scope="col" className={HEAD_CELL}>
            Capital
          </th>
          <th scope="col" className={HEAD_CELL}>
            Balance left
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.period} className="border-t border-border-subtle">
            <th scope="row" className="tabular py-1.5 pr-2 text-left font-normal text-fg-muted">
              {display(row.period)}
            </th>
            <td className={MONEY_CELL}>{displayMoney(row.payment)}</td>
            <td className={MONEY_CELL}>{displayMoney(row.interest)}</td>
            <td className={MONEY_CELL}>{displayMoney(row.principal)}</td>
            <td className={MONEY_CELL}>{displayMoney(row.closingBalance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One row a year, which is the view most people want: a 360-row table is not
 * something anybody reads. Years are numbered from the first payment rather than
 * by calendar year, because this tool never asks when the loan starts — and
 * inventing a start date would put a wrong date on every row.
 */
function YearTable({ years }: { years: YearSummary[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <caption className="sr-only">
        Interest and capital paid in each year of the loan, counting from the first payment, with
        the balance left at the end of each year
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="py-1.5 pr-2 text-left text-2xs font-medium text-fg-muted">
            Year
          </th>
          <th scope="col" className={HEAD_CELL}>
            Interest
          </th>
          <th scope="col" className={HEAD_CELL}>
            Capital
          </th>
          <th scope="col" className={HEAD_CELL}>
            Balance left
          </th>
        </tr>
      </thead>
      <tbody>
        {years.map((year) => (
          <tr key={year.year} className="border-t border-border-subtle">
            <th scope="row" className="tabular py-1.5 pr-2 text-left font-normal text-fg-muted">
              {display(year.year)}
            </th>
            <td className={MONEY_CELL}>{displayMoney(year.interest)}</td>
            <td className={MONEY_CELL}>{displayMoney(year.principal)}</td>
            <td className={MONEY_CELL}>{displayMoney(year.closingBalance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Which view of the schedule is on screen. */
type Detail = 'year' | 'month';

/** Picks the view, and builds the yearly rollup only when it is the one shown. */
function ScheduleTable({ schedule, detail }: { schedule: ScheduleSuccess; detail: Detail }) {
  if (detail === 'month') return <MonthTable rows={schedule.rows} />;
  return <YearTable years={yearlySummary(schedule.rows)} />;
}

const NOTE = 'flex items-start gap-1.5 text-xs text-fg-muted';

function Schedule({
  schedule,
  extra,
  open,
  onOpenChange,
  detail,
  onDetailChange,
}: {
  schedule: ScheduleSuccess;
  /** The extra actually applied, so the table can say when it is in the figures. */
  extra: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Null until somebody chooses, so the default can follow the loan's length. */
  detail: Detail | null;
  onDetailChange: (next: Detail) => void;
}) {
  const resolved: Detail = detail ?? (schedule.actualMonths > 12 ? 'year' : 'month');
  const final = schedule.rows[schedule.rows.length - 1];
  // Worth explaining only when there is nothing else explaining it: an extra
  // payment always makes the last payment a partial one, and says so itself.
  const residual = extra === 0 && Math.abs(final.payment - schedule.emi) >= 0.005;

  return (
    <section aria-labelledby={SCHEDULE_HEADING_ID} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={SCHEDULE_HEADING_ID} className="text-sm font-medium text-fg">
          Payment schedule
        </h2>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={open ? 'chevron-up' : 'chevron-down'}
          aria-expanded={open}
          aria-controls={SCHEDULE_BODY_ID}
          onClick={() => onOpenChange(!open)}
        >
          {open ? 'Hide the schedule' : `Show all ${monthsText(schedule.actualMonths)}`}
        </Button>
      </div>

      {/* The container is always rendered so `aria-controls` never points at
          nothing; only its contents are conditional. */}
      <div id={SCHEDULE_BODY_ID}>
        {open ? (
          <div className="space-y-3">
            {/* Two buttons with `aria-pressed` rather than a second set of tabs:
                these switch the level of detail in one table, not the question
                being asked, and the page already has tabs doing the latter. */}
            <div
              role="group"
              aria-label="How much of the schedule to show"
              className="flex flex-wrap items-center gap-1"
            >
              <Button
                variant={resolved === 'year' ? 'secondary' : 'ghost'}
                size="sm"
                iconLeft="list"
                aria-pressed={resolved === 'year'}
                onClick={() => onDetailChange('year')}
              >
                Year by year
              </Button>
              <Button
                variant={resolved === 'month' ? 'secondary' : 'ghost'}
                size="sm"
                iconLeft="table"
                aria-pressed={resolved === 'month'}
                onClick={() => onDetailChange('month')}
              >
                Every payment
              </Button>
            </div>

            {extra > 0 ? (
              <p className={NOTE}>
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>
                  These rows include the extra {displayMoney(extra)} a month, which is why they stop
                  at {monthsText(schedule.actualMonths)}. The last payment is{' '}
                  {displayMoney(final.payment)} — whatever was left to clear.
                </span>
              </p>
            ) : null}

            {residual ? (
              <p className={NOTE}>
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>
                  The last payment is {displayMoney(final.payment)} rather than{' '}
                  {displayMoney(schedule.emi)}. Every figure here is worked in whole cents, and the
                  few cents of rounding left over are settled at the end, so the balance closes at
                  exactly zero.
                </span>
              </p>
            ) : null}

            {/* Five columns fit 320px, so this should never actually scroll — it
                is here for a long term at a huge amount, and carries no
                `tabIndex` because a scroll container only needs one when it can
                really overflow. */}
            <div className="overflow-x-auto scrollbar-thin">
              <ScheduleTable schedule={schedule} detail={resolved} />
            </div>

            <TextOutput
              slug={SLUG}
              id={SCHEDULE_TEXT_ID}
              label="The whole schedule as text"
              value={scheduleText(schedule.rows)}
              copyTarget="schedule"
              downloadName="amortisation-schedule.txt"
              rows={5}
              monospace
              footer="Tab separated, and ungrouped so a spreadsheet reads the figures as numbers rather than as text. Carries the opening balance and the two running totals that the table above leaves out."
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The instalment, what it adds up to, what an overpayment would change, the
 * working, and the schedule — in that order, because that is the order the
 * questions arrive in.
 */
function PaymentAnswer({
  outcome,
  scheduleOpen,
  onScheduleOpenChange,
  detail,
  onDetailChange,
}: {
  outcome: Extract<Outcome, { kind: 'payment' }>;
  scheduleOpen: boolean;
  onScheduleOpenChange: (next: boolean) => void;
  detail: Detail | null;
  onDetailChange: (next: Detail) => void;
}) {
  const { result, months, principal, rate, baseline, schedule, extra, saving, savingNote } =
    outcome;
  const first = baseline.rows[0];
  const last = baseline.rows[baseline.rows.length - 1];
  const years = yearsNote(months);

  const facts: Fact[] = [
    { term: 'Total paid over the term', value: displayMoney(result.totalPayment) },
    { term: 'Total interest', value: displayMoney(result.totalInterest) },
    { term: 'Interest as a share of that', value: displayPercent(result.interestPercentOfTotal) },
    { term: 'Payments', value: monthsText(months), note: years },
  ];
  // On a single-payment loan these two would be the same row twice.
  if (baseline.rows.length > 1) {
    facts.push(
      {
        term: 'Interest in payment 1',
        value: displayMoney(first.interest),
        note: `capital ${displayMoney(first.principal)}`,
      },
      {
        term: 'Interest in the final payment',
        value: displayMoney(last.interest),
        note: `capital ${displayMoney(last.principal)}`,
      },
    );
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
        <h2 id={ANSWER_HEADING_ID} className="sr-only">
          Monthly instalment
        </h2>
        <AnswerCard
          headline={`${displayMoney(result.emi)} a month`}
          sentence={`${displayMoney(principal)} borrowed at ${display(rate)}% a year over ${monthsText(months)}${years === undefined ? '' : ` (${years})`}.`}
          slug={SLUG}
        />
        <FactGrid facts={facts} columns={3} />
      </section>

      {/* Its own section under its own heading, never folded into the summary
          above: the card describes the loan as agreed, and an overpayment is a
          separate decision with separate figures. */}
      {saving !== null || savingNote !== null ? (
        <section aria-labelledby={EXTRA_HEADING_ID} className="space-y-3">
          <h2 id={EXTRA_HEADING_ID} className="text-sm font-medium text-fg">
            Paying extra every month
          </h2>

          {saving !== null ? (
            <>
              <p className="text-sm text-fg-muted">
                {displayMoney(extra)} on top of every instalment —{' '}
                {displayMoney(roundMoney(result.emi + extra))} a month in total.
              </p>
              <FactGrid
                columns={2}
                facts={[
                  { term: 'Interest never paid', value: displayMoney(saving.interestSaved) },
                  {
                    term: 'Time saved',
                    value: monthsText(saving.monthsSaved),
                    note: yearsNote(saving.monthsSaved),
                  },
                  {
                    term: 'Repaid after',
                    value: monthsText(saving.newTermMonths),
                    note: yearsNote(saving.newTermMonths),
                  },
                  {
                    term: 'Interest instead',
                    value: displayMoney(saving.newTotalInterest),
                    note: `was ${displayMoney(saving.baselineTotalInterest)}`,
                  },
                ]}
              />
            </>
          ) : null}

          {savingNote !== null ? <Alert variant="info">{savingNote}</Alert> : null}
        </section>
      ) : null}

      <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
        <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
          How that was worked out
        </h2>
        <ShownWorking formula={result.formula} steps={result.steps} slug={SLUG} />
      </section>

      <Schedule
        schedule={schedule}
        extra={extra}
        open={scheduleOpen}
        onOpenChange={onScheduleOpenChange}
        detail={detail}
        onDetailChange={onDetailChange}
      />
    </div>
  );
}

/**
 * The reverse question: a payment, and the amount it supports.
 *
 * No schedule on this tab. The amount here is worked back from the payment and
 * rounded to the cent, so a table built on it would describe a loan a few cents
 * away from the figure above it. The other tab takes an amount as its input and
 * has the schedule.
 */
function BorrowAnswer({ outcome }: { outcome: Extract<Outcome, { kind: 'borrow' }> }) {
  const { principal, payment, rate, months, formula, steps } = outcome;
  const totalPaid = roundMoney(payment * months);
  const years = yearsNote(months);

  return (
    <div className="space-y-5">
      <section aria-labelledby={ANSWER_HEADING_ID} className="space-y-3">
        <h2 id={ANSWER_HEADING_ID} className="sr-only">
          Amount that monthly payment supports
        </h2>
        <AnswerCard
          headline={displayMoney(principal)}
          sentence={`What ${displayMoney(payment)} a month supports at ${display(rate)}% a year over ${monthsText(months)}${years === undefined ? '' : ` (${years})`}.`}
          slug={SLUG}
        />
        <FactGrid
          columns={2}
          facts={[
            {
              term: 'Paid in total',
              value: displayMoney(totalPaid),
              note: `${monthsText(months)} × ${displayMoney(payment)}`,
            },
            {
              term: 'Interest inside that',
              value: displayMoney(roundMoney(totalPaid - principal)),
            },
          ]}
        />
      </section>

      <section aria-labelledby={WORKING_HEADING_ID} className="space-y-2">
        <h2 id={WORKING_HEADING_ID} className="text-sm font-medium text-fg">
          How that was worked out
        </h2>
        <ShownWorking formula={formula} steps={steps} slug={SLUG} />
      </section>
    </div>
  );
}

export function EmiCalculatorTool() {
  const [mode, setMode] = useState<Mode>('payment');
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [payment, setPayment] = useState(DEFAULT_PAYMENT);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [term, setTerm] = useState(DEFAULT_TERM);
  const [unit, setUnit] = useState<TermUnit>(DEFAULT_UNIT);
  const [extra, setExtra] = useState('');
  // The disclosure lives here, not inside `Schedule`, for two reasons: an open
  // table survives a recompute, and `useToolStarted` dedupes per hook instance,
  // so a child calling its own copy would report a second `tool_started`.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDetail, setScheduleDetail] = useState<Detail | null>(null);

  const markStarted = useToolStarted(SLUG);

  const outcome = useMemo(
    () => compute({ mode, amount, payment, rate, term, unit, extra }),
    [mode, amount, payment, rate, term, unit, extra],
  );

  return (
    <ToolWorkspace
      label="EMI calculator"
      intro="The monthly instalment a loan implies, where the interest goes, and what paying a little extra would save. Every figure is worked out in this page — the numbers you type never leave your device."
      error={outcome.kind === 'error' ? outcome.error : null}
    >
      <Tabs
        tabs={TABS}
        value={mode}
        onValueChange={(id) => {
          markStarted();
          setMode(id as Mode);
        }}
        ariaLabel="Which question to answer"
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'payment' ? (
              <Field
                label={LABELS.amount}
                htmlFor={AMOUNT_ID}
                hint={looksWrong(amount) ? NOT_A_NUMBER : AMOUNT_HINT}
              >
                <Input
                  id={AMOUNT_ID}
                  value={amount}
                  onChange={(event) => {
                    markStarted();
                    setAmount(event.target.value);
                  }}
                  invalid={looksWrong(amount)}
                  numeric
                  placeholder="250000"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={describedBy(AMOUNT_ID, { hint: true })}
                />
              </Field>
            ) : (
              <Field
                label={LABELS.payment}
                htmlFor={PAYMENT_ID}
                hint={looksWrong(payment) ? NOT_A_NUMBER : PAYMENT_HINT}
              >
                <Input
                  id={PAYMENT_ID}
                  value={payment}
                  onChange={(event) => {
                    markStarted();
                    setPayment(event.target.value);
                  }}
                  invalid={looksWrong(payment)}
                  numeric
                  placeholder="1500"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={describedBy(PAYMENT_ID, { hint: true })}
                />
              </Field>
            )}

            <Field
              label={LABELS.rate}
              htmlFor={RATE_ID}
              hint={looksWrong(rate) ? NOT_A_NUMBER : RATE_HINT}
            >
              <Input
                id={RATE_ID}
                value={rate}
                onChange={(event) => {
                  markStarted();
                  setRate(event.target.value);
                }}
                invalid={looksWrong(rate)}
                numeric
                suffix="%"
                placeholder="8.5"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy(RATE_ID, { hint: true })}
              />
            </Field>

            {/* The number and its unit are one question, so they share one label
                and one hint. Each control sits in its own sizing wrapper because
                `Input` builds its own relative wrapper once `suffix` is set, and
                that wrapper takes no className — so flex widths have to be set
                from outside it. */}
            <Field
              label={LABELS.term}
              htmlFor={TERM_ID}
              hint={looksWrong(term) ? NOT_A_NUMBER : TERM_HINT}
            >
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    id={TERM_ID}
                    value={term}
                    onChange={(event) => {
                      markStarted();
                      setTerm(event.target.value);
                    }}
                    invalid={looksWrong(term)}
                    numeric
                    placeholder="20"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedBy(TERM_ID, { hint: true })}
                  />
                </div>
                <div className="w-28 shrink-0">
                  {/* The hint belongs to the whole question, so the unit points at
                      it too — a screen reader landing here hears the 600-month
                      limit and the years conversion rather than nothing. */}
                  <Select
                    value={unit}
                    onChange={(event) => {
                      markStarted();
                      setUnit(event.target.value as TermUnit);
                    }}
                    aria-label="Unit for the term"
                    aria-describedby={describedBy(TERM_ID, { hint: true })}
                  >
                    {TERM_UNITS.map((value) => (
                      <option key={value} value={value}>
                        {UNIT_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </Field>

            {mode === 'payment' ? (
              <Field
                label="Extra each month"
                htmlFor={EXTRA_ID}
                hint={looksWrong(extra) ? NOT_A_NUMBER : EXTRA_HINT}
                optional
              >
                <Input
                  id={EXTRA_ID}
                  value={extra}
                  onChange={(event) => {
                    markStarted();
                    setExtra(event.target.value);
                  }}
                  invalid={looksWrong(extra)}
                  numeric
                  placeholder="250"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={describedBy(EXTRA_ID, { hint: true })}
                />
              </Field>
            ) : null}
          </div>

          {outcome.kind === 'waiting' ? (
            <EmptyState
              icon="calculator"
              title="Nothing to work out yet"
              description={outcome.reason}
            />
          ) : null}

          {/* `error` needs nothing here: ToolWorkspace's error slot is both the
              visible banner and the live region, so repeating the sentence would
              announce it twice. */}

          {outcome.kind === 'payment' ? (
            <PaymentAnswer
              outcome={outcome}
              scheduleOpen={scheduleOpen}
              onScheduleOpenChange={(next) => {
                markStarted();
                setScheduleOpen(next);
              }}
              detail={scheduleDetail}
              onDetailChange={(next) => {
                markStarted();
                setScheduleDetail(next);
              }}
            />
          ) : null}

          {outcome.kind === 'borrow' ? <BorrowAnswer outcome={outcome} /> : null}

          {/* On screen before anything is typed, and it stays there: the gap
              between this figure and a lender's is small but it is never zero. */}
          <p className={NOTE}>
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            <span>
              An estimate, not a quote. Arrangement fees, insurance, a lender&rsquo;s day-count
              convention and its own rounding all sit outside this formula, so a lender&rsquo;s
              figure will usually differ by a little. It is arithmetic, not financial advice.
            </span>
          </p>
        </div>
      </Tabs>
    </ToolWorkspace>
  );
}
