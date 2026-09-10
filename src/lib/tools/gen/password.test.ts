import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WORDLIST,
  assessPassword,
  generatePassphrase,
  generatePassword,
  generatePasswords,
  generatePin,
} from './password.ts';

const SOURCE = readFileSync(new URL('./password.ts', import.meta.url), 'utf8');

test('the source never reaches for a predictable random source', () => {
  // A regression guard, not a style rule. `Math.random` is seeded from a value
  // an attacker can sometimes narrow down, and the seeded generator next door
  // is reproducible by design, which for a password is the same as broken.
  assert.equal(SOURCE.includes('Math.random'), false);
  assert.equal(SOURCE.includes('text/random.ts'), false);
  assert.equal(SOURCE.includes('crypto.getRandomValues'), true);
});

/** Pearson's chi-square statistic for observed counts against a flat expectation. */
function chiSquare(counts: readonly number[]): number {
  const total = counts.reduce((sum, value) => sum + value, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, value) => sum + ((value - expected) ** 2) / expected, 0);
}

function tally(passwords: readonly string[], alphabet: readonly string[]): number[] {
  const index = new Map(alphabet.map((char, at) => [char, at]));
  const counts = new Array<number>(alphabet.length).fill(0);
  for (const password of passwords) {
    for (const char of password) {
      const at = index.get(char);
      assert.notEqual(at, undefined, `"${char}" is not in the pool`);
      counts[at as number] += 1;
    }
  }
  return counts;
}

function collect(batches: number, length: number, opts: Record<string, unknown>): string[] {
  const all: string[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const result = generatePasswords(1000, { length, ...opts });
    assert.equal(result.ok, true);
    if (result.ok) all.push(...result.passwords);
  }
  return all;
}

const THREE_CHAR_POOL = { lowercase: false, uppercase: false, digits: false, customSymbols: '!@#' };

test('a three-character pool comes out uniform over 256,000 draws', () => {
  const passwords = collect(4, 64, THREE_CHAR_POOL);
  const counts = tally(passwords, ['!', '@', '#']);
  assert.equal(counts.reduce((sum, value) => sum + value, 0), 256000);
  // Two degrees of freedom: 13.82 is the 0.1% point, 20 leaves plenty of room
  // for honest bad luck while still failing loudly on a real skew.
  const statistic = chiSquare(counts);
  assert.ok(statistic < 20, `chi-square ${statistic.toFixed(3)} over 3 bins`);
});

test('a sixty-two character pool comes out uniform, which is where modulo bias would show', () => {
  // This is the sharper test. 256 is not a multiple of 62, so the `byte % 62`
  // shortcut gives the first eight letters five source values each and the rest
  // four - a 25% surplus that lands here as a chi-square around 1,300 against a
  // 61-degree-of-freedom distribution whose 0.1% point is roughly 107.
  const alphabet = [
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
  ];
  const passwords = collect(2, 128, { symbols: false });
  const counts = tally(passwords, alphabet);
  assert.equal(counts.length, 62);
  assert.equal(counts.reduce((sum, value) => sum + value, 0), 256000);
  const statistic = chiSquare(counts);
  assert.ok(statistic < 140, `chi-square ${statistic.toFixed(3)} over 62 bins`);
});

test('requireEachSet holds over 2,000 passwords, and the mandatory characters move around', () => {
  const result = generatePasswords(1000, { length: 8, requireEachSet: true });
  const more = generatePasswords(1000, { length: 8, requireEachSet: true });
  assert.equal(result.ok && more.ok, true);
  if (!result.ok || !more.ok) return;
  const positionsOfFirstDigit = new Set<number>();
  for (const password of [...result.passwords, ...more.passwords]) {
    assert.match(password, /[a-z]/, password);
    assert.match(password, /[A-Z]/, password);
    assert.match(password, /[0-9]/, password);
    assert.match(password, /[^A-Za-z0-9]/, password);
    positionsOfFirstDigit.add(password.search(/[0-9]/));
  }
  // Without the cryptographic shuffle this set would hold a single value.
  assert.ok(positionsOfFirstDigit.size >= 6, `digit landed in ${positionsOfFirstDigit.size} places`);
});

test('noRepeats never reuses a character', () => {
  for (const length of [4, 20, 60, 89]) {
    const result = generatePasswords(200, { length, noRepeats: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    for (const password of result.passwords) {
      assert.equal(password.length, length);
      assert.equal(new Set(password).size, length, password);
    }
  }
});

test('noRepeats and requireEachSet together still produce every set exactly once over', () => {
  const result = generatePasswords(500, { length: 12, noRepeats: true, requireEachSet: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const password of result.passwords) {
    assert.equal(new Set(password).size, 12, password);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
});

test('impossible requests fail with a readable sentence instead of hanging', () => {
  const impossible: Array<Record<string, unknown>> = [
    // More characters than the pool can supply without repeating one.
    { length: 20, noRepeats: true, lowercase: false, uppercase: false, digits: false, customSymbols: '!@#' },
    // Every symbol in the custom list is also excluded as ambiguous.
    { length: 8, requireEachSet: true, noRepeats: true, customSymbols: '0O1lI|', excludeAmbiguous: true },
    // Nothing enabled at all.
    { lowercase: false, uppercase: false, digits: false, symbols: false },
    // Outside the length bounds at both ends.
    { length: 3 },
    { length: 257 },
    { length: 12.5 },
    // A custom symbol list of nothing but characters we cannot use.
    { customSymbols: '   ' },
  ];
  const started = Date.now();
  for (const opts of impossible) {
    const result = generatePassword(opts);
    assert.equal(result.ok, false, JSON.stringify(opts));
    if (!result.ok) {
      assert.ok(result.error.length > 30, result.error);
      assert.match(result.error, /\.$/);
    }
  }
  // A retry loop with no cap would sit here forever rather than return.
  assert.ok(Date.now() - started < 250, `took ${Date.now() - started}ms`);
});

test('five thousand passwords are all different', () => {
  const seen = new Set<string>();
  for (let batch = 0; batch < 5; batch += 1) {
    const result = generatePasswords(1000, { length: 16 });
    assert.equal(result.ok, true);
    if (result.ok) for (const password of result.passwords) seen.add(password);
  }
  assert.equal(seen.size, 5000);
});

test('count bounds are enforced', () => {
  assert.equal(generatePasswords(0).ok, false);
  assert.equal(generatePasswords(1001).ok, false);
  assert.equal(generatePasswords(2.5).ok, false);
  const edge = generatePasswords(1000, { length: 4 });
  assert.equal(edge.ok, true);
  if (edge.ok) assert.equal(edge.passwords.length, 1000);
});

test('entropy is length times log2 of the pool', () => {
  const sixteen = generatePassword({ length: 16, symbols: false });
  assert.equal(sixteen.ok, true);
  if (!sixteen.ok) return;
  assert.equal(sixteen.poolSize, 62);
  assert.equal(sixteen.entropyBits, 95.27);
  assert.equal(sixteen.password.length, 16);

  const withSymbols = generatePassword({ length: 20 });
  assert.equal(withSymbols.ok, true);
  if (!withSymbols.ok) return;
  assert.equal(withSymbols.poolSize, 89);
  assert.equal(withSymbols.entropyBits, Math.round(20 * Math.log2(89) * 100) / 100);

  const digitsOnly = generatePassword({
    length: 10,
    lowercase: false,
    uppercase: false,
    symbols: false,
  });
  assert.equal(digitsOnly.ok, true);
  if (digitsOnly.ok) {
    assert.equal(digitsOnly.poolSize, 10);
    assert.equal(digitsOnly.entropyBits, 33.22);
  }
});

/** True when the two words are one insertion, deletion or substitution apart. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let differences = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        differences += 1;
        if (differences > 1) return false;
      }
    }
    return differences === 1;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let skipped = 0;
  for (let j = 0; j < longer.length && i < shorter.length; j += 1) {
    if (shorter[i] === longer[j]) i += 1;
    else {
      skipped += 1;
      if (skipped > 1) return false;
    }
  }
  return true;
}

test('the wordlist is fit to read out over the phone', () => {
  assert.ok(WORDLIST.length >= 400, `only ${WORDLIST.length} words`);
  assert.equal(WORDLIST.length, 512);
  assert.equal(new Set(WORDLIST).size, WORDLIST.length);
  for (const word of WORDLIST) {
    assert.match(word, /^[a-z]{4,8}$/, word);
  }
  const sortedLetters = (word: string): string => word.split('').sort().join('');
  const anagrams = new Set<string>();
  for (const word of WORDLIST) {
    assert.equal(anagrams.has(sortedLetters(word)), false, `anagram of ${word}`);
    anagrams.add(sortedLetters(word));
  }
  for (let i = 0; i < WORDLIST.length; i += 1) {
    for (let j = i + 1; j < WORDLIST.length; j += 1) {
      const a = WORDLIST[i];
      const b = WORDLIST[j];
      assert.equal(a.startsWith(b) || b.startsWith(a), false, `${a} / ${b} share a prefix`);
      assert.equal(oneEditApart(a, b), false, `${a} / ${b} are one typo apart`);
    }
  }
});

test('Password1! is graded as the tired shape it is', () => {
  const report = assessPassword('Password1!');
  // 10 characters over a 95-character pool is 65.7 bits before the penalties
  // for being under 12 long and for the capital-word-digit-symbol shape.
  assert.equal(report.poolSize, 95);
  assert.equal(report.entropyBits, 40.7);
  assert.ok(report.score <= 2, `scored ${report.score}`);
  assert.equal(report.label, 'Fair');
  assert.ok(
    report.issues.some((issue) => issue.includes('Password1! shape')),
    JSON.stringify(report.issues),
  );
  assert.ok(
    report.issues.some((issue) => issue.includes('only 10 characters long')),
    JSON.stringify(report.issues),
  );
  // A rate-limited login is the one thing standing between this and a breach,
  // so the two figures must not collapse into each other.
  assert.notEqual(report.crackTime, report.crackTimeOnline);
  assert.notEqual(report.crackTimeOnline, 'instantly');
});

test('forty random characters score the top band', () => {
  const generated = generatePassword({ length: 40 });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const report = assessPassword(generated.password);
  assert.equal(report.score, 4);
  assert.equal(report.label, 'Very strong');
  assert.ok(report.entropyBits > 200, `${report.entropyBits} bits`);
  assert.equal(report.crackTime, 'longer than the age of the universe');
  assert.deepEqual(report.issues, []);
  assert.ok(report.strengths.length >= 3, JSON.stringify(report.strengths));
});

test('an empty password is answered with an invitation, not a crash', () => {
  const report = assessPassword('');
  assert.equal(report.score, 0);
  assert.equal(report.label, 'Very weak');
  assert.equal(report.entropyBits, 0);
  assert.equal(report.crackTime, 'instantly');
  assert.equal(report.issues.length, 1);
  assert.equal(report.strengths.length, 0);
  // The caller gets a fresh array each time, so a UI that sorts or splices the
  // list in place cannot corrupt the next report.
  report.issues.push('mutated');
  assert.equal(assessPassword('').issues.length, 1);
});

test('each named weakness is called out by name', () => {
  const cases: ReadonlyArray<[string, string]> = [
    [WORDLIST[0], 'single dictionary word'],
    ['qwertyuiop', 'straight run across the keyboard'],
    ['aaaaaaaaaaaaaaaa', 'repeats "a" three or more times'],
    ['Summer2019!', 'It ends in 2019'],
    ['aaaaaaaaaaaaaaaa', 'only uses lowercase letters'],
    ['Password1!', 'Password1! shape'],
  ];
  for (const [password, fragment] of cases) {
    const report = assessPassword(password);
    assert.ok(
      report.issues.some((issue) => issue.includes(fragment)),
      `"${password}" did not mention "${fragment}": ${JSON.stringify(report.issues)}`,
    );
  }
  // Every issue is a whole sentence, because it goes on screen unedited.
  for (const [password] of cases) {
    for (const issue of assessPassword(password).issues) {
      assert.match(issue, /^[A-Z].*[.!]$/, issue);
    }
  }
});

test('crack times are phrased for humans, with separators on the big numbers', () => {
  assert.equal(assessPassword('a').crackTime, 'instantly');
  const shapes = new Set<string>();
  for (const length of [4, 6, 8, 10, 12, 14, 16, 20, 24, 32]) {
    const generated = generatePassword({ length });
    assert.equal(generated.ok, true);
    if (!generated.ok) return;
    for (const phrase of [
      assessPassword(generated.password).crackTime,
      assessPassword(generated.password).crackTimeOnline,
    ]) {
      shapes.add(phrase);
      assert.match(
        phrase,
        /^(instantly|longer than the age of the universe|[\d,.]+ (seconds?|minutes?|hours?|days?|months?|years?))$/,
        phrase,
      );
      // "31536000 years" is unreadable; the grouped form is the whole point.
      const digits = /^([\d,.]+)/.exec(phrase)?.[1] ?? '';
      const whole = digits.split('.')[0];
      if (whole.replace(/,/g, '').length > 4) assert.match(whole, /^\d{1,3}(,\d{3})+$/, phrase);
    }
  }
  assert.ok(shapes.size >= 5, `only saw ${shapes.size} distinct phrasings`);
});

test('a passphrase is words from the list, and is never reproducible', () => {
  const result = generatePassphrase();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const words = result.passphrase.split('-');
  assert.equal(words.length, 6);
  for (const word of words) assert.ok(WORDLIST.includes(word), word);
  // 512 words is exactly nine bits each, which is the reason for that count.
  assert.equal(result.wordlistSize, 512);
  assert.equal(result.entropyBits, 54);

  // Determinism is the one thing a passphrase must not have: there is no seed
  // option, and two calls in a row must not agree.
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    const next = generatePassphrase();
    if (next.ok) seen.add(next.passphrase);
  }
  assert.equal(seen.size, 200);
});

test('passphrase separators, capitals and the added digit and symbol', () => {
  const dotted = generatePassphrase({ words: 4, separator: '.' });
  assert.equal(dotted.ok, true);
  if (dotted.ok) {
    assert.equal(dotted.passphrase.split('.').length, 4);
    assert.equal(dotted.entropyBits, 36);
  }
  const joined = generatePassphrase({ words: 3, separator: '' });
  assert.equal(joined.ok, true);
  if (joined.ok) assert.equal(joined.passphrase.includes('-'), false);

  const capitalised = generatePassphrase({ words: 5, capitalise: true });
  assert.equal(capitalised.ok, true);
  if (capitalised.ok) {
    for (const word of capitalised.passphrase.split('-')) assert.match(word, /^[A-Z][a-z]+$/, word);
  }
  const decorated = generatePassphrase({ words: 4, includeNumber: true, includeSymbol: true });
  assert.equal(decorated.ok, true);
  if (decorated.ok) {
    assert.match(decorated.passphrase, /[0-9]/);
    assert.match(decorated.passphrase, /[!@#$%&*?]/);
    // The extras are decoration, so they must not inflate the reported figure.
    assert.equal(decorated.entropyBits, 36);
    assert.equal(decorated.passphrase.split('-').length, 4);
  }
});

test('passphrase word counts and separators are bounded', () => {
  for (const words of [1, 0, 25, -3, 2.5, Number.NaN]) {
    const result = generatePassphrase({ words });
    assert.equal(result.ok, false, `accepted ${String(words)} words`);
    if (!result.ok) assert.match(result.error, /between 2 and 24/);
  }
  for (const words of [2, 24]) {
    const result = generatePassphrase({ words });
    assert.equal(result.ok, true, `rejected ${words} words`);
    if (result.ok) assert.equal(result.passphrase.split('-').length, words);
  }
  const tooLong = generatePassphrase({ separator: '-----' });
  assert.equal(tooLong.ok, false);
  const spaced = generatePassphrase({ separator: ' ' });
  assert.equal(spaced.ok, false, 'a space is not a printable separator here');
  if (!spaced.ok) assert.match(spaced.error, /^[A-Z].*\.$/);
});

test('PINs keep their leading zeros and respect their bounds', () => {
  const four = generatePin();
  assert.equal(four.ok, true);
  if (four.ok) assert.match(four.pin, /^[0-9]{4}$/);

  for (const digits of [3, 4, 6, 12]) {
    const result = generatePin(digits);
    assert.equal(result.ok, true, `rejected ${digits}`);
    if (result.ok) assert.equal(result.pin.length, digits);
  }
  for (const digits of [2, 0, -1, 13, 4.5, Number.NaN]) {
    const result = generatePin(digits);
    assert.equal(result.ok, false, `accepted ${String(digits)}`);
    if (!result.ok) assert.match(result.error, /between 3 and 12 digits/);
  }

  // A PIN held as a number would lose its leading zeros, so 0042 would come
  // back as 42 and the space would silently shrink.
  const counts = new Array<number>(10).fill(0);
  let leadingZero = 0;
  for (let i = 0; i < 4000; i += 1) {
    const result = generatePin(4);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.pin.length, 4);
    if (result.pin.startsWith('0')) leadingZero += 1;
    for (const char of result.pin) counts[Number(char)] += 1;
  }
  assert.ok(leadingZero > 250, `only ${leadingZero} of 4,000 PINs started with 0`);
  const statistic = chiSquare(counts);
  assert.ok(statistic < 30, `digit chi-square ${statistic.toFixed(3)} over 10 bins`);
});

test('the exclusion options remove exactly what they claim to', () => {
  const plain = generatePassword({ length: 32 });
  assert.equal(plain.ok && plain.poolSize, 89);

  const noAmbiguous = generatePassword({ length: 200, excludeAmbiguous: true });
  assert.equal(noAmbiguous.ok, true);
  if (noAmbiguous.ok) {
    // 24 lowercase + 24 uppercase + 8 digits + 27 symbols.
    assert.equal(noAmbiguous.poolSize, 83);
    assert.equal(/[0OoIl1|`]/.test(noAmbiguous.password), false, noAmbiguous.password);
  }

  const noSimilar = generatePassword({ length: 200, excludeSimilarSymbols: true });
  assert.equal(noSimilar.ok, true);
  if (noSimilar.ok) {
    // Nine of the twenty-seven default symbols are the confusable ones.
    assert.equal(noSimilar.poolSize, 80);
    assert.equal(/['",.;:|\\/_<>`-]/.test(noSimilar.password), false, noSimilar.password);
  }

  const both = generatePassword({ length: 8, excludeAmbiguous: true, excludeSimilarSymbols: true });
  assert.equal(both.ok && both.poolSize, 74);
});

test('a custom symbol list is kept disjoint from the other sets', () => {
  // "abc123" is entirely covered by the lowercase and digit sets, so counting it
  // again would inflate poolSize and overstate the entropy.
  const overlapping = generatePassword({ length: 12, customSymbols: 'abc123' });
  assert.equal(overlapping.ok, false);
  if (!overlapping.ok) assert.match(overlapping.error, /already covered/);

  const alone = generatePassword({ length: 12, lowercase: false, customSymbols: 'abc' });
  assert.equal(alone.ok, true);
  if (alone.ok) assert.equal(alone.poolSize, 26 + 10 + 3);

  const trimmed = generatePassword({ length: 12, customSymbols: '!@# $%' });
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) {
    // The space is dropped rather than becoming an invisible pool member.
    assert.equal(trimmed.poolSize, 26 + 26 + 10 + 5);
    assert.equal(trimmed.password.includes(' '), false);
  }

  const repeated = generatePassword({ length: 12, customSymbols: '!!!!!!' });
  assert.equal(repeated.ok, true);
  if (repeated.ok) assert.equal(repeated.poolSize, 26 + 26 + 10 + 1);
});

test('length bounds and the default', () => {
  const byDefault = generatePassword();
  assert.equal(byDefault.ok, true);
  if (byDefault.ok) assert.equal(byDefault.password.length, 16);
  for (const length of [4, 5, 255, 256]) {
    const result = generatePassword({ length });
    assert.equal(result.ok, true, `rejected ${length}`);
    if (result.ok) {
      assert.equal(result.password.length, length);
      assert.equal(result.entropyBits, Math.round(length * Math.log2(89) * 100) / 100);
    }
  }
  // requireEachSet with fewer characters than groups is guarded in the source
  // but unreachable from here: the shortest allowed password is 4 and there are
  // at most 4 groups, so the guard stays defensive rather than testable.
  const exactly = generatePassword({ length: 4, requireEachSet: true });
  assert.equal(exactly.ok, true);
  if (exactly.ok) {
    assert.match(exactly.password, /[a-z]/);
    assert.match(exactly.password, /[A-Z]/);
    assert.match(exactly.password, /[0-9]/);
    assert.match(exactly.password, /[^A-Za-z0-9]/);
  }
});
