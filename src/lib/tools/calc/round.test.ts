import test from 'node:test';
import assert from 'node:assert/strict';

import {
  display,
  displayMoney,
  displayPercent,
  formatNumber,
  isRealNumber,
  parseLooseNumber,
  roundMoney,
  roundTo,
  smartDecimals,
} from './round.ts';

/** Deterministic PRNG so a failure is always reproducible. */
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

test('roundTo: the classic binary-float half-way cases', () => {
  // These are the three that `Math.round(v * 100) / 100` gets wrong.
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(2.675, 2), 2.68);
  assert.equal(roundTo(-1.005, 2), -1.01);
});

test('roundTo: more half-way cases, rounded away from zero', () => {
  assert.equal(roundTo(8.345, 2), 8.35);
  assert.equal(roundTo(1.045, 2), 1.05);
  assert.equal(roundTo(0.5, 0), 1);
  assert.equal(roundTo(-0.5, 0), -1);
  assert.equal(roundTo(2.5, 0), 3);
  assert.equal(roundTo(-2.5, 0), -3);
  assert.equal(roundTo(1.5, 0), 2);
});
test('roundTo: does not round when it should not', () => {
  assert.equal(roundTo(1.0049, 2), 1.0);
  assert.equal(roundTo(0.30000000000000004, 2), 0.3);
  assert.equal(roundTo(1234.5678, 2), 1234.57);
  assert.equal(roundTo(5, 2), 5);
  assert.equal(roundTo(0, 2), 0);
});

test('roundTo: never produces -0, and survives extreme magnitudes', () => {
  assert.equal(Object.is(roundTo(-0.001, 2), 0), true, 'expected +0, not -0');
  assert.equal(roundTo(1e21, 2), 1e21);
  assert.equal(roundTo(1e-21, 2), 0);
  assert.equal(roundTo(Number.MAX_VALUE, 2), Number.MAX_VALUE);
});

test('roundTo: degenerate decimals arguments are clamped, not thrown', () => {
  assert.equal(roundTo(1.567, -3), 2);
  assert.equal(roundTo(1.567, Number.NaN), 2);
  assert.equal(roundTo(1.567, 2.9), 1.57);
  assert.equal(Number.isNaN(roundTo(Number.NaN, 2)), true);
});

test('roundTo: idempotent, in range, and never gains decimals', () => {
  const random = mulberry32(20260903);
  for (let i = 0; i < 2000; i += 1) {
    const value = (random() - 0.5) * 10 ** Math.floor(random() * 8);
    const places = Math.floor(random() * 7);
    const once = roundTo(value, places);
    assert.equal(roundTo(once, places), once, `not idempotent for ${value} @ ${places}`);
    assert.ok(
      Math.abs(once - value) <= 0.5 * 10 ** -places + 1e-6,
      `moved too far: ${value} -> ${once} @ ${places}`,
    );
    const fraction = String(once).split('.')[1] ?? '';
    assert.ok(fraction.length <= places, `${once} has more than ${places} decimals`);
  }
});

test('roundMoney is roundTo(_, 2)', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(19.999), 20);
});
test('smartDecimals: integers plain, small fractions detailed', () => {
  assert.equal(smartDecimals(42), 0);
  assert.equal(smartDecimals(-42), 0);
  assert.equal(smartDecimals(0), 0);
  assert.equal(smartDecimals(1.5), 2);
  assert.equal(smartDecimals(1234.5678), 2);
  assert.equal(smartDecimals(0.5), 4);
  assert.equal(smartDecimals(0.0123), 5);
  assert.equal(smartDecimals(0.000123), 7);
  assert.equal(smartDecimals(Number.NaN), 0);
  assert.equal(smartDecimals(Number.POSITIVE_INFINITY), 0);
});

test('formatNumber: grouping, padding, currency, locale', () => {
  assert.equal(formatNumber(1234.5, { decimals: 2 }), '1,234.5');
  assert.equal(formatNumber(1234.5, { decimals: 2, padDecimals: true }), '1,234.50');
  assert.equal(formatNumber(1234.5, { decimals: 2, thousands: false }), '1234.5');
  assert.equal(formatNumber(1234.5, { currency: 'GBP' }), '£1,234.50');
  assert.equal(formatNumber(1234, { currency: 'USD' }), '$1,234.00');
  assert.equal(formatNumber(1234.5, { decimals: 2, locale: 'de-DE' }), '1.234,5');
  assert.equal(formatNumber(0.5), '0.5', 'smart decimals must not pad to 0.5000');
});

test('formatNumber: non-finite input renders as an em dash, never "NaN"', () => {
  assert.equal(formatNumber(Number.NaN), '—');
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '—');
  assert.equal(formatNumber(Number.NEGATIVE_INFINITY), '—');
});

test('display helpers', () => {
  assert.equal(display(1234.5678), '1,234.57');
  assert.equal(display(1234.5678, 3), '1,234.568');
  assert.equal(display(12), '12');
  assert.equal(displayMoney(1234.5), '1,234.50');
  assert.equal(displayMoney(0), '0.00');
  assert.equal(displayPercent(28), '28%');
  assert.equal(displayPercent(27.5), '27.5%');
  assert.equal(displayPercent(33.333333, 2), '33.33%');
});

test('isRealNumber rejects everything the UI must never see', () => {
  assert.equal(isRealNumber(1), true);
  assert.equal(isRealNumber(0), true);
  assert.equal(isRealNumber(Number.NaN), false);
  assert.equal(isRealNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(isRealNumber('1'), false);
  assert.equal(isRealNumber(null), false);
  assert.equal(isRealNumber(undefined), false);
});
test('parseLooseNumber: the required cases', () => {
  assert.equal(parseLooseNumber('1,234.56'), 1234.56);
  assert.equal(parseLooseNumber('1.234,56'), 1234.56);
  assert.equal(parseLooseNumber('€ 1 234'), 1234);
  assert.equal(parseLooseNumber('12%'), 12);
  assert.equal(parseLooseNumber('abc'), null);
  assert.equal(parseLooseNumber(''), null);
  assert.equal(parseLooseNumber('-0.5'), -0.5);
  assert.equal(parseLooseNumber('1e3'), 1000);
});

test('parseLooseNumber: separators', () => {
  assert.equal(parseLooseNumber('1,234'), 1234, 'lone comma + 3 digits is a thousands group');
  assert.equal(parseLooseNumber('1,5'), 1.5, 'lone comma + other digits is a decimal comma');
  assert.equal(parseLooseNumber('1.234'), 1.234, 'a lone dot is always a decimal point');
  assert.equal(parseLooseNumber('1.234.567'), 1234567);
  assert.equal(parseLooseNumber('1,234,567.89'), 1234567.89);
  assert.equal(parseLooseNumber("1'234'567"), 1234567, 'Swiss apostrophe grouping');
  assert.equal(parseLooseNumber('1_000'), 1000);
  assert.equal(parseLooseNumber('.5'), 0.5);
  assert.equal(parseLooseNumber(',5'), 0.5);
});

test('parseLooseNumber: currency symbols, signs and accounting negatives', () => {
  assert.equal(parseLooseNumber('$1,000.00'), 1000);
  assert.equal(parseLooseNumber('1 234,56 €'), 1234.56);
  assert.equal(parseLooseNumber('₹1,00,000'), 100000);
  assert.equal(parseLooseNumber('  +42  '), 42);
  assert.equal(parseLooseNumber('(1,234.56)'), -1234.56);
  assert.equal(parseLooseNumber('-12.5%'), -12.5);
  assert.equal(parseLooseNumber('\u00a01\u00a0234'), 1234, 'non-breaking spaces');
});

test('parseLooseNumber: returns null rather than NaN for junk', () => {
  for (const junk of ['abc', '', '   ', '1.2.3,4,5', '--1', '1e', 'e3', '1..2', 'Infinity', 'NaN', '()', '$']) {
    assert.equal(parseLooseNumber(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
});
