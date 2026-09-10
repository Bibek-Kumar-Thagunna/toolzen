import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amortisationSchedule,
  calculateAffordability,
  calculateEmi,
  interestSaved,
  yearlySummary,
} from './emi.ts';
import type { LoanInput, ScheduleRow } from './emi.ts';
import { roundMoney, roundTo } from './round.ts';
import type { Failure } from './round.ts';

/** Deterministic PRNG: a property test that fails must fail again on the next run. */
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

/** Adding 2dp floats drifts, so every comparison of a column total lands on the cent. */
function sum(values: number[]): number {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

function lastRow(rows: ScheduleRow[]): ScheduleRow {
  const row = rows[rows.length - 1];
  assert.ok(row, 'expected the schedule to have at least one row');
  return row;
}

/**
 * How many cents apart two money figures are, as an integer.
 *
 * `Math.abs(4339.12 - 4339.11) <= 0.01` is false in binary floating point — the
 * subtraction lands on 0.010000000000218 — so a tolerance of "one cent" has to be
 * counted in cents rather than expressed as 0.01.
 */
function centsApart(a: number, b: number): number {
  return Math.abs(roundTo(a * 100, 0) - roundTo(b * 100, 0));
}

/** Every engine owes the page a formula and at least one step. */
function assertExplained(value: { formula: string; steps: Array<{ label: string; value: string }> }): void {
  assert.ok(value.formula.length > 0, 'formula must not be empty');
  assert.ok(!/NaN|Infinity|undefined/.test(value.formula), `formula leaked: ${value.formula}`);
  assert.ok(value.steps.length > 0, 'at least one step of working is required');
  for (const step of value.steps) {
    assert.ok(step.label.length > 0 && step.value.length > 0, 'steps must be fully populated');
    assert.ok(!/NaN|Infinity/.test(step.value), `step leaked a non-finite value: ${step.value}`);
  }
}

/** Anything rendered as money must already be an exact number of cents. */
function assertWholeCents(value: number, what: string): void {
  assert.ok(Number.isFinite(value), `${what} must be finite, got ${value}`);
  assert.equal(value, roundMoney(value), `${what} is not a whole number of cents: ${value}`);
}

/**
 * The five loans the schedule has to close out exactly: a long mortgage, a 0%
 * instalment plan, an awkward rate, an odd term one month short of 30 years, and a
 * degenerate loan whose rounded instalment barely covers its own interest.
 */
const CASES: LoanInput[] = [
  { principal: 500000, annualRatePercent: 8.5, months: 240 },
  { principal: 1000, annualRatePercent: 0, months: 12 },
  { principal: 250000, annualRatePercent: 13.37, months: 84 },
  { principal: 99999, annualRatePercent: 7.25, months: 359 },
  { principal: 1, annualRatePercent: 99, months: 600 },
];

function label(input: LoanInput): string {
  return `${input.principal} at ${input.annualRatePercent}% over ${input.months} months`;
}

test('schedule: the final closing balance is exactly zero', () => {
  for (const input of CASES) {
    const run = expectOk(amortisationSchedule(input));
    assert.equal(run.rows.length, input.months, label(input));
    assert.equal(run.actualMonths, input.months, label(input));
    assert.equal(lastRow(run.rows).closingBalance, 0, label(input));
    // Not "0.00 when rounded" — the underlying number itself.
    assert.ok(Object.is(lastRow(run.rows).closingBalance, 0), label(input));
  }
});

test('schedule: the columns add up to the loan and to the reported totals', () => {
  for (const input of CASES) {
    const run = expectOk(amortisationSchedule(input));
    const last = lastRow(run.rows);

    assert.equal(sum(run.rows.map((row) => row.principal)), input.principal, label(input));
    assert.equal(sum(run.rows.map((row) => row.interest)), run.totalInterest, label(input));
    assert.equal(sum(run.rows.map((row) => row.payment)), run.totalPayment, label(input));
    assert.equal(roundMoney(run.totalPayment - input.principal), run.totalInterest, label(input));
    assert.equal(last.cumulativeInterest, run.totalInterest, label(input));
    assert.equal(last.cumulativePrincipal, input.principal, label(input));
  }
});

test('schedule: every row reconciles and the balance only ever falls', () => {
  for (const input of CASES) {
    const run = expectOk(amortisationSchedule(input));
    let previousClosing = input.principal;
    let interestSoFar = 0;

    for (const row of run.rows) {
      const where = `${label(input)}, period ${row.period}`;
      for (const [value, what] of [
        [row.openingBalance, 'opening balance'],
        [row.payment, 'payment'],
        [row.interest, 'interest'],
        [row.principal, 'principal'],
        [row.closingBalance, 'closing balance'],
        [row.cumulativeInterest, 'cumulative interest'],
        [row.cumulativePrincipal, 'cumulative principal'],
      ] as Array<[number, string]>) {
        assertWholeCents(value, `${what} at ${where}`);
      }

      assert.equal(row.openingBalance, previousClosing, `balance carried into ${where}`);
      assert.equal(roundMoney(row.interest + row.principal), row.payment, `payment splits at ${where}`);
      assert.equal(roundMoney(row.openingBalance - row.principal), row.closingBalance, where);
      assert.ok(row.interest >= 0 && row.principal >= 0, `negative component at ${where}`);
      assert.ok(row.closingBalance <= row.openingBalance, `balance rose at ${where}`);

      interestSoFar = roundMoney(interestSoFar + row.interest);
      assert.equal(row.cumulativeInterest, interestSoFar, `cumulative interest at ${where}`);
      previousClosing = row.closingBalance;
    }

    assert.deepEqual(run.rows.map((row) => row.period), run.rows.map((_row, index) => index + 1));
  }
});

test('known value: 100,000 at 10% over 120 months is an instalment of 1,321.51', () => {
  const result = expectOk(calculateEmi({ principal: 100000, annualRatePercent: 10, months: 120 }));
  assert.equal(result.emi, 1321.51);
  assert.equal(roundMoney(result.totalPayment - result.totalInterest), 100000);
  assert.ok(result.interestPercentOfTotal > 35 && result.interestPercentOfTotal < 40);
  assert.match(result.formula, /100,000/);
  assert.match(result.formula, /\^120/);
  assertExplained(result);
});

test('a 0% loan is repaid in equal slices of capital with no interest', () => {
  const result = expectOk(calculateEmi({ principal: 1200, annualRatePercent: 0, months: 12 }));
  assert.equal(result.emi, 100);
  assert.equal(result.totalInterest, 0);
  assert.equal(result.totalPayment, 1200);
  assert.equal(result.interestPercentOfTotal, 0);
  assertExplained(result);

  const run = expectOk(amortisationSchedule({ principal: 1200, annualRatePercent: 0, months: 12 }));
  assert.ok(run.rows.every((row) => row.interest === 0), 'a 0% loan charges no interest');
  assert.ok(run.rows.every((row) => row.payment === 100));
  assert.equal(lastRow(run.rows).closingBalance, 0);
});

test('a 0% loan that does not divide evenly still reports no interest', () => {
  // 1000 ÷ 12 is 83.3333…, so the instalment is 83.33 and the last payment takes
  // the four cents the rounding left behind. Interest × term would report −0.04.
  const result = expectOk(calculateEmi({ principal: 1000, annualRatePercent: 0, months: 12 }));
  assert.equal(result.emi, 83.33);
  assert.equal(result.totalInterest, 0);
  assert.equal(result.totalPayment, 1000);

  const run = expectOk(amortisationSchedule({ principal: 1000, annualRatePercent: 0, months: 12 }));
  const last = lastRow(run.rows);
  assert.equal(last.closingBalance, 0);
  assert.equal(last.payment, 83.37);
  assert.equal(sum(run.rows.map((row) => row.principal)), 1000);
});

test('a one-month loan is a single row that closes the balance', () => {
  const run = expectOk(amortisationSchedule({ principal: 5000, annualRatePercent: 12, months: 1 }));
  const last = lastRow(run.rows);
  assert.equal(run.rows.length, 1);
  assert.equal(last.interest, 50);
  assert.equal(last.principal, 5000);
  assert.equal(last.closingBalance, 0);
});

test('a tiny loan whose instalment rounds up is repaid early, and says so', () => {
  // 3.00 over 600 months is half a cent a month, which has to be charged as a
  // whole cent — so the loan honestly ends after 300 payments, not 600.
  const run = expectOk(amortisationSchedule({ principal: 3, annualRatePercent: 0, months: 600 }));
  assert.equal(run.emi, 0.01);
  assert.equal(run.actualMonths, 300);
  assert.equal(run.rows.length, 300);
  assert.equal(lastRow(run.rows).closingBalance, 0);
  assert.equal(sum(run.rows.map((row) => row.principal)), 3);
});

test('a loan whose instalment rounds to nothing is turned away, not shown as 0.00', () => {
  const input: LoanInput = { principal: 1, annualRatePercent: 0, months: 600 };
  assert.match(expectFail(amortisationSchedule(input)), /less than a cent a month/);
  assert.match(expectFail(calculateEmi(input)), /less than a cent a month/);
  // The same loan at a real rate has an instalment worth charging, so it runs.
  assert.equal(expectOk(calculateEmi({ ...input, annualRatePercent: 99 })).emi, 0.08);
});

/**
 * The round trip is run payment → principal → payment, because that is the
 * direction that can be exact.
 *
 * Going the other way loses information that no amount of care recovers: the
 * instalment is published to the cent, and over a 240-month term each half-cent of
 * that rounding is worth about 58 cents of principal. Starting from the payment,
 * the only rounding is the principal's own half cent, which is worth a fraction of
 * a cent of instalment — so the loop closes.
 */
test('calculateAffordability inverts calculateEmi to within a cent', () => {
  const random = mulberry32(20260903);
  for (let index = 0; index < 100; index += 1) {
    const emi = roundMoney(10 + random() * 9990);
    const annualRatePercent = index % 7 === 0 ? 0 : roundTo(random() * 40, 3);
    const months = 1 + Math.floor(random() * 600);
    const where = `${emi} a month at ${annualRatePercent}% over ${months} months`;

    const borrowed = expectOk(calculateAffordability({ emi, annualRatePercent, months }));
    assertWholeCents(borrowed.principal, `principal for ${where}`);
    assertExplained(borrowed);

    const back = expectOk(
      calculateEmi({ principal: borrowed.principal, annualRatePercent, months }),
    );
    assert.ok(
      centsApart(back.emi, emi) <= 1,
      `${where} implied ${borrowed.principal}, which came back as ${back.emi}`,
    );
  }
});

test('calculateAffordability: the 0% case is simply payment × term', () => {
  const borrowed = expectOk(calculateAffordability({ emi: 250, annualRatePercent: 0, months: 24 }));
  assert.equal(borrowed.principal, 6000);
  assert.match(borrowed.formula, /250\.00 × 24/);
  assertExplained(borrowed);
});

test('calculateAffordability: rejects what it cannot answer', () => {
  assert.match(expectFail(calculateAffordability({ emi: 0, annualRatePercent: 8, months: 24 })), /more than zero/);
  assert.match(expectFail(calculateAffordability({ emi: -5, annualRatePercent: 8, months: 24 })), /more than zero/);
  assert.match(expectFail(calculateAffordability({ emi: Number.NaN, annualRatePercent: 8, months: 24 })), /^Enter/);
  assert.match(expectFail(calculateAffordability({ emi: 500, annualRatePercent: 8, months: 0 })), /at least one month/);
  assert.match(expectFail(calculateAffordability({ emi: 500, annualRatePercent: 101, months: 24 })), /100%/);
});

test('interestSaved: paying extra shortens the term and the schedule still closes', () => {
  const input: LoanInput = { principal: 500000, annualRatePercent: 8.5, months: 240 };
  const saved = expectOk(interestSaved({ ...input, extraMonthlyPayment: 1000 }));

  assert.ok(saved.newTermMonths < input.months, `term did not shorten: ${saved.newTermMonths}`);
  assert.ok(saved.monthsSaved > 0, `no months saved: ${saved.monthsSaved}`);
  assert.ok(saved.interestSaved > 0, `no interest saved: ${saved.interestSaved}`);
  assert.equal(saved.monthsSaved, input.months - saved.newTermMonths);
  assert.equal(roundMoney(saved.baselineTotalInterest - saved.newTotalInterest), saved.interestSaved);
  assertWholeCents(saved.interestSaved, 'interest saved');

  const faster = expectOk(amortisationSchedule(input, { extraMonthlyPayment: 1000 }));
  const last = lastRow(faster.rows);
  assert.equal(faster.actualMonths, saved.newTermMonths);
  assert.equal(faster.rows.length, saved.newTermMonths);
  assert.equal(last.closingBalance, 0);
  assert.equal(faster.totalInterest, saved.newTotalInterest);
  assert.equal(sum(faster.rows.map((row) => row.principal)), input.principal);
  assert.equal(sum(faster.rows.map((row) => row.interest)), faster.totalInterest);
  // The last payment is trimmed to what is left rather than overshooting.
  assert.ok(last.payment <= roundMoney(faster.emi + 1000), `overshot: ${last.payment}`);
});

test('interestSaved: an overpayment on the degenerate loan still amortises it', () => {
  // 1.00 at 99% has a 0.08 instalment that only covers its own interest, so this
  // is the case where the extra payment is the only thing repaying capital.
  const saved = expectOk(interestSaved({ principal: 1, annualRatePercent: 99, months: 600, extraMonthlyPayment: 0.05 }));
  assert.ok(saved.newTermMonths < 600);
  assert.ok(saved.interestSaved > 0);

  const faster = expectOk(amortisationSchedule({ principal: 1, annualRatePercent: 99, months: 600 }, { extraMonthlyPayment: 0.05 }));
  assert.equal(lastRow(faster.rows).closingBalance, 0);
  assert.equal(sum(faster.rows.map((row) => row.principal)), 1);
});

test('interestSaved: the degenerate overpayments are explained, not calculated', () => {
  const input: LoanInput = { principal: 500000, annualRatePercent: 8.5, months: 240 };
  assert.match(expectFail(interestSaved({ ...input, extraMonthlyPayment: 500000 })), /first month/);
  assert.match(expectFail(interestSaved({ ...input, extraMonthlyPayment: 0 })), /at least 0\.01/);
  assert.match(expectFail(interestSaved({ ...input, extraMonthlyPayment: 0.004 })), /at least 0\.01/);
  assert.match(expectFail(interestSaved({ ...input, extraMonthlyPayment: -50 })), /cannot be less than zero/);
  assert.match(expectFail(interestSaved({ ...input, extraMonthlyPayment: Number.NaN })), /^Enter/);
  assert.match(
    expectFail(interestSaved({ principal: 500, annualRatePercent: 8.5, months: 1, extraMonthlyPayment: 10 })),
    /single payment/,
  );
});

/** Each of these is something a URL or a half-filled form will hand the engine. */
const BAD_INPUTS: Array<[string, LoanInput]> = [
  ['no principal', { principal: 0, annualRatePercent: 8.5, months: 240 }],
  ['negative principal', { principal: -1000, annualRatePercent: 8.5, months: 240 }],
  ['sub-cent principal', { principal: 0.004, annualRatePercent: 8.5, months: 240 }],
  ['absurd principal', { principal: 1e15, annualRatePercent: 8.5, months: 240 }],
  ['no term', { principal: 500000, annualRatePercent: 8.5, months: 0 }],
  ['negative term', { principal: 500000, annualRatePercent: 8.5, months: -12 }],
  ['term past the cap', { principal: 500000, annualRatePercent: 8.5, months: 601 }],
  ['fractional term', { principal: 500000, annualRatePercent: 8.5, months: 12.5 }],
  ['negative rate', { principal: 500000, annualRatePercent: -1, months: 240 }],
  ['rate above 100%', { principal: 500000, annualRatePercent: 100.01, months: 240 }],
  ['principal is NaN', { principal: Number.NaN, annualRatePercent: 8.5, months: 240 }],
  ['rate is NaN', { principal: 500000, annualRatePercent: Number.NaN, months: 240 }],
  ['term is NaN', { principal: 500000, annualRatePercent: 8.5, months: Number.NaN }],
  ['principal is Infinity', { principal: Number.POSITIVE_INFINITY, annualRatePercent: 8.5, months: 240 }],
  ['rate is Infinity', { principal: 500000, annualRatePercent: Number.POSITIVE_INFINITY, months: 240 }],
];

test('invalid input returns a sentence a person can act on, and never throws', () => {
  for (const [why, input] of BAD_INPUTS) {
    const messages = [
      expectFail(calculateEmi(input)),
      expectFail(amortisationSchedule(input)),
      expectFail(amortisationSchedule(input, { extraMonthlyPayment: 100 })),
      expectFail(interestSaved({ ...input, extraMonthlyPayment: 100 })),
    ];
    for (const message of messages) {
      assert.match(message, /^[A-Z]/, `${why}: "${message}" should open like a sentence`);
      assert.match(message, /\.$/, `${why}: "${message}" should end in a full stop`);
      assert.ok(!/NaN|Infinity|undefined|null/.test(message), `${why} leaked internals: ${message}`);
    }
  }
});

test('a bad extra payment is rejected without touching the loan', () => {
  const input: LoanInput = { principal: 500000, annualRatePercent: 8.5, months: 240 };
  assert.match(expectFail(amortisationSchedule(input, { extraMonthlyPayment: -1 })), /less than zero/);
  assert.match(expectFail(amortisationSchedule(input, { extraMonthlyPayment: Number.NaN })), /^Enter/);
  assert.match(expectFail(amortisationSchedule(input, { extraMonthlyPayment: 1e15 })), /too large/);
  // An omitted or sub-cent extra is not an error, it simply changes nothing.
  const plain = expectOk(amortisationSchedule(input));
  const nudged = expectOk(amortisationSchedule(input, { extraMonthlyPayment: 0.004 }));
  assert.equal(nudged.actualMonths, plain.actualMonths);
  assert.equal(nudged.totalInterest, plain.totalInterest);
});

test('yearlySummary: a 30-month loan falls into 12 + 12 + 6', () => {
  const input: LoanInput = { principal: 30000, annualRatePercent: 9, months: 30 };
  const run = expectOk(amortisationSchedule(input));
  const years = yearlySummary(run.rows);
  const groups = [run.rows.slice(0, 12), run.rows.slice(12, 24), run.rows.slice(24, 30)];

  assert.deepEqual(groups.map((group) => group.length), [12, 12, 6]);
  assert.equal(years.length, 3);
  assert.deepEqual(years.map((year) => year.year), [1, 2, 3]);

  groups.forEach((group, index) => {
    const bucket = years[index];
    assert.ok(bucket, `year ${index + 1} is missing`);
    assert.equal(bucket.interest, sum(group.map((row) => row.interest)), `year ${bucket.year} interest`);
    assert.equal(bucket.principal, sum(group.map((row) => row.principal)), `year ${bucket.year} principal`);
    assert.equal(bucket.closingBalance, lastRow(group).closingBalance, `year ${bucket.year} balance`);
  });

  assert.equal(sum(years.map((year) => year.principal)), input.principal);
  assert.equal(sum(years.map((year) => year.interest)), run.totalInterest);
  assert.equal(years[years.length - 1]?.closingBalance, 0);
});

test('yearlySummary: exact multiples of twelve, one short month and no rows at all', () => {
  const full = expectOk(amortisationSchedule({ principal: 24000, annualRatePercent: 6, months: 24 }));
  assert.deepEqual(yearlySummary(full.rows).map((year) => year.year), [1, 2]);

  const short = expectOk(amortisationSchedule({ principal: 24000, annualRatePercent: 6, months: 13 }));
  assert.deepEqual(yearlySummary(short.rows).map((year) => year.year), [1, 2]);
  assert.equal(yearlySummary(short.rows)[1]?.principal, short.rows[12]?.principal);

  assert.deepEqual(yearlySummary([]), []);
});

test('yearlySummary: grouping does not depend on the caller ordering the rows', () => {
  const run = expectOk(amortisationSchedule({ principal: 30000, annualRatePercent: 9, months: 30 }));
  const shuffled = run.rows.slice().reverse();
  assert.deepEqual(yearlySummary(shuffled), yearlySummary(run.rows));
});

test('the shown working reproduces the instalment to within a cent', () => {
  const result = expectOk(calculateEmi({ principal: 500000, annualRatePercent: 8.5, months: 240 }));
  const rate = result.steps.find((step) => step.label.startsWith('Monthly rate'));
  const growth = result.steps.find((step) => step.label.startsWith('Growth over the term'));
  assert.ok(rate && growth, 'the rate and the growth factor are both part of the working');
  assert.equal(rate.value, '0.00708333');

  // Multiply the shown figures back out the way a sceptical reader would. A cent
  // of slack is the honest tolerance: the working shows rounded intermediates, so
  // a true instalment sitting on the half-cent boundary — as this one does, at
  // 4339.1162 — can round the other way when recomputed from them.
  const r = Number(rate.value);
  const g = Number(growth.value.replace(/,/g, ''));
  const recomputed = roundMoney((500000 * r * g) / (g - 1));
  assert.ok(
    centsApart(recomputed, result.emi) <= 1,
    `working gives ${recomputed}, engine gives ${result.emi}`,
  );
});

/**
 * The blunt-instrument guard against the bug this engine exists to avoid: a
 * schedule that ends on 0.01, or columns that do not add up to what the summary
 * claims. Small, huge, awkward and zero rates, every term length, with and without
 * overpayments.
 *
 * The range deliberately reaches down to loans so small that the instalment would
 * round to nothing. Those are turned away with a sentence, which counts as passing
 * — what must never happen is a schedule that comes back wrong.
 */
test('fuzz: 2,000 loans either close out on exactly zero or say why not', () => {
  const random = mulberry32(0x5eed);
  let scheduled = 0;
  let declined = 0;

  for (let index = 0; index < 2000; index += 1) {
    const principal = roundMoney(0.01 + random() ** 3 * 4000000);
    const annualRatePercent = index % 11 === 0 ? 0 : roundTo(random() * 100, 3);
    const months = 1 + Math.floor(random() * 600);
    const extraMonthlyPayment = index % 3 === 0 ? roundMoney(random() ** 2 * 5000) : 0;
    const where = `${principal} at ${annualRatePercent}% over ${months} months, +${extraMonthlyPayment}`;

    const result = amortisationSchedule({ principal, annualRatePercent, months }, { extraMonthlyPayment });
    if (!result.ok) {
      assert.match(result.error, /less than a cent a month/, where);
      declined += 1;
      continue;
    }

    assert.equal(lastRow(result.rows).closingBalance, 0, where);
    assert.equal(sum(result.rows.map((row) => row.principal)), principal, where);
    assert.equal(sum(result.rows.map((row) => row.interest)), result.totalInterest, where);
    assert.equal(sum(result.rows.map((row) => row.payment)), result.totalPayment, where);
    assert.ok(result.actualMonths <= months && result.actualMonths === result.rows.length, where);
    assert.ok(
      result.rows.every((row) => roundMoney(row.openingBalance - row.principal) === row.closingBalance),
      where,
    );
    scheduled += 1;
  }

  assert.ok(scheduled > 1900, `only ${scheduled} loans produced a schedule`);
  assert.ok(declined < 100, `${declined} loans were turned away, which is more than expected`);
});

test('a 600-month loan at the cap still balances to the cent', () => {
  const input: LoanInput = { principal: 750000, annualRatePercent: 4.99, months: 600 };
  const run = expectOk(amortisationSchedule(input));
  const summary = expectOk(calculateEmi(input));
  assert.equal(run.rows.length, 600);
  assert.equal(lastRow(run.rows).closingBalance, 0);
  assert.equal(sum(run.rows.map((row) => row.principal)), input.principal);
  assert.equal(summary.totalPayment, run.totalPayment);
  assert.equal(summary.totalInterest, run.totalInterest);
  assert.ok(summary.interestPercentOfTotal > 0 && summary.interestPercentOfTotal < 100);
});

