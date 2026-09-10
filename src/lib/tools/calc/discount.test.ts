import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDiscount,
  discountFromPrices,
  marginToMarkup,
  markupToMargin,
  originalFromSale,
  stackedDiscounts,
  tipSplit,
} from './discount.ts';
import type { DiscountInput, TaxBase } from './discount.ts';
import { roundMoney, roundTo } from './round.ts';
import type { Explained, Failure } from './round.ts';

function expectOk<T>(outcome: ({ ok: true } & T) | Failure): { ok: true } & T {
  if (!outcome.ok) assert.fail(`expected success, got error: ${outcome.error}`);
  return outcome;
}

function expectFail(outcome: { ok: true } | Failure): string {
  if (outcome.ok) assert.fail('expected a friendly error, got a result');
  return outcome.error;
}

/** The `result` of a successful outcome, which is where every engine puts its answer. */
function resultOf<T>(outcome: { ok: true; result: T } | Failure): T {
  return expectOk(outcome).result;
}

/** Every engine owes the page a formula and at least one step, free of NaN. */
function assertExplained(value: Explained): void {
  assert.ok(value.formula.length > 0, 'formula must not be empty');
  assert.ok(value.steps.length > 0, 'at least one step of working is required');
  assert.ok(!/NaN|Infinity|undefined/.test(value.formula), `formula leaked: ${value.formula}`);
  for (const step of value.steps) {
    assert.ok(step.label.length > 0 && step.value.length > 0, 'steps must be fully populated');
    assert.ok(!/NaN|Infinity|undefined/.test(`${step.label} ${step.value}`), `step leaked: ${step.label}`);
  }
}

/** The headline case, and the one a reader checks in their head. */
test('applyDiscount: 20% off 100 is 80, and the lines add up', () => {
  const result = resultOf(applyDiscount({ price: 100, discountPercent: 20 }));
  assert.equal(result.subtotal, 100);
  assert.equal(result.discountAmount, 20);
  assert.equal(result.afterDiscount, 80);
  assert.equal(result.taxAmount, 0);
  assert.equal(result.total, 80);
  assert.equal(result.savedTotal, 20);
  assert.equal(result.effectiveDiscountPercent, 20);
  assertExplained(result);
  assert.equal(result.formula, '100.00 − 20% = 80.00');
});

const BASKETS: ReadonlyArray<DiscountInput> = [
  { price: 100, discountPercent: 20 },
  { price: 100, discountPercent: 20, taxPercent: 10 },
  { price: 100, discountPercent: 20, taxPercent: 10, taxOn: 'before' },
  { price: 19.99, discountPercent: 15, taxPercent: 8.25, quantity: 3 },
  { price: 1234.56, discountPercent: 33.33, taxPercent: 20 },
  { price: 9.99, discountPercent: 100, taxPercent: 20 },
  { price: 50, discountPercent: 0, taxPercent: 0 },
  { price: 7.77, discountPercent: 7, taxPercent: 7, taxOn: 'before', quantity: 13 },
  { price: 0.03, discountPercent: 10 },
  { price: 0.01, discountPercent: 50, taxPercent: 20 },
  { price: 1e11, discountPercent: 50, taxPercent: 100 },
  { price: 3.5, discountPercent: 99.99, taxPercent: 0.01, quantity: 1000000 },
];

/**
 * A receipt whose lines do not add up to its own total is worse than useless.
 * This is the test that keeps the rounding honest at every reported figure
 * rather than only at the end.
 */
test('every basket reconciles exactly, line by line', () => {
  for (const basket of BASKETS) {
    const result = resultOf(applyDiscount(basket));
    const where = JSON.stringify(basket);
    assert.equal(roundMoney(result.subtotal - result.discountAmount), result.afterDiscount, where);
    assert.equal(roundMoney(result.afterDiscount + result.taxAmount), result.total, where);

    // savedTotal is measured against the same basket at full price, so putting it
    // back must land exactly on that bill.
    const full = resultOf(applyDiscount({ ...basket, discountPercent: 0 }));
    assert.equal(roundMoney(result.total + result.savedTotal), full.total, where);
    assert.equal(
      result.effectiveDiscountPercent,
      roundTo((result.savedTotal / full.total) * 100, 2),
      where,
    );
    assertExplained(result);
  }
});

/**
 * The wrinkle a shop-front calculator usually gets silently wrong. Both answers
 * are right in the right jurisdiction, so the label matters as much as the sum.
 */
test('tax before the discount costs more than tax after it, and each says which it did', () => {
  const after = resultOf(applyDiscount({ price: 100, discountPercent: 20, taxPercent: 10 }));
  const before = resultOf(
    applyDiscount({ price: 100, discountPercent: 20, taxPercent: 10, taxOn: 'before' }),
  );

  assert.equal(after.taxAmount, 8, 'tax on the discounted 80.00');
  assert.equal(after.total, 88);
  assert.equal(after.savedTotal, 22, 'the tax on the money saved is saved too');
  assert.equal(after.effectiveDiscountPercent, 20);

  assert.equal(before.taxAmount, 10, 'tax on the full 100.00');
  assert.equal(before.total, 90);
  assert.equal(before.savedTotal, 20, 'the tax is unchanged, so only the discount is saved');
  assert.equal(before.effectiveDiscountPercent, 18.18, 'less than the 20% on the ticket');
  assert.ok(before.total > after.total, 'taxing the pre-coupon price costs the buyer more');

  const labels = (steps: Explained['steps']): string => steps.map((step) => step.label).join(' | ');
  assert.match(labels(after.steps), /the price after the discount/);
  assert.match(labels(before.steps), /the price before the discount/);
  assert.match(after.formula, /\+ 10% tax/);
  // 'after' is the default, because it is the common case.
  const explicit = resultOf(
    applyDiscount({ price: 100, discountPercent: 20, taxPercent: 10, taxOn: 'after' }),
  );
  assert.deepEqual(explicit, after);
});

test('quantity multiplies before the discount, not after', () => {
  const three = resultOf(applyDiscount({ price: 19.99, discountPercent: 15, quantity: 3 }));
  assert.equal(three.subtotal, 59.97);
  assert.equal(three.discountAmount, 9);
  assert.equal(three.afterDiscount, 50.97);
  assert.equal(three.total, 50.97);
  assert.match(three.steps[0]?.label ?? '', /19\.99 × 3/);
  assert.equal(resultOf(applyDiscount({ price: 19.99, discountPercent: 15, quantity: 1 })).subtotal, 19.99);
});

/** A discount too small to move the cent is reported as the nothing it is. */
test('a discount that rounds away to nothing says so rather than pretending', () => {
  const result = resultOf(applyDiscount({ price: 0.03, discountPercent: 10 }));
  assert.equal(result.discountAmount, 0);
  assert.equal(result.total, 0.03);
  assert.equal(result.savedTotal, 0);
  assert.equal(result.effectiveDiscountPercent, 0, 'not 10%: nothing was actually saved');
});

test('discountFromPrices: 100 down to 75 is 25% off', () => {
  const result = resultOf(discountFromPrices({ original: 100, sale: 75 }));
  assert.equal(result.discountPercent, 25);
  assert.equal(result.savedAmount, 25);
  assert.equal(result.formula, '(100.00 − 75.00) ÷ 100.00 × 100 = 25%');
  assertExplained(result);

  const free = resultOf(discountFromPrices({ original: 500, sale: 0 }));
  assert.equal(free.discountPercent, 100, 'a giveaway is 100% off');
  assert.equal(free.savedAmount, 500);
  assert.equal(resultOf(discountFromPrices({ original: 80, sale: 80 })).discountPercent, 0);
});

test('originalFromSale: 75 after 25% off was 100', () => {
  const result = resultOf(originalFromSale({ sale: 75, discountPercent: 25 }));
  assert.equal(result.original, 100);
  assert.equal(result.formula, '75.00 ÷ (1 − 25%) = 100.00');
  assertExplained(result);
  assert.equal(resultOf(originalFromSale({ sale: 75, discountPercent: 0 })).original, 75);
});

/**
 * The two functions are the same equation read in opposite directions, so they
 * must agree. Not to the cent, though: the percentage on a ticket is rounded to
 * two decimals, and that rounding is worth a cent or two on the way back.
 */
test('discountFromPrices and originalFromSale invert each other', () => {
  const pairs: ReadonlyArray<[number, number]> = [
    [100, 75],
    [80, 60],
    [9.99, 4.99],
    [1234.56, 999.99],
    [19.99, 19.98],
    [45, 30],
    [12.5, 9.38],
  ];
  for (const [original, sale] of pairs) {
    const found = resultOf(discountFromPrices({ original, sale }));
    const back = resultOf(originalFromSale({ sale, discountPercent: found.discountPercent }));
    assert.ok(
      Math.abs(back.original - original) <= 0.02,
      `${original} → ${sale} → ${found.discountPercent}% → ${back.original}`,
    );
    assert.equal(found.savedAmount, roundMoney(original - sale));
  }
});

/** The calculator people most often do wrongly in their heads. */
test('stackedDiscounts: two 20% discounts are 36% off, not 40%', () => {
  const result = resultOf(stackedDiscounts({ price: 200, percents: [20, 20] }));
  assert.equal(result.total, 128);
  assert.equal(result.effectivePercent, 36);
  assert.equal(result.naiveSumPercent, 40);
  assert.deepEqual(
    result.steps.map(({ percent, from, amount, to }) => ({ percent, from, amount, to })),
    [
      { percent: 20, from: 200, amount: 40, to: 160 },
      { percent: 20, from: 160, amount: 32, to: 128 },
    ],
  );
  assert.match(result.formula, /36% off rather than the 40% the percentages add up to/);
  // The rows are the shown working, so they carry a label and a value as well.
  assertExplained(result);
});

test('a stack chains: each discount starts where the last one finished', () => {
  const stacks: ReadonlyArray<[number, number[]]> = [
    [200, [20, 20]],
    [200, [20, 10]],
    [200, [10, 20]],
    [99.99, [15, 10, 5]],
    [1000, [50, 50]],
    [49.95, [33.33]],
    [19.99, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]],
    [0.05, [10, 10]],
  ];
  for (const [price, percents] of stacks) {
    const result = resultOf(stackedDiscounts({ price, percents }));
    const where = `${price} with ${percents.join('/')}`;
    assert.equal(result.steps.length, percents.length, where);
    assert.equal(result.steps[0]?.from, roundMoney(price), where);
    result.steps.forEach((step, index) => {
      assert.equal(roundMoney(step.from - step.amount), step.to, `${where}: row ${index}`);
      assert.equal(step.amount, roundMoney((step.from * step.percent) / 100), `${where}: row ${index}`);
      const next = result.steps[index + 1];
      if (next) assert.equal(next.from, step.to, `${where}: rows must chain`);
    });
    assert.equal(result.steps[result.steps.length - 1]?.to, result.total, where);
    assert.equal(result.effectivePercent, roundTo(((price - result.total) / price) * 100, 2), where);
    assert.equal(result.naiveSumPercent, roundTo(percents.reduce((sum, p) => sum + p, 0), 2), where);
    assert.ok(result.effectivePercent <= result.naiveSumPercent + 1e-9, `${where}: stacking never beats the sum`);
    assertExplained(result);
  }
});

test('one discount is its own naive sum, and the order of a stack does not matter', () => {
  const single = resultOf(stackedDiscounts({ price: 200, percents: [20] }));
  assert.equal(single.total, 160);
  assert.equal(single.effectivePercent, 20);
  assert.equal(single.naiveSumPercent, 20);
  assert.ok(!/rather than/.test(single.formula), 'nothing to contrast when there is one discount');

  // Multiplication commutes, so 20% then 10% must cost the same as 10% then 20%.
  const forwards = resultOf(stackedDiscounts({ price: 200, percents: [20, 10] }));
  const backwards = resultOf(stackedDiscounts({ price: 200, percents: [10, 20] }));
  assert.equal(forwards.total, 144);
  assert.equal(backwards.total, forwards.total);
  assert.equal(backwards.effectivePercent, forwards.effectivePercent);
  assert.notEqual(backwards.steps[0]?.to, forwards.steps[0]?.to, 'though the path differs');
});

test('tipSplit: 15% on 100 split three ways, with the odd cent admitted', () => {
  const result = resultOf(tipSplit({ bill: 100, tipPercent: 15, people: 3 }));
  assert.equal(result.tip, 15);
  assert.equal(result.total, 115);
  assert.equal(result.perPerson, 38.33);
  assert.equal(result.tipPerPerson, 5);
  assert.ok(
    result.steps.some((step) => /Left for someone to cover/.test(step.label)),
    'the cent that will not divide has to be shown, not hidden',
  );
  assertExplained(result);

  const alone = resultOf(tipSplit({ bill: 50, tipPercent: 20 }));
  assert.equal(alone.tip, 10);
  assert.equal(alone.total, 60);
  assert.equal(alone.perPerson, 60, 'one person pays the lot');
  assert.equal(alone.tipPerPerson, 10);
});

/**
 * The point of `roundUp` is that the table can settle up without anyone counting
 * coins, so the arithmetic has to close exactly: whole units each, and the total
 * rebuilt from those units.
 */
test('tipSplit roundUp: whole amounts each, and perPerson × people is exactly the total', () => {
  const tables: ReadonlyArray<[number, number, number]> = [
    [100, 15, 3],
    [87.4, 20, 5],
    [10, 0, 3],
    [33.33, 18, 7],
    [1, 25, 1],
    [249.99, 12.5, 8],
    [60, 20, 4],
    [1000, 100, 999],
  ];
  for (const [bill, tipPercent, people] of tables) {
    const result = resultOf(tipSplit({ bill, tipPercent, people, roundUp: true }));
    const where = `${bill} + ${tipPercent}% between ${people}`;
    assert.equal(result.perPerson, Math.ceil(result.perPerson), `${where}: a whole unit each`);
    assert.equal(roundTo(result.perPerson * people, 2), result.total, `${where}: shares make the total`);
    assert.equal(roundMoney(bill + result.tip), result.total, `${where}: the rounding lands in the tip`);
    assert.ok(result.tip >= roundMoney((bill * tipPercent) / 100), `${where}: rounding up never tips less`);
    assert.ok(result.total >= bill, `${where}: nobody underpays the bill`);
    assert.equal(result.tipPerPerson, roundMoney(result.tip / people), where);
    assertExplained(result);
  }
});

test('tipSplit without roundUp leaves the total alone', () => {
  for (const [bill, tipPercent, people] of [
    [100, 15, 3],
    [60, 20, 4],
    [12.34, 0, 2],
  ]) {
    const result = resultOf(tipSplit({ bill, tipPercent, people }));
    assert.equal(result.tip, roundMoney((bill * tipPercent) / 100));
    assert.equal(result.total, roundMoney(bill + result.tip));
    assert.equal(result.perPerson, roundMoney(result.total / people));
  }
  // An even split needs no apology, so no shortfall step appears.
  const even = resultOf(tipSplit({ bill: 60, tipPercent: 20, people: 4 }));
  assert.equal(even.perPerson, 18);
  assert.ok(!even.steps.some((step) => /cover|above the total/.test(step.label)));
});

type Refusal = [string, () => { ok: true } | Failure, RegExp];

const PRICE_REFUSALS: ReadonlyArray<Refusal> = [
  ['no price', () => applyDiscount({ price: Number.NaN, discountPercent: 10 }), /^Enter the price\.$/],
  ['free', () => applyDiscount({ price: 0, discountPercent: 10 }), /price must be more than zero/],
  ['negative', () => applyDiscount({ price: -5, discountPercent: 10 }), /price must be more than zero/],
  ['absurd', () => applyDiscount({ price: 1e11 + 1, discountPercent: 10 }), /too large for this calculator/],
  ['basket too large', () => applyDiscount({ price: 1e11, discountPercent: 10, quantity: 2 }), /basket is too large/],
  ['no discount', () => applyDiscount({ price: 10 } as DiscountInput), /^Enter the discount as a percentage\.$/],
  ['discount NaN', () => applyDiscount({ price: 10, discountPercent: Number.NaN }), /^Enter the discount as a percentage\.$/],
  ['discount below zero', () => applyDiscount({ price: 10, discountPercent: -1 }), /discount cannot be less than zero/],
  ['discount over 100', () => applyDiscount({ price: 10, discountPercent: 101 }), /discount cannot be more than 100%/],
  ['tax NaN', () => applyDiscount({ price: 10, discountPercent: 10, taxPercent: Number.NaN }), /^Enter the tax rate as a percentage\.$/],
  ['tax below zero', () => applyDiscount({ price: 10, discountPercent: 10, taxPercent: -1 }), /tax rate cannot be less than zero/],
  ['tax over 100', () => applyDiscount({ price: 10, discountPercent: 10, taxPercent: 101 }), /tax rate cannot be more than 100%/],
  ['tax nowhere', () => applyDiscount({ price: 10, discountPercent: 10, taxOn: 'sideways' as TaxBase }), /before or after the discount/],
  ['quantity NaN', () => applyDiscount({ price: 10, discountPercent: 10, quantity: Number.NaN }), /^Enter how many you are buying\.$/],
  ['part of an item', () => applyDiscount({ price: 10, discountPercent: 10, quantity: 1.5 }), /whole number of items/],
  ['no items', () => applyDiscount({ price: 10, discountPercent: 10, quantity: 0 }), /at least one item/],
  ['too many items', () => applyDiscount({ price: 10, discountPercent: 10, quantity: 1000001 }), /up to 1,000,000 items/],
];

const OTHER_REFUSALS: ReadonlyArray<Refusal> = [
  ['no original', () => discountFromPrices({ original: Number.NaN, sale: 5 }), /^Enter the original price\.$/],
  ['original free', () => discountFromPrices({ original: 0, sale: 5 }), /original price must be more than zero/],
  ['no sale price', () => discountFromPrices({ original: 10, sale: Number.NaN }), /^Enter the sale price\.$/],
  ['negative sale', () => discountFromPrices({ original: 10, sale: -1 }), /sale price cannot be less than zero/],
  ['sale above original', () => discountFromPrices({ original: 75, sale: 100 }), /higher than the original price/],
  ['no sale to work back', () => originalFromSale({ sale: 0, discountPercent: 25 }), /sale price must be more than zero/],
  ['everything free', () => originalFromSale({ sale: 75, discountPercent: 100 }), /At 100% off the item is free/],
  ['discount over 100 back', () => originalFromSale({ sale: 75, discountPercent: 101 }), /cannot be more than 100%/],
  ['nothing to stack', () => stackedDiscounts({ price: 100, percents: [] }), /^Add at least one discount to stack\.$/],
  ['not a list', () => stackedDiscounts({ price: 100, percents: 20 as unknown as number[] }), /^Add at least one discount to stack\.$/],
  ['too many to stack', () => stackedDiscounts({ price: 100, percents: Array.from({ length: 11 }, () => 5) }), /up to 10 discounts/],
  ['a bad one in the stack', () => stackedDiscounts({ price: 100, percents: [20, 120] }), /discount cannot be more than 100%/],
  ['no bill', () => tipSplit({ bill: 0, tipPercent: 15 }), /bill must be more than zero/],
  ['no tip figure', () => tipSplit({ bill: 50, tipPercent: Number.NaN }), /^Enter the tip as a percentage\.$/],
  ['tip over 100', () => tipSplit({ bill: 50, tipPercent: 101 }), /tip cannot be more than 100%/],
  ['nobody paying', () => tipSplit({ bill: 50, tipPercent: 15, people: 0 }), /least one person/],
  ['part of a person', () => tipSplit({ bill: 50, tipPercent: 15, people: 2.5 }), /whole number/],
  ['a coachload', () => tipSplit({ bill: 50, tipPercent: 15, people: 1001 }), /up to 1,000 people/],
  ['no margin', () => marginToMarkup(Number.NaN), /^Enter the margin as a percentage\.$/],
  ['margin of everything', () => marginToMarkup(100), /goods cost nothing/],
  ['margin over 100', () => marginToMarkup(150), /cannot be more than 100%/],
  ['no markup', () => markupToMargin(Number.NaN), /^Enter the markup as a percentage\.$/],
  ['giving it away', () => markupToMargin(-100), /given away/],
  ['paying to give it away', () => markupToMargin(-150), /given away/],
];

/**
 * Forty-one ways to hold it wrong. Each one has to name the field the reader has
 * to go back and fix, in a sentence with no machine words in it.
 */
test('every way of getting it wrong is refused in a plain sentence', () => {
  const refusals = [...PRICE_REFUSALS, ...OTHER_REFUSALS];
  for (const [name, call, pattern] of refusals) {
    const message = expectFail(call());
    assert.match(message, pattern, `${name}: refused for the wrong reason`);
    assert.match(message, /\.$/, `${name}: errors are complete sentences`);
    assert.match(message, /^[A-Z]/, `${name}: errors start like a sentence`);
    assert.ok(!/NaN|Infinity|undefined|null/.test(message), `${name}: leaks a machine word: ${message}`);
  }
  assert.ok(refusals.length >= 40, `expected every branch covered, had ${refusals.length}`);
});

/** The pair everyone conflates. A 50% margin is a 100% markup, not a 50% one. */
test('marginToMarkup and markupToMargin are the two names for one ratio', () => {
  const known: ReadonlyArray<[number, number]> = [
    [0, 0],
    [20, 25],
    [50, 100],
    [25, 33.3333333333],
    [40, 66.6666666667],
    [-100, -50],
    [-50, -33.3333333333],
    [99, 9900],
  ];
  for (const [margin, markup] of known) {
    assert.equal(expectOk(marginToMarkup(margin)).markup, markup, `margin ${margin}`);
    const back = expectOk(markupToMargin(markup)).margin;
    assert.ok(Math.abs(back - margin) <= 1e-9, `markup ${markup} should be a ${margin}% margin, got ${back}`);
  }

  // Exact in both directions wherever the ratio terminates.
  const terminating: ReadonlyArray<[number, number]> = [[0, 0], [20, 25], [50, 100], [-100, -50], [99, 9900]];
  for (const [margin, markup] of terminating) {
    assert.equal(expectOk(markupToMargin(markup)).margin, margin, `markup ${markup} exactly`);
  }

  // Where it does not, the hair is admitted rather than polished away: a markup of
  // −33.3333333333% is not quite −1/3, and the margin it works back to shows it.
  assert.equal(expectOk(markupToMargin(-33.3333333333)).margin, -49.9999999999);
});

test('margin → markup → margin returns where it started, 200 times over', () => {
  for (let index = 0; index < 200; index += 1) {
    const margin = roundTo(-99 + index * 0.995, 10);
    const markup = expectOk(marginToMarkup(margin)).markup;
    const back = expectOk(markupToMargin(markup)).margin;
    const where = `margin ${margin} → markup ${markup} → margin ${back}`;
    assert.ok(Math.abs(back - margin) <= 1e-9, where);
    assert.ok(margin < 0 ? markup > margin : markup >= margin, `${where}: markup is the larger figure`);
    assert.equal(Math.sign(markup), Math.sign(margin), `${where}: a loss stays a loss`);

    // And the other way round, from the markup the shop actually applies.
    const applied = roundTo(-99 + index * 1.5, 10);
    const asMargin = expectOk(markupToMargin(applied)).margin;
    const reapplied = expectOk(marginToMarkup(asMargin)).markup;
    assert.ok(Math.abs(reapplied - applied) <= 1e-8, `markup ${applied} → ${asMargin}% → ${reapplied}`);
  }
});
