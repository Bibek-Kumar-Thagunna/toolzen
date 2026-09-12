/**
 * ============================================================================
 * HOW LONG WOULD THIS PASSWORD TAKE TO GUESS?
 * ============================================================================
 * A strength meter that answers in time rather than in colour.
 *
 * ── Why not the usual "one point per character class" meter ───────────────
 * Because it is wrong in the direction that matters. The classic rule —
 * upper, lower, digit, symbol, eight characters — rates `P@ssw0rd!` as strong
 * and `correcthorsebatterystaple` as weak, and the truth is the reverse by
 * many orders of magnitude. An attacker does not try `aaaaaaaa`, `aaaaaaab`;
 * they try real passwords, then real passwords with predictable substitutions,
 * and `P@ssw0rd!` is on the first list they own.
 *
 * So the estimate here starts from the assumption that the guesser is smart:
 * it looks for a known password, a keyboard run, a repeat, a year, a plain
 * dictionary-ish word with letters swapped for digits — and when it finds one,
 * it scores the password as the small number of guesses those patterns imply
 * rather than the enormous number brute force would.
 *
 * It is not zxcvbn. It has no 30,000-word list, and it will overrate an
 * uncommon English word. It is deliberately a fraction of a kilobyte, and it
 * is calibrated to be *pessimistic* — where it is unsure it assumes the
 * attacker does better, because the failure worth avoiding is telling somebody
 * a weak password is fine.
 *
 * ── Why the answer depends on the format ──────────────────────────────────
 * The same password is not equally strong in both files the site writes. An
 * AES zip is frozen at 1000 PBKDF2 rounds, and the site's own container uses
 * 600,000 — six hundred times the work per guess. Showing one number for
 * "password strength" would hide the single most useful thing a person could
 * know at that moment, which is that choosing the compatible format costs them
 * a factor of six hundred and they should lengthen the password to match.
 * ============================================================================
 */

/**
 * Guesses per second, for a well-funded attacker with GPUs, against one
 * PBKDF2-HMAC-SHA1 iteration.
 *
 * Deliberately a round, large, *current* number rather than a careful one:
 * hardware gets faster, and an estimate that flatters the user ages badly. A
 * single high-end card does billions of raw SHA-1 operations a second, and
 * somebody serious rents a hundred of them by the hour.
 */
const GUESSES_PER_SECOND = 100_000_000_000;

/** The hundred or so passwords that appear at the top of every breach list. */
const COMMON = new Set([
  '123456', 'password', '123456789', '12345678', '12345', '1234567', 'qwerty', 'abc123',
  'password1', '1234567890', '111111', '123123', 'admin', 'letmein', 'welcome', 'monkey',
  'dragon', 'football', 'iloveyou', 'sunshine', 'princess', 'qwerty123', 'master', 'login',
  'passw0rd', 'starwars', 'whatever', 'trustno1', 'freedom', 'shadow', 'superman', 'batman',
  'baseball', 'hello', 'charlie', 'donald', 'qwertyuiop', 'zaq12wsx', 'q1w2e3r4', 'asdfgh',
  'zxcvbnm', '000000', '654321', 'aa123456', 'password123', 'qazwsx', '1q2w3e4r', 'abcd1234',
  'secret', 'love', 'god', 'money', 'test', 'guest', 'root', 'toor', 'pass', 'admin123',
  'changeme', 'default', 'temp', 'qwe123', 'asd123', 'a1b2c3', 'access', 'flower', 'hottie',
  'loveme', 'zaq1zaq1', 'jordan', 'harley', 'ranger', 'buster', 'thomas', 'tigger', 'robert',
  'soccer', 'hockey', 'killer', 'george', 'andrew', 'charlie1', 'jessica', 'michael', 'ashley',
  'daniel', 'computer', 'internet', 'samsung', 'google', 'facebook', 'nepal', 'india',
]);

/** Rows of a QWERTY keyboard, for spotting `asdfgh` and friends. */
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

/** The obvious letter-to-symbol substitutions, undone before the word lookup. */
const UNLEET: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i',
};

function unleet(value: string): string {
  let out = '';
  for (const character of value.toLowerCase()) out += UNLEET[character] ?? character;
  return out;
}

/** How many distinct characters the password draws on. */
function alphabetSize(password: string): number {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/[^A-Za-z0-9]/.test(password)) size += 33;
  return Math.max(size, 1);
}

/** True when the password is mostly one character, or one short repeated run. */
function isRepetitive(password: string): boolean {
  if (password.length < 4) return false;
  const distinct = new Set(password.toLowerCase()).size;
  if (distinct <= 2) return true;
  for (let unit = 1; unit <= password.length / 2; unit += 1) {
    if (password.length % unit !== 0) continue;
    const piece = password.slice(0, unit);
    if (piece.repeat(password.length / unit) === password) return true;
  }
  return false;
}

/** True for `abcdef`, `654321`, `qwerty` and the other straight lines. */
function isSequence(password: string): boolean {
  const lower = password.toLowerCase();
  if (lower.length < 4) return false;
  for (const row of ROWS) {
    const reversed = [...row].reverse().join('');
    if (row.includes(lower) || reversed.includes(lower)) return true;
  }
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i += 1) {
    const step = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

export interface Strength {
  /** Base-2 log of the estimated number of guesses. */
  bits: number;
  /** 0 very weak … 4 strong, for the meter. */
  score: 0 | 1 | 2 | 3 | 4;
  /** What made it weak, in one phrase, or null. */
  warning: string | null;
}

/**
 * Estimate the work needed to guess a password.
 *
 * The result is an *upper bound on the attacker's effort* under pessimistic
 * assumptions, so a high score means "no obvious weakness was found", never
 * "this is safe".
 */
export function estimateStrength(password: string): Strength {
  if (password === '') return { bits: 0, score: 0, warning: null };

  const lower = password.toLowerCase();
  const stripped = unleet(password).replace(/[^a-z]/g, '');

  // A known password, however it is dressed up. The guess count is roughly the
  // position in the attacker's list, which is small.
  if (COMMON.has(lower) || (stripped.length > 2 && COMMON.has(stripped))) {
    return { bits: 12, score: 0, warning: 'This is on every list of common passwords.' };
  }
  // A known password with digits or punctuation stuck on the end is the single
  // most common shape there is, and cracking tools generate it by default.
  const trimmed = lower.replace(/[0-9!@#$%^&*._-]+$/, '');
  if (trimmed.length >= 3 && (COMMON.has(trimmed) || COMMON.has(unleet(trimmed)))) {
    return {
      bits: 18,
      score: 0,
      warning: 'A common word with numbers on the end is one of the first things tried.',
    };
  }
  if (isRepetitive(password)) {
    return { bits: 10, score: 0, warning: 'Repeated characters are guessed almost immediately.' };
  }
  if (isSequence(password)) {
    return { bits: 12, score: 0, warning: 'A straight run of keys or letters is guessed at once.' };
  }
  if (/^(19|20)\d{2}$/.test(password)) {
    return { bits: 8, score: 0, warning: 'A year is one of about a hundred guesses.' };
  }
  if (/^\d+$/.test(password)) {
    // Digits only: the search space is small and attackers start here.
    const bits = Math.log2(Math.pow(10, password.length));
    return {
      bits,
      score: bits < 30 ? 0 : bits < 40 ? 1 : 2,
      warning: 'Digits only — there are far fewer of these than they look.',
    };
  }

  // Nothing obvious found. Estimate from length and alphabet, then take a
  // penalty for being short, because a short password is enumerable whatever
  // it is made of.
  let bits = password.length * Math.log2(alphabetSize(password));

  // A single lower-case word is a dictionary hit even if it is not on the list
  // above, so it is worth far less than its length suggests.
  if (/^[a-z]+$/.test(password) && password.length <= 10) bits = Math.min(bits, 22);

  const words = password.trim().split(/[\s-_.]+/).filter((part) => part.length > 0);
  if (words.length >= 3 && password.length >= 16) {
    // A passphrase. Several words is genuinely strong, and the character-class
    // estimate above understates it, so keep the larger of the two.
    bits = Math.max(bits, words.length * 11);
  }

  const score: Strength['score'] =
    bits < 30 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 75 ? 3 : 4;
  return {
    bits,
    score,
    warning: bits < 45 ? 'Short enough to be worth brute-forcing.' : null,
  };
}

/**
 * How long guessing would take, for a given number of PBKDF2 rounds.
 *
 * Returned as a phrase rather than a number because the number spans thirty
 * orders of magnitude and nobody reads `3.2e14 seconds` as "longer than you
 * will be alive".
 */
/**
 * "about 1 year", not "about 1 years". A rounding that lands on one is common
 * at every boundary of this scale, and the wrong plural in the one sentence
 * the user is being asked to trust reads as carelessness.
 */
function every(value: number, unit: string, fixedUnit = false): string {
  const count = Math.max(1, Math.round(value));
  if (fixedUnit) return `about ${count} ${unit}`;
  return `about ${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function timeToGuess(bits: number, iterations: number): string {
  // Half the space on average, divided by how many guesses a second the work
  // factor allows.
  const perSecond = GUESSES_PER_SECOND / Math.max(iterations, 1);
  const seconds = Math.pow(2, bits - 1) / perSecond;

  if (seconds < 1) return 'instantly';
  if (seconds < 60) return every(seconds, 'second');
  if (seconds < 3600) return every(seconds / 60, 'minute');
  if (seconds < 86_400) return every(seconds / 3600, 'hour');
  if (seconds < 2_592_000) return every(seconds / 86_400, 'day');
  if (seconds < 31_536_000) return every(seconds / 2_592_000, 'month');

  const years = seconds / 31_536_000;
  if (years < 1000) return every(years, 'year');
  if (years < 1e6) return every(years / 1000, 'thousand years', true);
  if (years < 1e9) return every(years / 1e6, 'million years', true);
  if (years < 1e12) return every(years / 1e9, 'billion years', true);
  return 'longer than the universe has existed';
}

export const STRENGTH_LABELS: Readonly<Record<Strength['score'], string>> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
};
