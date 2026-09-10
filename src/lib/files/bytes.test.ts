import { test } from 'node:test';
import assert from 'node:assert/strict';

import { humanBytes, humanLimit } from './bytes.ts';

test('humanBytes: whole bytes below a kilobyte', () => {
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(1), '1 B');
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(1023), '1023 B');
});

test('humanBytes: one decimal above a kilobyte', () => {
  assert.equal(humanBytes(1024), '1.0 KB');
  assert.equal(humanBytes(1536), '1.5 KB');
  assert.equal(humanBytes(2_500_000), '2.4 MB');
});

test('humanBytes: rounding never produces a wrong unit', () => {
  // 1023.6 B rounds to 1024, which must not print as "1024 B".
  assert.equal(humanBytes(1023.6), '1.0 KB');
  // 1048575 B divides to 1024.0 KB, which must not print as "1024.0 KB".
  assert.equal(humanBytes(1_048_575), '1.0 MB');
  assert.equal(humanBytes(1024 ** 3 - 1), '1.0 GB');
});

test('humanBytes: negatives keep their sign, non-finite values are not NaN', () => {
  assert.equal(humanBytes(-2048), '-2.0 KB');
  assert.equal(humanBytes(Number.NaN), '0 B');
  assert.equal(humanBytes(Number.POSITIVE_INFINITY), '0 B');
});

test('humanBytes: stops at the largest unit rather than inventing one', () => {
  assert.equal(humanBytes(1024 ** 5), '1.0 PB');
  assert.equal(humanBytes(1024 ** 6), '1024.0 PB');
});

test('humanLimit: exact multiples lose the pointless decimal', () => {
  assert.equal(humanLimit(30 * 1024 * 1024), '30 MB');
  assert.equal(humanLimit(1024), '1 KB');
  assert.equal(humanLimit(2 * 1024 ** 3), '2 GB');
});

test('humanLimit: anything not a clean multiple falls back to the honest number', () => {
  assert.equal(humanLimit(1500), humanBytes(1500));
  assert.equal(humanLimit(999), '999 B');
  assert.equal(humanLimit(0), '0 B');
  assert.equal(humanLimit(-5), humanBytes(-5));
});
