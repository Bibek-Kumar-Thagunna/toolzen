/**
 * The loan engine: the equated monthly instalment, the amortisation schedule
 * behind it, and the two questions people ask next — "how much can I borrow for
 * this payment?" and "what would paying a little extra save me?".
 *
 * Money becomes whole cents on the way in and plain decimals on the way out, and
 * the amortisation loop in between is exact integer arithmetic. That is what
 * makes the table trustworthy:
 *  - Every row reconciles. Opening balance − principal is *exactly* the closing
 *    balance, with no third of a cent hiding behind a rendered "0.00".
 *  - The columns add up. The principal column sums to the amount borrowed and the
 *    interest column sums to the reported total, with no drift to apologise for.
 *  - Rounding the instalment to the cent leaves a residual that no schedule can
 *    avoid. It is absorbed into the final payment, so the last closing balance is
 *    exactly zero.
 *
 * The totals therefore come from the schedule rather than from instalment × term.
 * The two differ by a few cents — that difference *is* the residual — and taking
 * the schedule's figure means the summary and the table can never disagree, and
 * that a 0% loan whose instalment does not divide evenly reports no interest
 * rather than a few cents of negative interest.
 */

import {
  display,
  displayMoney,
  displayPercent,
  fail,
  isRealNumber,
  roundMoney,
  roundTo,
  smartDecimals,
} from './round.ts';
import type { Explained, Failure, Step } from './round.ts';

/** 50 years: longer than any consumer loan, and it keeps the powers inside float range. */
const MAX_MONTHS = 600;
/** No real loan reaches this, and it keeps every running cent total an exact integer. */
const MAX_AMOUNT = 1e11;

export interface LoanInput {
  /** The amount borrowed. */
  principal: number;
  /** Nominal annual rate as a percentage: 8.5 means 8.5% a year. */
  annualRatePercent: number;
  /** Term in whole months. */
  months: number;
}

/**
 * Shown only if the arithmetic itself fails to produce a real number. Every
 * reachable path is guarded before this, so it exists to make sure a broken
 * result can never be `NaN` on the page.
 */
const UNWORKABLE =
  'These numbers do not produce a repayment we can work out. Please check them and try again.';

/** First failing field wins, so the user reads one actionable sentence rather than a list. */
function validatePrincipal(principal: number): Failure | null {
  if (!isRealNumber(principal)) return fail('Enter the amount you are borrowing.');
  if (principal <= 0) return fail('The amount you are borrowing must be more than zero.');
  if (principal < 0.01) {
    return fail('The amount you are borrowing is too small to work out a repayment for.');
  }
  if (principal > MAX_AMOUNT) {
    return fail('That amount is too large for this calculator. Try 100 billion or less.');
  }
  return null;
}

/** The term and the rate, shared by the forward calculation and the affordability one. */
function validateTerm(annualRatePercent: number, months: number): Failure | null {
  if (!isRealNumber(months)) return fail('Enter the length of the loan in months.');
  if (!Number.isInteger(months)) {
    return fail('The length of the loan must be a whole number of months.');
  }
  if (months < 1) return fail('The loan must run for at least one month.');
  if (months > MAX_MONTHS) {
    return fail(`The loan cannot run for longer than ${MAX_MONTHS} months, which is 50 years.`);
  }
  if (!isRealNumber(annualRatePercent)) return fail('Enter the interest rate.');
  if (annualRatePercent < 0) return fail('The interest rate cannot be less than zero.');
  if (annualRatePercent > 100) return fail('The interest rate cannot be more than 100% a year.');
  return null;
}

function validateLoan(input: LoanInput): Failure | null {
  return validatePrincipal(input.principal) ?? validateTerm(input.annualRatePercent, input.months);
}

/** Money → whole cents: the one place an amount enters the engine. */
function toCents(amount: number): number {
  return roundTo(amount * 100, 0);
}

/** Whole cents → money: the one place an amount leaves it. */
function toMoney(cents: number): number {
  return roundTo(cents / 100, 2);
}

interface Annuity {
  /** Monthly rate as a fraction: 8.5% a year → 0.00708333… */
  rate: number;
  /** (1 + r)^n */
  growth: number;
  /**
   * (1 + r)^n − 1, via `expm1`/`log1p` rather than `Math.pow(1 + r, n) - 1`.
   *
   * At 0.01% a year over a year the naive form subtracts two numbers that agree
   * to eleven digits and keeps the noise; this form keeps the digits. The whole
   * instalment hinges on this quantity, so it is worth the two extra calls.
   */
  growthMinus1: number;
}

function annuity(annualRatePercent: number, months: number): Annuity {
  const rate = annualRatePercent / 12 / 100;
  const growthMinus1 = Math.expm1(months * Math.log1p(rate));
  return { rate, growth: 1 + growthMinus1, growthMinus1 };
}

/**
 * The instalment at full precision: P · r · (1 + r)^n ÷ ((1 + r)^n − 1).
 *
 * A 0% loan is repaid in equal slices of capital. That is its own branch rather
 * than a special case bolted onto the same expression, because the general
 * formula divides by (1 + r)^n − 1, which is exactly zero when r is.
 */
function rawInstalment(input: LoanInput, factors: Annuity): number | null {
  const { rate, growth, growthMinus1 } = factors;
  if (rate === 0) return input.principal / input.months;
  if (!isRealNumber(growthMinus1) || growthMinus1 <= 0) return null;
  const value = (input.principal * rate * growth) / growthMinus1;
  return isRealNumber(value) ? value : null;
}

export interface ScheduleRow {
  /** 1-based instalment number. */
  period: number;
  openingBalance: number;
  payment: number;
  interest: number;
  principal: number;
  closingBalance: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
}

export interface ScheduleSuccess {
  rows: ScheduleRow[];
  /** The scheduled instalment. Extra payments are added on top of it, not folded in. */
  emi: number;
  totalInterest: number;
  totalPayment: number;
  /**
   * Rows produced. Fewer than the term when extra payments clear the loan early —
   * and, for a loan small enough that rounding the instalment up matters, when
   * that extra fraction of a cent a month does it on its own.
   */
  actualMonths: number;
}

export type ScheduleResult = ({ ok: true } & ScheduleSuccess) | Failure;

/**
 * Walk the loan month by month in whole cents. Every other export is a view over
 * this, so the summary card, the table and the overpayment comparison are all
 * reading the same run of the loan.
 *
 * Two things can end a row early, and between them they are why the last closing
 * balance is exactly 0:
 *  - Once a payment would cover more than is left, the payment shrinks to the
 *    exact payoff amount. Nobody hands the lender an overpayment on the last day.
 *  - On the final scheduled period, whatever the instalment failed to clear —
 *    the residual left by rounding it to the cent — is added to that payment.
 *
 * `extraCents` is a voluntary amount added to every instalment. Because it only
 * ever increases the capital portion, the balance is monotonically decreasing and
 * the loop cannot run past the term.
 */
function simulate(input: LoanInput, extraCents: number): ScheduleResult {
  const factors = annuity(input.annualRatePercent, input.months);
  const raw = rawInstalment(input, factors);
  if (raw === null) return fail(UNWORKABLE);

  const emi = roundMoney(raw);
  const instalmentCents = toCents(emi);
  const openingCents = toCents(input.principal);
  if (!isRealNumber(instalmentCents) || !isRealNumber(openingCents)) return fail(UNWORKABLE);
  if (instalmentCents <= 0) {
    return fail(
      'Spread over that many months, this loan works out at less than a cent a month. Try a shorter term.',
    );
  }

  const rows: ScheduleRow[] = [];
  let balance = openingCents;
  let interestSoFar = 0;
  let capitalSoFar = 0;

  for (let period = 1; period <= input.months; period += 1) {
    const opening = balance;
    const interest = roundTo(opening * factors.rate, 0);
    let paid = instalmentCents + extraCents;
    let capital = paid - interest;

    if (capital >= opening || period === input.months) {
      capital = opening;
      paid = opening + interest;
    }

    balance = opening - capital;
    interestSoFar += interest;
    capitalSoFar += capital;

    rows.push({
      period,
      openingBalance: toMoney(opening),
      payment: toMoney(paid),
      interest: toMoney(interest),
      principal: toMoney(capital),
      closingBalance: toMoney(balance),
      cumulativeInterest: toMoney(interestSoFar),
      cumulativePrincipal: toMoney(capitalSoFar),
    });

    if (balance === 0) break;
  }
  return {
    ok: true,
    rows,
    emi,
    totalInterest: toMoney(interestSoFar),
    totalPayment: toMoney(interestSoFar + capitalSoFar),
    actualMonths: rows.length,
  };
}

export interface EmiSuccess {
  /** The monthly instalment, to the cent. This is the headline number. */
  emi: number;
  /** Everything handed over across the term, including the adjusted final payment. */
  totalPayment: number;
  totalInterest: number;
  /** How much of everything paid is interest rather than capital. */
  interestPercentOfTotal: number;
}

export type EmiResult = ({ ok: true } & EmiSuccess & Explained) | Failure;

/**
 * The monthly rate needs more decimals than a headline figure to be recognisable
 * — 8.5% a year is 0.708333% a month, and "0.71%" in the shown working would look
 * like the wrong number to anyone checking it. Eight places is enough that
 * multiplying the shown figures back out reproduces the instalment to the cent.
 */
function rateText(rate: number): string {
  return display(rate, Math.max(8, smartDecimals(rate)));
}

function pluralMonths(months: number): string {
  return `${display(months)} month${months === 1 ? '' : 's'}`;
}

/** The working, in the order a person would write it out on paper. */
function emiSteps(
  input: LoanInput,
  factors: Annuity,
  run: ScheduleSuccess,
  interestShare: number,
): Step[] {
  const steps: Step[] = [];
  if (factors.rate === 0) {
    steps.push({ label: 'Interest rate', value: displayPercent(0) });
  } else {
    steps.push({
      label: `Monthly rate (${displayPercent(input.annualRatePercent)} ÷ 12)`,
      value: rateText(factors.rate),
    });
    steps.push({
      label: `Growth over the term, (1 + ${rateText(factors.rate)})^${display(input.months)}`,
      value: display(factors.growth, 6),
    });
  }
  steps.push({ label: 'Number of payments', value: display(input.months) });
  steps.push({ label: 'Monthly payment', value: displayMoney(run.emi) });
  steps.push({ label: `Paid over ${pluralMonths(input.months)}`, value: displayMoney(run.totalPayment) });
  steps.push({
    label: 'Of which interest',
    value: `${displayMoney(run.totalInterest)} (${displayPercent(interestShare)} of the total)`,
  });
  return steps;
}

/**
 * The equated monthly instalment, plus the totals that go beside it.
 *
 * The totals are the schedule's own, not instalment × term — see the note at the
 * top of the file for why.
 */
export function calculateEmi(input: LoanInput): EmiResult {
  const bad = validateLoan(input);
  if (bad) return bad;

  const factors = annuity(input.annualRatePercent, input.months);
  const run = simulate(input, 0);
  if (!run.ok) return run;

  const { emi, totalPayment, totalInterest } = run;
  if (!isRealNumber(emi) || !isRealNumber(totalPayment) || !isRealNumber(totalInterest)) {
    return fail(UNWORKABLE);
  }
  const interestPercentOfTotal =
    totalPayment > 0 ? roundTo((totalInterest / totalPayment) * 100, 2) : 0;

  const principalText = display(input.principal);
  const monthsText = display(input.months);
  const formula =
    factors.rate === 0
      ? `${principalText} ÷ ${monthsText}`
      : `${principalText} × ${rateText(factors.rate)} × (1 + ${rateText(factors.rate)})^${monthsText}` +
        ` ÷ ((1 + ${rateText(factors.rate)})^${monthsText} − 1)`;

  return {
    ok: true,
    emi,
    totalPayment,
    totalInterest,
    interestPercentOfTotal,
    formula,
    steps: emiSteps(input, factors, run, interestPercentOfTotal),
  };
}

export interface ScheduleOptions {
  /** A voluntary amount added to every instalment. */
  extraMonthlyPayment?: number;
}

function validateExtra(extra: number | undefined): Failure | null {
  if (extra === undefined) return null;
  if (!isRealNumber(extra)) {
    return fail('Enter the extra monthly payment as a number, or leave it empty.');
  }
  if (extra < 0) return fail('An extra payment cannot be less than zero.');
  if (extra > MAX_AMOUNT) return fail('That extra payment is too large for this calculator.');
  return null;
}

/**
 * Every payment of the loan, one row each, ending on a closing balance of
 * exactly 0.
 */
export function amortisationSchedule(input: LoanInput, opts: ScheduleOptions = {}): ScheduleResult {
  const bad = validateLoan(input) ?? validateExtra(opts.extraMonthlyPayment);
  if (bad) return bad;
  return simulate(input, toCents(opts.extraMonthlyPayment ?? 0));
}

export interface YearSummary {
  /** 1 for the first twelve payments, 2 for the next twelve, and so on. */
  year: number;
  interest: number;
  principal: number;
  /** The balance left after the last payment of that year. */
  closingBalance: number;
}

/**
 * Collapse the schedule into one row a year, which is the shape a chart wants and
 * the only shape a 30-year table is readable in.
 *
 * Years are counted from the first payment rather than from January, because the
 * engine is given a term in months and no start date. A copy is sorted by period
 * first, so the grouping does not depend on the caller handing rows over in order.
 */
export function yearlySummary(rows: ScheduleRow[]): YearSummary[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const ordered = rows.slice().sort((a, b) => a.period - b.period);
  const years: YearSummary[] = [];

  for (const row of ordered) {
    const year = Math.max(1, Math.ceil(row.period / 12));
    let bucket = years[years.length - 1];
    if (!bucket || bucket.year !== year) {
      bucket = { year, interest: 0, principal: 0, closingBalance: row.closingBalance };
      years.push(bucket);
    }
    bucket.interest = roundMoney(bucket.interest + row.interest);
    bucket.principal = roundMoney(bucket.principal + row.principal);
    // Rows are in order, so the last one to land here is the end of the year.
    bucket.closingBalance = row.closingBalance;
  }
  return years;
}

export interface AffordabilityInput {
  /** What the borrower can pay each month. */
  emi: number;
  annualRatePercent: number;
  months: number;
}

export type AffordabilityResult = ({ ok: true; principal: number } & Explained) | Failure;

/**
 * The instalment formula solved for the principal:
 *   P = EMI × ((1 + r)^n − 1) ÷ (r × (1 + r)^n)
 *
 * It reuses the same three factors as `calculateEmi`, so the two invert each other
 * to the cent rather than to "about the same". At 0% the factor is simply the
 * number of payments.
 */
export function calculateAffordability(input: AffordabilityInput): AffordabilityResult {
  const { emi, annualRatePercent, months } = input;
  if (!isRealNumber(emi)) return fail('Enter the amount you can pay each month.');
  if (emi <= 0) return fail('The amount you can pay each month must be more than zero.');
  if (emi > MAX_AMOUNT) return fail('That monthly payment is too large for this calculator.');
  const bad = validateTerm(annualRatePercent, months);
  if (bad) return bad;

  const { rate, growth, growthMinus1 } = annuity(annualRatePercent, months);
  const factor = rate === 0 ? months : growthMinus1 / (rate * growth);
  if (!isRealNumber(factor) || factor <= 0) return fail(UNWORKABLE);

  const principal = roundMoney(emi * factor);
  if (!isRealNumber(principal) || principal < 0.01) {
    return fail('That monthly payment is too small to borrow anything over this term.');
  }

  const emiText = displayMoney(emi);
  const monthsText = display(months);
  const formula =
    rate === 0
      ? `${emiText} × ${monthsText}`
      : `${emiText} × ((1 + ${rateText(rate)})^${monthsText} − 1)` +
        ` ÷ (${rateText(rate)} × (1 + ${rateText(rate)})^${monthsText})`;

  return { ok: true, principal, formula, steps: affordabilitySteps(input, rate, factor, principal) };
}

function affordabilitySteps(
  input: AffordabilityInput,
  rate: number,
  factor: number,
  principal: number,
): Step[] {
  const steps: Step[] = [];
  if (rate === 0) {
    steps.push({ label: 'Interest rate', value: displayPercent(0) });
  } else {
    steps.push({
      label: `Monthly rate (${displayPercent(input.annualRatePercent)} ÷ 12)`,
      value: rateText(rate),
    });
  }
  steps.push({ label: 'Number of payments', value: display(input.months) });
  steps.push({ label: 'What 1.00 a month can borrow over the term', value: display(factor, 4) });
  steps.push({ label: 'Amount you could borrow', value: displayMoney(principal) });
  steps.push({
    label: `Repaid over ${pluralMonths(input.months)}`,
    value: displayMoney(roundMoney(input.emi * input.months)),
  });
  return steps;
}

export interface InterestSavedInput extends LoanInput {
  /** Added to every instalment for the life of the loan. */
  extraMonthlyPayment: number;
}

export interface InterestSavedSuccess {
  /** Payments no longer needed. Can be 0: a very small overpayment still saves interest. */
  monthsSaved: number;
  interestSaved: number;
  newTotalInterest: number;
  baselineTotalInterest: number;
  /** The term the overpayments actually produce. */
  newTermMonths: number;
}

export type InterestSavedResult = ({ ok: true } & InterestSavedSuccess) | Failure;

/**
 * The same loan run twice — once as scheduled, once with the overpayment — and the
 * difference between them.
 *
 * Two degenerate cases are turned away rather than answered, because the honest
 * answer to each is a sentence and not a table:
 *  - A loan with a single payment has nothing to shorten.
 *  - An overpayment large enough to clear the loan in the first month is not an
 *    overpayment, it is settling the debt, and every figure here would be
 *    misleading.
 */
export function interestSaved(input: InterestSavedInput): InterestSavedResult {
  const bad = validateLoan(input) ?? validateExtra(input.extraMonthlyPayment);
  if (bad) return bad;
  if (!isRealNumber(input.extraMonthlyPayment)) {
    return fail('Enter the extra amount you would pay each month.');
  }

  const extraCents = toCents(input.extraMonthlyPayment);
  if (extraCents <= 0) {
    return fail('Enter an extra monthly payment of at least 0.01 to see what it saves.');
  }
  if (input.months === 1) {
    return fail('This loan is repaid in a single payment already, so paying extra cannot shorten it.');
  }

  const baseline = simulate(input, 0);
  if (!baseline.ok) return baseline;
  const faster = simulate(input, extraCents);
  if (!faster.ok) return faster;
  if (faster.actualMonths <= 1) {
    return fail(
      'That extra payment clears the whole loan in the first month. Try a smaller amount to see the saving.',
    );
  }

  const saved = roundMoney(baseline.totalInterest - faster.totalInterest);
  if (!isRealNumber(saved)) return fail(UNWORKABLE);

  return {
    ok: true,
    monthsSaved: baseline.actualMonths - faster.actualMonths,
    interestSaved: saved,
    newTotalInterest: faster.totalInterest,
    baselineTotalInterest: baseline.totalInterest,
    newTermMonths: faster.actualMonths,
  };
}

