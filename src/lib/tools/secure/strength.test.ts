import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateStrength, timeToGuess } from './strength.ts';

/**
 * The meter's job is not to be precise — no meter can be — it is to not lie in
 * the dangerous direction. So these tests are mostly *orderings*: things that
 * must rate worse than other things. An estimator that gets every ordering
 * right is useful even if every number in it is off by a factor of ten.
 */

test('the textbook bad passwords all score zero', () => {
  for (const password of ['password', '123456', 'qwerty', 'letmein', 'admin', 'iloveyou']) {
    assert.equal(estimateStrength(password).score, 0, password);
  }
});

test('leet substitutions do not rescue a common password', () => {
  // The single most important case: the classic meter rates this "strong"
  // because it has four character classes.
  const result = estimateStrength('P@ssw0rd');
  assert.equal(result.score, 0, 'P@ssw0rd must not pass');
  assert.ok(result.warning);
});

test('a common word with digits stuck on is still weak', () => {
  for (const password of ['password123', 'monkey1', 'dragon2024', 'welcome!']) {
    assert.equal(estimateStrength(password).score, 0, password);
  }
});

test('a passphrase beats a short scrambled password', () => {
  const phrase = estimateStrength('correct horse battery staple');
  const scrambled = estimateStrength('Xk7#qL');
  assert.ok(
    phrase.bits > scrambled.bits,
    `a four-word phrase (${phrase.bits.toFixed(0)} bits) should beat six scrambled characters (${scrambled.bits.toFixed(0)})`,
  );
  assert.equal(phrase.score, 4);
});

test('keyboard runs and repeats are caught', () => {
  for (const password of ['qwertyuiop', 'asdfgh', 'abcdef', '654321', 'aaaaaaaa', 'abababab']) {
    assert.equal(estimateStrength(password).score, 0, password);
  }
});

test('a PIN is rated as the small space it is', () => {
  assert.equal(estimateStrength('4829').score, 0);
  assert.ok(estimateStrength('482917365204').bits > estimateStrength('4829').bits);
});

test('a year is not a password', () => {
  assert.equal(estimateStrength('1998').score, 0);
  assert.equal(estimateStrength('2024').score, 0);
});

test('longer is always at least as good, for the same shape', () => {
  // Deliberately *not* one unit repeated: 'ab'.repeat(6) is a repeated
  // password, which the meter is right to score as one. Growing a single
  // non-repeating string keeps the shape constant while only length varies.
  const full = 'Tr7#kQ2mZv9$wLx4Bn6!Ph3@';
  let previous = -1;
  for (const length of [8, 12, 16, 20, 24]) {
    const password = full.slice(0, length);
    const result = estimateStrength(password);
    assert.equal(result.warning, null, `${password} was flagged: ${String(result.warning)}`);
    assert.ok(result.bits >= previous, `length ${length} scored lower than the one before`);
    previous = result.bits;
  }
});

test('a repeated unit is caught however long the result is', () => {
  // The reverse of the test above, and the reason it had to be written
  // carefully: doubling a strong-looking password does not double its strength.
  assert.equal(estimateStrength('Tr7#kQ2mTr7#kQ2m').score, 0);
});

test('an empty password is zero without a warning to shout', () => {
  const result = estimateStrength('');
  assert.equal(result.bits, 0);
  assert.equal(result.warning, null);
});

test('a genuinely random long password reaches the top score', () => {
  assert.equal(estimateStrength('7Kq#mZ2vRb!9XtLw').score, 4);
});

/* ── the time estimate ─────────────────────────────────────────────────── */

test('the work factor changes the answer by the right order of magnitude', () => {
  // The whole argument for the site's own container: 600 times the work per
  // guess has to visibly move the number.
  const weakFormat = timeToGuess(50, 1000);
  const strongFormat = timeToGuess(50, 600_000);
  assert.notEqual(weakFormat, strongFormat);
});

test('a weak password is described as instant, not as a small number', () => {
  assert.equal(timeToGuess(10, 1000), 'instantly');
});

test('a strong password reaches the far end of the scale', () => {
  assert.match(timeToGuess(128, 600_000), /universe|billion/);
});

test('the phrases come out in order as the bits rise', () => {
  const phrases = [20, 40, 50, 60, 70, 80, 100].map((bits) => timeToGuess(bits, 1000));
  // No two adjacent estimates should read the same, or the meter looks stuck.
  for (let i = 1; i < phrases.length; i += 1) {
    assert.notEqual(phrases[i], phrases[i - 1], `${phrases[i]} repeated`);
  }
});

test('the time phrases are grammatical at every boundary', () => {
  // Rounding lands on exactly one at each step of the scale, and "1 years"
  // in the one sentence the user has to trust reads as carelessness.
  for (let bits = 1; bits <= 140; bits += 1) {
    for (const iterations of [1000, 600_000]) {
      const phrase = timeToGuess(bits, iterations);
      assert.doesNotMatch(phrase, /\babout 1 (seconds|minutes|hours|days|months|years)\b/, phrase);
    }
  }
});
