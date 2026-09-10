import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPercentChange,
  percentChange,
  percentOf,
  percentageDifference,
  percentageOfTotal,
  reversePercentage,
  whatPercent,
} from './percentage.ts';
import type { PercentDirection } from './percentage.ts';
import type { Failure } from './round.ts';

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

/** Every engine owes the page a formula and at least one step. */
function assertExplained(value: { formula: string; steps: Array<{ label: string; value: string }> }): void {
  assert.ok(value.formula.length > 0, 'formula must not be empty');
  assert.ok(value.steps.length > 0, 'at least one step of working is required');
  for (const step of value.steps) {
    assert.ok(step.label.length > 0 && step.value.length > 0, 'steps must be fully populated');
    assert.ok(!/NaN|Infinity/.test(step.value), `step leaked a non-finite value: ${step.value}`);
  }
}
test('percentOf: what is 15% of 200?', () => {
  const result = expectOk(percentOf({ percent: 15, of: 200 }));
  assert.equal(result.value, 30);
  assert.equal(result.display, '30');
  assertExplained(result);
  assert.match(result.formula, /15% of 200/);
});

test('percentOf: negatives, zero and fractions', () => {
  assert.equal(expectOk(percentOf({ percent: 0, of: 200 })).value, 0);
  assert.equal(expectOk(percentOf({ percent: 15, of: 0 })).value, 0);
  assert.equal(expectOk(percentOf({ percent: -10, of: 50 })).value, -5);
  assert.equal(expectOk(percentOf({ percent: 12.5, of: 80 })).value, 10);
  assert.equal(expectOk(percentOf({ percent: 150, of: 40 })).value, 60);
});

test('percentOf: rejects non-numbers with a sentence, not a code', () => {
  const message = expectFail(percentOf({ percent: Number.NaN, of: 200 }));
  assert.match(message, /^Enter the percentage/);
  assert.match(message, /\.$/);
});

test('whatPercent: 12 is what percent of 60?', () => {
  const result = expectOk(whatPercent({ value: 12, of: 60 }));
  assert.equal(result.value, 20);
  assert.equal(result.display, '20%');
  assertExplained(result);
});

test('whatPercent: a zero total is an error, not Infinity', () => {
  const message = expectFail(whatPercent({ value: 12, of: 0 }));
  assert.match(message, /cannot be zero/);
  assert.equal(expectOk(whatPercent({ value: 0, of: 60 })).value, 0);
  assert.equal(expectOk(whatPercent({ value: 90, of: 60 })).value, 150);
});
test('percentChange: increase, decrease and no change', () => {
  const up = expectOk(percentChange({ from: 80, to: 100 }));
  assert.equal(up.value, 25);
  assert.equal(up.direction, 'increase');
  assert.equal(up.change, 20);
  assert.equal(up.display, '25%');
  assertExplained(up);

  const down = expectOk(percentChange({ from: 100, to: 80 }));
  assert.equal(down.value, -20);
  assert.equal(down.magnitude, 20);
  assert.equal(down.direction, 'decrease');
  assert.equal(down.display, '-20%');

  const flat = expectOk(percentChange({ from: 50, to: 50 }));
  assert.equal(flat.value, 0);
  assert.equal(flat.direction, 'none');
});

test('percentChange: from 0 to 5 is an error, never Infinity', () => {
  const message = expectFail(percentChange({ from: 0, to: 5 }));
  assert.match(message, /cannot start from zero/);
});

test('percentChange: 0 to 0 is the documented special case — no change', () => {
  const result = expectOk(percentChange({ from: 0, to: 0 }));
  assert.equal(result.value, 0);
  assert.equal(result.direction, 'none');
  assertExplained(result);
});

test('percentChange: a negative baseline still calls a rise an increase', () => {
  const result = expectOk(percentChange({ from: -50, to: -25 }));
  assert.equal(result.value, 50);
  assert.equal(result.direction, 'increase');
});

test('applyPercentChange: increase and decrease', () => {
  const up = expectOk(applyPercentChange({ value: 200, percent: 15, direction: 'increase' }));
  assert.equal(up.value, 230);
  assert.equal(up.change, 30);
  assert.equal(up.factor, 1.15);
  assertExplained(up);

  const down = expectOk(applyPercentChange({ value: 200, percent: 15, direction: 'decrease' }));
  assert.equal(down.value, 170);
  assert.equal(down.change, -30);

  const over = expectOk(applyPercentChange({ value: 100, percent: 150, direction: 'decrease' }));
  assert.equal(over.value, -50, 'more than 100% off is left negative, not clamped');
});
test('applyPercentChange: an unknown direction is rejected', () => {
  const message = expectFail(
    applyPercentChange({ value: 200, percent: 15, direction: 'sideways' as PercentDirection }),
  );
  assert.match(message, /increase or a decrease/);
});

test('reversePercentage: £120 after a 20% increase was £100, not £96', () => {
  const up = expectOk(reversePercentage({ result: 120, percent: 20, direction: 'increase' }));
  assert.equal(up.value, 100);
  assert.equal(up.change, 20);
  assert.notEqual(up.value, 96, 'the classic wrong answer');
  assertExplained(up);

  const down = expectOk(reversePercentage({ result: 80, percent: 20, direction: 'decrease' }));
  assert.equal(down.value, 100);
  assert.equal(down.change, -20);
});

test('reversePercentage: a 100% decrease cannot be undone', () => {
  assert.match(
    expectFail(reversePercentage({ result: 0, percent: 100, direction: 'decrease' })),
    /cannot be recovered/,
  );
  assert.match(
    expectFail(reversePercentage({ result: 0, percent: -100, direction: 'increase' })),
    /cannot be recovered/,
  );
});

test('reversePercentage round-trips applyPercentChange over 200 random inputs', () => {
  const random = mulberry32(1905);
  let checked = 0;
  for (let i = 0; i < 200; i += 1) {
    const value = (random() - 0.5) * 20000;
    const percent = (random() - 0.5) * 190; // −95 … 95
    const direction: PercentDirection = random() < 0.5 ? 'increase' : 'decrease';

    const applied = expectOk(applyPercentChange({ value, percent, direction }));
    // Near a zero multiplier the inverse is genuinely ill-conditioned, so skip
    // it here; the dedicated test above covers the exactly-zero case.
    if (Math.abs(applied.factor) < 0.1) continue;

    const back = expectOk(reversePercentage({ result: applied.value, percent, direction }));
    const tolerance = 1e-9 * Math.max(1, Math.abs(value));
    assert.ok(
      Math.abs(back.value - value) <= tolerance,
      `round trip failed: ${value} ${direction} ${percent}% -> ${applied.value} -> ${back.value}`,
    );
    checked += 1;
  }
  assert.ok(checked > 150, `expected most cases to be well conditioned, got ${checked}`);
});
test('percentageDifference: symmetric, and different from percentage change', () => {
  const forward = expectOk(percentageDifference({ a: 40, b: 50 }));
  const backward = expectOk(percentageDifference({ a: 50, b: 40 }));
  assert.equal(forward.value, backward.value, 'difference must not depend on the order');
  assert.equal(forward.mean, 45);
  assert.equal(forward.difference, 10);
  assert.ok(Math.abs(forward.value - 22.22222222222222) < 1e-12);
  assert.equal(forward.display, '22.22%');
  assertExplained(forward);

  // The whole point of having both: change is 25% one way and 20% the other.
  assert.equal(expectOk(percentChange({ from: 40, to: 50 })).value, 25);
  assert.equal(expectOk(percentChange({ from: 50, to: 40 })).value, -20);
  assert.notEqual(forward.value, 25);
  assert.notEqual(forward.value, 20);
});

test('percentageDifference: identical numbers are 0%, opposite numbers are an error', () => {
  assert.equal(expectOk(percentageDifference({ a: 7, b: 7 })).value, 0);
  assert.match(expectFail(percentageDifference({ a: 5, b: -5 })), /average out to zero/);
  assert.match(expectFail(percentageDifference({ a: 0, b: 0 })), /average out to zero/);
});

/** The rounded column, which is what the page renders, must add to exactly 100. */
function sumOfShares(shares: Array<{ roundedPercent: number }>): number {
  const units = shares.reduce((sum, share) => sum + Math.round(share.roundedPercent * 100), 0);
  return units / 100;
}

test('percentageOfTotal: three equal parts still sum to exactly 100%', () => {
  const result = expectOk(percentageOfTotal({ parts: [1, 1, 1] }));
  assert.deepEqual(
    result.shares.map((share) => share.roundedPercent),
    [33.34, 33.33, 33.33],
  );
  assert.equal(sumOfShares(result.shares), 100);
  assert.equal(result.shares[0]?.adjusted, true);
  assert.equal(result.shares[1]?.adjusted, false);
  assertExplained(result);
});

test('percentageOfTotal: 7, 11, 13, 19 need no adjustment', () => {
  const result = expectOk(percentageOfTotal({ parts: [7, 11, 13, 19] }));
  assert.equal(result.total, 50);
  assert.deepEqual(
    result.shares.map((share) => share.roundedPercent),
    [14, 22, 26, 38],
  );
  assert.equal(sumOfShares(result.shares), 100);
  assert.ok(result.shares.every((share) => !share.adjusted));
});
test('percentageOfTotal: shares sum to 100 for many awkward inputs', () => {
  const random = mulberry32(4242);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const length = 1 + Math.floor(random() * 9);
    const parts = Array.from({ length }, () => Math.floor(random() * 1000));
    if (parts.every((part) => part === 0)) continue;
    for (const decimals of [0, 1, 2, 3]) {
      const result = expectOk(percentageOfTotal({ parts, decimals }));
      const scale = 10 ** decimals;
      const units = result.shares.reduce(
        (sum, share) => sum + Math.round(share.roundedPercent * scale),
        0,
      );
      assert.equal(units, 100 * scale, `[${parts.join(',')}] @ ${decimals}dp summed to ${units / scale}`);
      for (const share of result.shares) {
        assert.ok(
          Math.abs(share.roundedPercent - share.percent) <= 1 / scale,
          'largest remainder must not move a share by more than one unit',
        );
      }
    }
  }
});

test('percentageOfTotal: friendly errors for empty, zero and negative input', () => {
  assert.match(expectFail(percentageOfTotal({ parts: [] })), /at least one value/);
  assert.match(expectFail(percentageOfTotal({ parts: [0, 0] })), /add up to zero/);
  assert.match(expectFail(percentageOfTotal({ parts: [5, -2] })), /zero or more/);
  assert.match(expectFail(percentageOfTotal({ parts: [5, Number.NaN] })), /must be a number/);
});
