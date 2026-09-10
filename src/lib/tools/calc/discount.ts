/**
 * The shop-front arithmetic: a discount and the tax around it, a stack of
 * offers, a tip split between friends, and the margin/markup pair that retailers
 * mix up.
 *
 * Two rules run through the whole file.
 *
 * Money is rounded to the cent once per reported figure, and every later figure
 * is built from the rounded ones. A receipt whose lines do not add up to its own
 * total is worse than useless, so subtotal − discount + tax is *exactly* the
 * total here, at the cost of the occasional theoretical cent.
 *
 * Percentages are never added together. Two 20% discounts are not 40% off, they
 * are 36% off, because the second is taken from what the first left.
 * `stackedDiscounts` reports `effectivePercent` beside `naiveSumPercent` for
 * exactly that reason: the gap between them is the whole point.
 */

import {
  display,
  displayMoney,
  displayPercent,
  fail,
  isRealNumber,
  roundMoney,
  roundTo,
} from './round.ts';
import type { Explained, Failure, Step } from './round.ts';

/** No real basket reaches this, and it keeps every product inside float range. */
const MAX_MONEY = 1e11;
const MAX_QUANTITY = 1e6;
const MAX_PEOPLE = 1000;
/** More stacked offers than this is a spreadsheet, not a checkout. */
const MAX_STACK = 10;

/** Shown only if the arithmetic itself fails; every reachable path is guarded first. */
const UNWORKABLE = 'These numbers do not produce a price we can work out. Please check them and try again.';

/**
 * First failing field wins, so the reader gets one actionable sentence rather
 * than a list of everything wrong at once.
 */
function validateMoney(value: number, what: string): Failure | null {
  if (!isRealNumber(value)) return fail(`Enter the ${what}.`);
  if (value <= 0) return fail(`The ${what} must be more than zero.`);
  if (value > MAX_MONEY) {
    return fail(`That ${what} is too large for this calculator. Try 100 billion or less.`);
  }
  return null;
}

/**
 * A percentage that cannot sensibly exceed 100: no discount takes more than the
 * whole price, and no sales tax doubles a bill. `undefined` means "not supplied"
 * and takes the caller's default.
 */
function validatePercent(value: number | undefined, what: string, fallback: number): number | Failure {
  if (value === undefined) return fallback;
  if (!isRealNumber(value)) return fail(`Enter the ${what} as a percentage.`);
  if (value < 0) return fail(`The ${what} cannot be less than zero.`);
  if (value > 100) return fail(`The ${what} cannot be more than 100%.`);
  return value;
}

function isFailure(value: number | Failure): value is Failure {
  return typeof value !== 'number';
}

function validateCount(
  value: number | undefined,
  fallback: number,
  max: number,
  messages: { missing: string; whole: string; tooFew: string; tooMany: string },
): number | Failure {
  if (value === undefined) return fallback;
  if (!isRealNumber(value)) return fail(messages.missing);
  if (!Number.isInteger(value)) return fail(messages.whole);
  if (value < 1) return fail(messages.tooFew);
  if (value > max) return fail(messages.tooMany);
  return value;
}

/** Percentage of an amount, at full precision. Rounding happens once, at the caller. */
function percentOf(amount: number, percent: number): number {
  return (amount * percent) / 100;
}

/**
 * Where the tax is worked out.
 *
 * 'after' — the usual case — taxes the discounted price, so a coupon saves the
 * tax on what it takes off as well.
 * 'before' taxes the full price and then deducts the discount from the
 * tax-inclusive figure. That is not a rounding curiosity: several US states
 * charge sales tax on the pre-coupon price of a manufacturer's coupon, because
 * the shop is reimbursed for it. The two produce different totals, and a
 * calculator that offers only one of them is guessing on the reader's behalf.
 */
const TAX_BASES = ['before', 'after'] as const;
export type TaxBase = (typeof TAX_BASES)[number];

export interface DiscountInput {
  /** Price of one item, before any discount. */
  price: number;
  discountPercent: number;
  /** Default 0. */
  taxPercent?: number;
  /** Default 'after': tax on the discounted price. */
  taxOn?: TaxBase;
  /** Whole items. Default 1. */
  quantity?: number;
}

export interface DiscountSuccess {
  /** price × quantity, before anything is taken off. */
  subtotal: number;
  discountAmount: number;
  afterDiscount: number;
  taxAmount: number;
  /** What is actually handed over. Always afterDiscount + taxAmount, to the cent. */
  total: number;
  /**
   * The full-price bill minus this one. With tax on the discounted price it is
   * larger than `discountAmount`, because the tax on the money saved is saved
   * too — which is the honest answer to "how much did I save?".
   */
  savedTotal: number;
  /** savedTotal as a percentage of the full-price bill, not of the price. */
  effectiveDiscountPercent: number;
}

export type DiscountResult = { ok: true; result: DiscountSuccess & Explained } | Failure;

interface DiscountFigures extends DiscountSuccess {
  quantity: number;
  taxPercent: number;
  taxOn: TaxBase;
  /** What the same basket costs with no discount at all, tax included. */
  fullTotal: number;
}

/** The working, in the order a receipt prints it. */
function discountSteps(input: DiscountInput, figures: DiscountFigures): Step[] {
  const { quantity, taxPercent, taxOn } = figures;
  const steps: Step[] = [];
  if (quantity > 1) {
    steps.push({
      label: `${displayMoney(input.price)} × ${display(quantity)}`,
      value: displayMoney(figures.subtotal),
    });
  } else {
    steps.push({ label: 'Price', value: displayMoney(figures.subtotal) });
  }
  steps.push({
    label: `Discount (${displayPercent(input.discountPercent)} of ${displayMoney(figures.subtotal)})`,
    value: `− ${displayMoney(figures.discountAmount)}`,
  });
  steps.push({ label: 'Price after the discount', value: displayMoney(figures.afterDiscount) });
  if (taxPercent > 0) {
    const base = taxOn === 'before' ? figures.subtotal : figures.afterDiscount;
    steps.push({
      label: `Tax (${displayPercent(taxPercent)} of ${displayMoney(base)}, the price ${taxOn} the discount)`,
      value: `+ ${displayMoney(figures.taxAmount)}`,
    });
  }
  steps.push({ label: 'Total to pay', value: displayMoney(figures.total) });
  steps.push({ label: 'The same basket at full price', value: displayMoney(figures.fullTotal) });
  steps.push({
    label: 'You save',
    value: `${displayMoney(figures.savedTotal)} (${displayPercent(figures.effectiveDiscountPercent)} of the full-price bill)`,
  });
  return steps;
}

function discountFormula(figures: DiscountFigures, discountPercent: number): string {
  const subtotal = displayMoney(figures.subtotal);
  const total = displayMoney(figures.total);
  const off = displayPercent(discountPercent);
  if (figures.taxPercent === 0) return `${subtotal} − ${off} = ${total}`;
  const tax = displayPercent(figures.taxPercent);
  return figures.taxOn === 'after'
    ? `(${subtotal} − ${off}) + ${tax} tax = ${total}`
    : `(${subtotal} + ${tax} tax) − ${off} of ${subtotal} = ${total}`;
}

/**
 * A discount, optionally on a quantity, optionally with tax on either side of it.
 *
 * `savedTotal` compares this bill with the same basket at full price, so it
 * includes tax no longer paid when the tax follows the discount; and
 * `effectiveDiscountPercent` is that saving as a share of the full-price bill,
 * which is what falls short of the headline percentage when the tax is charged
 * on the pre-coupon price, or when rounding to the cent eats a discount on a
 * very cheap item.
 */
export function applyDiscount(input: DiscountInput): DiscountResult {
  const badPrice = validateMoney(input.price, 'price');
  if (badPrice) return badPrice;

  const discountPercent = validatePercent(
    input.discountPercent === undefined ? Number.NaN : input.discountPercent,
    'discount',
    0,
  );
  if (isFailure(discountPercent)) return discountPercent;
  const taxPercent = validatePercent(input.taxPercent, 'tax rate', 0);
  if (isFailure(taxPercent)) return taxPercent;
  const quantity = validateCount(input.quantity, 1, MAX_QUANTITY, {
    missing: 'Enter how many you are buying.',
    whole: 'The quantity must be a whole number of items.',
    tooFew: 'You need to be buying at least one item.',
    tooMany: `This calculator handles up to ${display(MAX_QUANTITY)} items at a time.`,
  });
  if (isFailure(quantity)) return quantity;

  const taxOn: TaxBase = input.taxOn === undefined ? 'after' : input.taxOn;
  if (!TAX_BASES.includes(taxOn)) {
    return fail('Choose whether the tax is worked out on the price before or after the discount.');
  }

  // Keeping the basket inside MAX_MONEY keeps every figure below it an exact
  // number of cents, which is what makes the lines reconcile rather than nearly.
  const subtotal = roundMoney(input.price * quantity);
  if (!isRealNumber(subtotal) || subtotal > MAX_MONEY) {
    return fail('That basket is too large for this calculator. Try 100 billion or less.');
  }

  const discountAmount = roundMoney(percentOf(subtotal, discountPercent));
  const afterDiscount = roundMoney(subtotal - discountAmount);
  const taxBase = taxOn === 'before' ? subtotal : afterDiscount;
  const taxAmount = roundMoney(percentOf(taxBase, taxPercent));
  const total = roundMoney(afterDiscount + taxAmount);
  const fullTotal = roundMoney(subtotal + roundMoney(percentOf(subtotal, taxPercent)));
  const savedTotal = roundMoney(fullTotal - total);
  const effectiveDiscountPercent = fullTotal > 0 ? roundTo((savedTotal / fullTotal) * 100, 2) : 0;

  const figures: DiscountFigures = {
    subtotal,
    discountAmount,
    afterDiscount,
    taxAmount,
    total,
    savedTotal,
    effectiveDiscountPercent,
    quantity,
    taxPercent,
    taxOn,
    fullTotal,
  };
  const everyFigure = [
    subtotal,
    discountAmount,
    afterDiscount,
    taxAmount,
    total,
    fullTotal,
    savedTotal,
    effectiveDiscountPercent,
  ];
  if (everyFigure.some((figure) => !isRealNumber(figure))) return fail(UNWORKABLE);

  return {
    ok: true,
    result: {
      subtotal,
      discountAmount,
      afterDiscount,
      taxAmount,
      total,
      savedTotal,
      effectiveDiscountPercent,
      formula: discountFormula(figures, discountPercent),
      steps: discountSteps(input, figures),
    },
  };
}

export interface FromPricesInput {
  original: number;
  sale: number;
}

export interface FromPricesSuccess {
  /** Two decimals: 33.33% off, not 33.333333333333336% off. */
  discountPercent: number;
  savedAmount: number;
}

export type FromPricesResult = { ok: true; result: FromPricesSuccess & Explained } | Failure;

/**
 * The percentage behind a "was £80, now £60" ticket.
 *
 * The percentage is derived from the *rounded* saving, so the two figures on the
 * page always describe the same sum of money.
 */
export function discountFromPrices(input: FromPricesInput): FromPricesResult {
  const badOriginal = validateMoney(input.original, 'original price');
  if (badOriginal) return badOriginal;
  if (!isRealNumber(input.sale)) return fail('Enter the sale price.');
  if (input.sale < 0) return fail('The sale price cannot be less than zero.');
  if (input.sale > MAX_MONEY) {
    return fail('That sale price is too large for this calculator. Try 100 billion or less.');
  }
  if (input.sale > input.original) {
    return fail(
      'The sale price is higher than the original price, so this is not a discount. Check the two figures.',
    );
  }

  const original = roundMoney(input.original);
  const sale = roundMoney(input.sale);
  const savedAmount = roundMoney(original - sale);
  const discountPercent = roundTo((savedAmount / original) * 100, 2);
  if (!isRealNumber(savedAmount) || !isRealNumber(discountPercent)) return fail(UNWORKABLE);

  return {
    ok: true,
    result: {
      discountPercent,
      savedAmount,
      formula: `(${displayMoney(original)} − ${displayMoney(sale)}) ÷ ${displayMoney(original)} × 100 = ${displayPercent(discountPercent)}`,
      steps: [
        { label: 'Original price', value: displayMoney(original) },
        { label: 'Sale price', value: displayMoney(sale) },
        { label: 'You save', value: displayMoney(savedAmount) },
        { label: 'Which is a discount of', value: displayPercent(discountPercent) },
      ],
    },
  };
}

export interface OriginalFromSaleInput {
  sale: number;
  discountPercent: number;
}

export type OriginalFromSaleResult = { ok: true; result: { original: number } & Explained } | Failure;

/**
 * The ticket price before the sticker: sale ÷ (1 − discount).
 *
 * A 100% discount is turned away rather than answered. Everything is free at
 * 100% off, so no sale price above zero can have come from one, and the division
 * would be by zero.
 */
export function originalFromSale(input: OriginalFromSaleInput): OriginalFromSaleResult {
  const badSale = validateMoney(input.sale, 'sale price');
  if (badSale) return badSale;
  const discountPercent = validatePercent(
    input.discountPercent === undefined ? Number.NaN : input.discountPercent,
    'discount',
    0,
  );
  if (isFailure(discountPercent)) return discountPercent;
  if (discountPercent >= 100) {
    return fail('At 100% off the item is free, so there is no original price to work back to.');
  }

  const remaining = 1 - discountPercent / 100;
  const original = roundMoney(input.sale / remaining);
  if (!isRealNumber(original) || original > MAX_MONEY) {
    return fail('That sale price and discount do not work back to a price we can show.');
  }
  const saved = roundMoney(original - roundMoney(input.sale));

  return {
    ok: true,
    result: {
      original,
      formula: `${displayMoney(input.sale)} ÷ (1 − ${displayPercent(discountPercent)}) = ${displayMoney(original)}`,
      steps: [
        { label: 'Sale price', value: displayMoney(input.sale) },
        { label: 'Discount taken off', value: displayPercent(discountPercent) },
        {
          label: `Which left ${displayPercent(roundTo(remaining * 100, 2))} of the original price`,
          value: displayMoney(input.sale),
        },
        { label: 'Original price', value: displayMoney(original) },
        { label: 'Saving at that price', value: displayMoney(saved) },
      ],
    },
  };
}

export interface StackedInput {
  price: number;
  /** Applied in the order given. "20% off, then 10% off the reduced price." */
  percents: number[];
}

/**
 * One discount in the stack, carrying both the numbers a table wants and the
 * label and value the shown working wants. It is the same fact told twice, so
 * `steps` here and `Explained.steps` are deliberately the same array rather than
 * two lists that could drift apart.
 */
export interface StackedStep extends Step {
  percent: number;
  from: number;
  amount: number;
  to: number;
}

export interface StackedSuccess {
  total: number;
  steps: StackedStep[];
  /** What the stack actually took off, as a percentage of the original price. */
  effectivePercent: number;
  /** The percentages simply added up: the wrong answer, reported so it can be shown to be wrong. */
  naiveSumPercent: number;
}

export type StackedResult = { ok: true; result: StackedSuccess & Explained } | Failure;

/**
 * Discounts applied one after another, each to what the last one left.
 *
 * This is the calculator people most often do wrongly in their heads. Two 20%
 * discounts take 36% off, not 40%: the second 20% is charged on 80% of the price,
 * so it is worth 16 points rather than 20. `naiveSumPercent` is the sum they
 * expected and `effectivePercent` is what they got, side by side.
 */
export function stackedDiscounts(input: StackedInput): StackedResult {
  const badPrice = validateMoney(input.price, 'price');
  if (badPrice) return badPrice;
  if (!Array.isArray(input.percents) || input.percents.length === 0) {
    return fail('Add at least one discount to stack.');
  }
  if (input.percents.length > MAX_STACK) {
    return fail(`This calculator stacks up to ${display(MAX_STACK)} discounts at a time.`);
  }
  for (const percent of input.percents) {
    const checked = validatePercent(percent, 'discount', 0);
    if (isFailure(checked)) return checked;
  }

  const price = roundMoney(input.price);
  const steps: StackedStep[] = [];
  let running = price;
  let naive = 0;

  for (const percent of input.percents) {
    const amount = roundMoney(percentOf(running, percent));
    const to = roundMoney(running - amount);
    naive += percent;
    steps.push({
      percent,
      from: running,
      amount,
      to,
      label: `${displayPercent(percent)} off ${displayMoney(running)}`,
      value: `− ${displayMoney(amount)} → ${displayMoney(to)}`,
    });
    running = to;
  }

  const total = running;
  const effectivePercent = roundTo(((price - total) / price) * 100, 2);
  const naiveSumPercent = roundTo(naive, 2);
  if (!isRealNumber(total) || !isRealNumber(effectivePercent) || !isRealNumber(naiveSumPercent)) {
    return fail(UNWORKABLE);
  }

  const chain = input.percents.map((percent) => `− ${displayPercent(percent)}`).join(' ');
  const comparison =
    effectivePercent === naiveSumPercent
      ? ''
      : `, which is ${displayPercent(effectivePercent)} off rather than the ${displayPercent(naiveSumPercent)} the percentages add up to`;

  return {
    ok: true,
    result: {
      total,
      steps,
      effectivePercent,
      naiveSumPercent,
      formula: `${displayMoney(price)} ${chain} = ${displayMoney(total)}${comparison}`,
    },
  };
}

export interface TipInput {
  bill: number;
  tipPercent: number;
  /** Default 1. */
  people?: number;
  /**
   * Round each person's share up to the next whole unit of currency, the way a
   * table actually settles up. The rounding goes into the tip, and the total is
   * adjusted with it so that perPerson × people is exactly the total.
   */
  roundUp?: boolean;
}

export interface TipSuccess {
  /** The tip actually paid. Larger than the percentage asks when `roundUp` is set. */
  tip: number;
  total: number;
  perPerson: number;
  tipPerPerson: number;
}

export type TipResult = { ok: true; result: TipSuccess & Explained } | Failure;

/**
 * A tip, and the bill split between however many people are at the table.
 *
 * Without `roundUp` the shares are the honest division rounded to the cent, and
 * a step says plainly when they do not add up to the total — one person covers
 * the odd cent, and pretending otherwise would hide it. With `roundUp` every
 * share is a whole unit and the total is rebuilt from the shares, so the
 * arithmetic closes exactly.
 */
export function tipSplit(input: TipInput): TipResult {
  const badBill = validateMoney(input.bill, 'bill');
  if (badBill) return badBill;
  const tipPercent = validatePercent(
    input.tipPercent === undefined ? Number.NaN : input.tipPercent,
    'tip',
    0,
  );
  if (isFailure(tipPercent)) return tipPercent;
  const people = validateCount(input.people, 1, MAX_PEOPLE, {
    missing: 'Enter how many people are splitting the bill.',
    whole: 'The number of people must be a whole number.',
    tooFew: 'At least one person has to pay the bill.',
    tooMany: `This calculator splits a bill between up to ${display(MAX_PEOPLE)} people.`,
  });
  if (isFailure(people)) return people;

  const bill = roundMoney(input.bill);
  const askedTip = roundMoney(percentOf(bill, tipPercent));
  const askedTotal = roundMoney(bill + askedTip);
  const evenShare = roundMoney(askedTotal / people);

  const roundUp = input.roundUp === true;
  const perPerson = roundUp ? Math.ceil(askedTotal / people) : evenShare;
  // With whole units per person the product is exact, so the total is rebuilt
  // from the shares rather than the shares from the total.
  const total = roundUp ? roundMoney(perPerson * people) : askedTotal;
  const tip = roundMoney(total - bill);
  const tipPerPerson = roundMoney(tip / people);

  const figures = [askedTip, askedTotal, perPerson, total, tip, tipPerPerson];
  if (figures.some((figure) => !isRealNumber(figure)) || total > MAX_MONEY) {
    return fail(UNWORKABLE);
  }

  const steps: Step[] = [
    { label: 'Bill', value: displayMoney(bill) },
    {
      label: `Tip (${displayPercent(tipPercent)} of ${displayMoney(bill)})`,
      value: `+ ${displayMoney(askedTip)}`,
    },
    { label: roundUp ? 'Total before rounding' : 'Total', value: displayMoney(askedTotal) },
  ];

  if (people > 1) {
    steps.push({ label: `Split ${display(people)} ways`, value: displayMoney(evenShare) });
  }
  if (roundUp) {
    steps.push({ label: 'Rounded up to a whole amount each', value: displayMoney(perPerson) });
    steps.push({ label: 'Total once rounded up', value: displayMoney(total) });
    steps.push({
      label: 'Tip in the end',
      value: `${displayMoney(tip)} (${displayPercent(roundTo((tip / bill) * 100, 2))} of the bill)`,
    });
  } else {
    const shortfall = roundMoney(total - roundMoney(perPerson * people));
    if (shortfall !== 0) {
      steps.push({
        label: shortfall > 0 ? 'Left for someone to cover' : 'Collected above the total',
        value: displayMoney(Math.abs(shortfall)),
      });
    }
  }
  if (people > 1) {
    steps.push({ label: 'Tip per person', value: displayMoney(tipPerPerson) });
  }

  const paid = `${displayMoney(bill)} + ${displayPercent(tipPercent)} tip`;
  const split =
    people > 1
      ? `(${paid}) ÷ ${display(people)} = ${displayMoney(evenShare)} each`
      : `${paid} = ${displayMoney(askedTotal)}`;
  const each = people > 1 ? ' each' : '';
  const formula = roundUp ? `${split}, rounded up to ${displayMoney(perPerson)}${each}` : split;

  return { ok: true, result: { tip, total, perPerson, tipPerPerson, formula, steps } };
}

/**
 * Margin and markup are the same profit expressed against different things, and
 * mixing them up is how a shop prices itself out of business. On a £100 item
 * bought for £60: the £40 profit is a 40% margin (of the price it sells for) and
 * a 66.67% markup (of the price it cost).
 *
 * Both directions are rounded to ten decimal places — far finer than any price
 * list, and enough that the two functions invert each other rather than merely
 * agree to a couple of digits.
 */
const PERCENT_DECIMALS = 10;

export function marginToMarkup(margin: number): { ok: true; markup: number } | Failure {
  if (!isRealNumber(margin)) return fail('Enter the margin as a percentage.');
  if (margin > 100) {
    return fail('A margin cannot be more than 100%. That would mean selling for less than nothing.');
  }
  if (margin === 100) {
    return fail('A margin of 100% would mean the goods cost nothing, so there is no markup to work out.');
  }
  const markup = roundTo((margin / (100 - margin)) * 100, PERCENT_DECIMALS);
  if (!isRealNumber(markup)) return fail('That margin does not work out to a markup we can show.');
  return { ok: true, markup };
}

/**
 * A markup of −100% or less means giving the goods away or paying to do so,
 * which has no margin to report.
 */
export function markupToMargin(markup: number): { ok: true; margin: number } | Failure {
  if (!isRealNumber(markup)) return fail('Enter the markup as a percentage.');
  if (markup <= -100) {
    return fail('A markup of −100% or less means the goods are given away, so there is no margin.');
  }
  const margin = roundTo((markup / (100 + markup)) * 100, PERCENT_DECIMALS);
  if (!isRealNumber(margin)) return fail('That markup does not work out to a margin we can show.');
  return { ok: true, margin };
}
