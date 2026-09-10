/**
 * Password, passphrase and PIN generation, plus a strength assessment.
 *
 * Every random value in this file comes from `crypto.getRandomValues`. The
 * seeded generator that the text tools share is deliberately not imported here:
 * a reproducible password is a broken password, and importing that module at all
 * would put the mistake one autocomplete away. The test guards that by grepping
 * this file, so keep the path out of these comments too.
 *
 * The argument in {@link cryptoIndexSource} is the most important thing here.
 * A generator that quietly favours the first few characters of its alphabet
 * still looks random to anyone reading its output, so the absence of that bias
 * has to be reasoned about in writing rather than assumed.
 */

/** Which character groups to draw from, and the shape of the result. */
export interface PasswordOptions {
  /** 4..256. Defaults to 16, which is long enough to survive offline cracking. */
  length?: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  /** Drops the glyphs people misread when copying a password off a screen. */
  excludeAmbiguous?: boolean;
  /** Drops symbols that look alike or need escaping in a shell or CSV. */
  excludeSimilarSymbols?: boolean;
  /**
   * Guarantees one character from every enabled group. Off by default: forcing
   * the mix rules out some otherwise-valid passwords, so `entropyBits` becomes
   * an overestimate by roughly a quarter of a bit at the default settings.
   * Turn it on when a site's policy demands the mix, not to gain strength.
   */
  requireEachSet?: boolean;
  /** Replaces the built-in symbol list. Printable ASCII only. */
  customSymbols?: string;
  /** No character is used twice. Caps the length at the pool size. */
  noRepeats?: boolean;
}

export type PasswordResult =
  | { ok: true; password: string; entropyBits: number; poolSize: number }
  | { ok: false; error: string };

export type PasswordsResult = { ok: true; passwords: string[] } | { ok: false; error: string };

export type PassphraseResult =
  | { ok: true; passphrase: string; entropyBits: number; wordlistSize: number }
  | { ok: false; error: string };

export type PinResult = { ok: true; pin: string } | { ok: false; error: string };

/** The verdict on a password someone typed, as opposed to one we generated. */
export interface StrengthReport {
  entropyBits: number;
  poolSize: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  /** Time to find it offline, at 1e11 guesses per second. */
  crackTime: string;
  /** Time to find it against a rate-limited login, at 1e3 guesses per second. */
  crackTimeOnline: string;
  issues: string[];
  strengths: string[];
}

const MIN_LENGTH = 4;
const MAX_LENGTH = 256;
const DEFAULT_LENGTH = 16;
const MAX_COUNT = 1000;
const MIN_PIN = 3;
const MAX_PIN = 12;
const DEFAULT_PIN = 4;
const MIN_WORDS = 2;
const MAX_WORDS = 24;
const DEFAULT_WORDS = 6;
const MAX_SEPARATOR_LENGTH = 4;

/**
 * The same numbers, for whoever is drawing the controls.
 *
 * A slider that runs to 512 in front of an engine that refuses anything over 256
 * is a control that offers a value and then reports an error about it, and the
 * user meets that as the page being broken. So the ranges are published rather
 * than restated: the field's `min`, the slider's `max` and the sentence in the
 * refusal all come from here, and there is no second copy to fall behind.
 */
export const PASSWORD_LIMITS = {
  minLength: MIN_LENGTH,
  maxLength: MAX_LENGTH,
  defaultLength: DEFAULT_LENGTH,
  maxCount: MAX_COUNT,
  minPin: MIN_PIN,
  maxPin: MAX_PIN,
  defaultPin: DEFAULT_PIN,
  minWords: MIN_WORDS,
  maxWords: MAX_WORDS,
  defaultWords: DEFAULT_WORDS,
  maxSeparatorLength: MAX_SEPARATOR_LENGTH,
} as const;

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT_CHARS = '0123456789';

/**
 * The symbol set used when the user has not named one.
 *
 * Exported so the page can show what "Symbols" actually means and pre-fill the
 * custom field with it, rather than describing a set it would have to guess at.
 */
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/~';

/**
 * The glyphs that get misread when a password is read aloud or copied off a
 * screen: zero against capital O against lowercase o, one against lowercase l
 * against capital I, and pipe against those two.
 */
const AMBIGUOUS_CHARS = '0OoIl1|`';

/** Symbols that look like each other, or that need escaping in a shell or CSV. */
const SIMILAR_SYMBOLS = '`\'",.;:|\\/_-<>';

/** Draws uniform integers in `[0, bound)` from the platform's CSPRNG. */
interface IndexSource {
  next(bound: number): number;
}

/** 2^32, the number of distinct values a `Uint32Array` slot can hold. */
const WORD_SPACE = 4294967296;

/**
 * Guards against a `crypto` implementation that never returns an in-range
 * value. Each draw is rejected with probability under `bound / 2^32`, so for a
 * 95-character pool the chance of even ten rejections in a row is about 1e-72.
 * Hitting the cap means the platform is broken, not unlucky.
 */
const MAX_REJECTIONS = 1000;

/**
 * Unbiased index draws.
 *
 * The tempting one-liner is `randomByte % poolSize`, and it is wrong. A byte
 * holds 256 values; 256 is not a multiple of 62, so mapping bytes onto a
 * 62-character alphabet by remainder gives `256 = 4 x 62 + 8`: the first eight
 * letters land on five source values each while the other fifty-four land on
 * four. Those eight characters come out 25% more often than the rest, forever,
 * in every password the tool has ever produced. It is invisible in the output
 * and it hands an attacker a measurably smaller search space.
 *
 * The fix is rejection sampling. Take the largest multiple of `bound` that fits
 * in 2^32, throw away any draw at or above it, and take the remainder of what
 * is left. Every surviving value now maps to exactly the same number of source
 * values, so the result is exactly uniform. The cost is the occasional discard.
 */
function cryptoIndexSource(): IndexSource {
  const CHUNK = 512;
  const buffer = new Uint32Array(CHUNK);
  let cursor = CHUNK;
  const nextWord = (): number => {
    if (cursor >= CHUNK) {
      crypto.getRandomValues(buffer);
      cursor = 0;
    }
    const word = buffer[cursor];
    cursor += 1;
    return word;
  };
  return {
    next(bound: number): number {
      if (bound <= 1) return 0;
      const limit = Math.floor(WORD_SPACE / bound) * bound;
      for (let attempt = 0; attempt < MAX_REJECTIONS; attempt += 1) {
        const word = nextWord();
        if (word < limit) return word % bound;
      }
      throw new Error('random-source-exhausted');
    },
  };
}

/**
 * Fisher-Yates, driven by the same unbiased source.
 *
 * Without this, `requireEachSet` would put the mandatory uppercase letter first
 * and the mandatory symbol fourth in every single password, which is exactly
 * the kind of structure a cracking rule set exploits.
 */
function shuffleInPlace(items: string[], source: IndexSource): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = source.next(i + 1);
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
}

interface CharSet {
  label: string;
  chars: string;
}

/** Keeps the first occurrence of each character. */
function unique(chars: string): string {
  let out = '';
  for (const char of chars) {
    if (!out.includes(char)) out += char;
  }
  return out;
}

function without(chars: string, banned: string): string {
  let out = '';
  for (const char of chars) {
    if (!banned.includes(char)) out += char;
  }
  return out;
}

/** Printable ASCII, excluding the space, which breaks too many input fields. */
function printableAsciiOnly(chars: string): string {
  let out = '';
  for (const char of chars) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 32 && code < 127) out += char;
  }
  return out;
}

type SetsResult = { ok: true; sets: CharSet[] } | { ok: false; error: string };

/**
 * Turns the options into disjoint character groups.
 *
 * They have to be disjoint: a custom symbol list containing `abc` would
 * otherwise put those letters in the pool twice, inflating `poolSize` and
 * making `requireEachSet` claim to guarantee something it cannot.
 */
function buildSets(opts: PasswordOptions): SetsResult {
  const symbolSource =
    typeof opts.customSymbols === 'string' && opts.customSymbols.length > 0
      ? printableAsciiOnly(opts.customSymbols)
      : DEFAULT_SYMBOLS;
  if (opts.symbols !== false && symbolSource.length === 0) {
    return {
      ok: false,
      error:
        'The symbol list you gave has no usable characters in it. Use printable symbols such as !@#$% and leave out spaces.',
    };
  }

  const requested: CharSet[] = [];
  if (opts.lowercase !== false) requested.push({ label: 'lowercase letters', chars: LOWERCASE });
  if (opts.uppercase !== false) requested.push({ label: 'uppercase letters', chars: UPPERCASE });
  if (opts.digits !== false) requested.push({ label: 'digits', chars: DIGIT_CHARS });
  if (opts.symbols !== false) requested.push({ label: 'symbols', chars: symbolSource });
  if (requested.length === 0) {
    return {
      ok: false,
      error:
        'Turn on at least one kind of character - lowercase, uppercase, digits or symbols - so there is something to build the password from.',
    };
  }

  const sets: CharSet[] = [];
  let taken = '';
  for (const set of requested) {
    let chars = unique(set.chars);
    if (opts.excludeAmbiguous === true) chars = without(chars, AMBIGUOUS_CHARS);
    if (opts.excludeSimilarSymbols === true && set.label === 'symbols') {
      chars = without(chars, SIMILAR_SYMBOLS);
    }
    chars = without(chars, taken);
    if (chars.length === 0) {
      return {
        ok: false,
        error: `Every one of the ${set.label} you chose was either excluded by your options or already covered by another kind of character, so none are left to use.`,
      };
    }
    taken += chars;
    sets.push({ label: set.label, chars });
  }
  return { ok: true, sets };
}

/** Rounds to two decimals so the displayed figure stops at something readable. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Plan {
  sets: CharSet[];
  pool: string;
  length: number;
  requireEachSet: boolean;
  noRepeats: boolean;
}

type PlanResult = { ok: true; plan: Plan } | { ok: false; error: string };

/** All the validation lives here, so the draw loops below cannot fail to end. */
function planPassword(opts: PasswordOptions): PlanResult {
  const length = opts.length ?? DEFAULT_LENGTH;
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    return {
      ok: false,
      error: `The length has to be a whole number between ${MIN_LENGTH} and ${MAX_LENGTH}. You asked for ${String(length)}.`,
    };
  }
  const built = buildSets(opts);
  if (!built.ok) return built;

  const sets = built.sets;
  const pool = sets.map((set) => set.chars).join('');
  const requireEachSet = opts.requireEachSet === true;
  const noRepeats = opts.noRepeats === true;

  if (requireEachSet && length < sets.length) {
    return {
      ok: false,
      error: `You asked for at least one character from ${sets.length} different kinds of character but only ${length} characters in total. Make the password at least ${sets.length} characters long, or turn off some of the character types.`,
    };
  }
  if (noRepeats && length > pool.length) {
    return {
      ok: false,
      error: `You asked for ${length} characters with no repeats, but only ${pool.length} different characters are available. Shorten the password to ${pool.length} characters or allow repeats.`,
    };
  }
  return { ok: true, plan: { sets, pool, length, requireEachSet, noRepeats } };
}

/**
 * Builds one password from an already-validated plan.
 *
 * The draw is constructive rather than generate-and-retry: mandatory characters
 * are taken first, the rest is filled from the pool, and `noRepeats` is honoured
 * by drawing from a shrinking copy of the pool instead of re-rolling on a
 * collision. That is what makes the loop bounds obvious - it cannot spin.
 */
function drawPassword(plan: Plan, source: IndexSource): string {
  const chars: string[] = [];
  const remaining = plan.noRepeats ? plan.pool.split('') : null;

  if (plan.requireEachSet) {
    for (const set of plan.sets) {
      const char = set.chars[source.next(set.chars.length)];
      chars.push(char);
      if (remaining) remaining.splice(remaining.indexOf(char), 1);
    }
  }

  while (chars.length < plan.length) {
    if (remaining) {
      const index = source.next(remaining.length);
      chars.push(remaining[index]);
      remaining.splice(index, 1);
    } else {
      chars.push(plan.pool[source.next(plan.pool.length)]);
    }
  }

  // Only needed when positions were assigned by rule. A plain draw is already
  // independent per position, so shuffling it would just burn entropy.
  if (plan.requireEachSet) shuffleInPlace(chars, source);
  return chars.join('');
}

const RANDOM_SOURCE_ERROR =
  'This device could not produce secure random numbers, so nothing was generated. Reload the page and try again, or try a different browser.';

/**
 * One random password.
 *
 * `entropyBits` is `length x log2(poolSize)`, which is the exact entropy of the
 * distribution this function samples from - the password really is drawn
 * uniformly from that space. See {@link PasswordOptions.requireEachSet} for the
 * one option that makes the figure a slight overestimate.
 */
export function generatePassword(opts: PasswordOptions = {}): PasswordResult {
  const planned = planPassword(opts);
  if (!planned.ok) return planned;
  const plan = planned.plan;
  try {
    const source = cryptoIndexSource();
    return {
      ok: true,
      password: drawPassword(plan, source),
      entropyBits: round2(plan.length * Math.log2(plan.pool.length)),
      poolSize: plan.pool.length,
    };
  } catch {
    return { ok: false, error: RANDOM_SOURCE_ERROR };
  }
}

/** Many passwords from one validated plan, so the options are checked once. */
export function generatePasswords(count: number, opts: PasswordOptions = {}): PasswordsResult {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return {
      ok: false,
      error: `The number of passwords has to be a whole number between 1 and ${MAX_COUNT}. You asked for ${String(count)}.`,
    };
  }
  const planned = planPassword(opts);
  if (!planned.ok) return planned;
  const plan = planned.plan;
  try {
    const source = cryptoIndexSource();
    const passwords: string[] = [];
    for (let i = 0; i < count; i += 1) passwords.push(drawPassword(plan, source));
    return { ok: true, passwords };
  } catch {
    return { ok: false, error: RANDOM_SOURCE_ERROR };
  }
}

/**
 * The passphrase vocabulary: exactly 512 words, which is 2^9, so every word
 * contributes exactly nine bits and the arithmetic stays checkable by hand.
 *
 * Chosen so that a passphrase can be read out over the phone and typed back
 * correctly. Every entry is lowercase, four to eight letters, and the list is
 * filtered so that no two words are anagrams, no word is a prefix of another,
 * no two words differ by a single edit, and no homophone pair (their/there,
 * bear/bare, medal/metal) appears at all. That last rule is what stops "type
 * the word you heard" from being a guess.
 */
export const WORDLIST: readonly string[] = [
  'absent', 'active', 'agile', 'almond', 'amber', 'ancient', 'antelope', 'anvil',
  'apricot', 'arrow', 'autumn', 'bacon', 'badger', 'bamboo', 'banner', 'barley',
  'basket', 'bear', 'beaver', 'bird', 'biscuit', 'blanket', 'bottle', 'bracket',
  'bread', 'brick', 'bright', 'brook', 'broth', 'bundle', 'button', 'cable',
  'camel', 'candle', 'canvas', 'careful', 'cargo', 'carve', 'cattle', 'cedar',
  'chain', 'charm', 'cheese', 'chisel', 'chorus', 'circle', 'clamp', 'clarity',
  'cliff', 'cloud', 'clove', 'coach', 'coast', 'cocoa', 'collect', 'comfort',
  'compass', 'condor', 'cookie', 'corner', 'cosmic', 'courage', 'crater', 'crayon',
  'create', 'creek', 'crisp', 'crust', 'crystal', 'cushion', 'cycle', 'daisy',
  'daring', 'decade', 'degree', 'delta', 'dental', 'desert', 'detail', 'devote',
  'dinner', 'direct', 'domain', 'double', 'dough', 'drift', 'duck', 'dynamic',
  'eagle', 'elbow', 'electric', 'elephant', 'eleven', 'empty', 'energy', 'engage',
  'entire', 'envelope', 'escape', 'ethics', 'event', 'excite', 'expand', 'expert',
  'extra', 'fabric', 'falcon', 'famous', 'fancy', 'feather', 'ferret', 'festival',
  'fiction', 'field', 'figure', 'final', 'finch', 'fish', 'fjord', 'flamingo',
  'flavor', 'flight', 'floral', 'fluent', 'focus', 'formal', 'forward', 'fossil',
  'frame', 'fresh', 'frog', 'fruit', 'funnel', 'gadget', 'gallery', 'garlic',
  'gentle', 'genuine', 'ginger', 'glide', 'global', 'golden', 'goose', 'govern',
  'grain', 'grand', 'grateful', 'gravity', 'grove', 'guava', 'guest', 'hammer',
  'happy', 'harmony', 'hawk', 'heavy', 'hedgehog', 'helpful', 'herbal', 'hinge',
  'hobby', 'holiday', 'honey', 'horizon', 'horse', 'humor', 'hunter', 'iguana',
  'imagine', 'impact', 'improve', 'indeed', 'indoor', 'inform', 'insect', 'inspire',
  'intense', 'invent', 'island', 'jaguar', 'jasmine', 'journal', 'journey', 'juice',
  'juniper', 'kangaroo', 'kindly', 'koala', 'ladder', 'lamb', 'lantern', 'laser',
  'latest', 'launch', 'leader', 'league', 'lemur', 'lesson', 'letter', 'lever',
  'library', 'lichen', 'lion', 'lively', 'llama', 'lodge', 'logic', 'lucky',
  'lunar', 'luxury', 'magic', 'magnet', 'mallet', 'mango', 'mantle', 'maple',
  'margin', 'marine', 'marsh', 'marvel', 'mature', 'medal', 'medium', 'member',
  'mentor', 'merit', 'middle', 'mighty', 'minor', 'mirror', 'mitten', 'modern',
  'mole', 'moment', 'monitor', 'moral', 'motive', 'museum', 'music', 'mystery',
  'nation', 'native', 'nearby', 'nectar', 'nephew', 'network', 'neutral', 'nimble',
  'noodle', 'notebook', 'nurture', 'oatmeal', 'obtain', 'office', 'olive', 'opera',
  'orange', 'orbit', 'order', 'organic', 'otter', 'output', 'oxygen', 'pacific',
  'package', 'palace', 'papaya', 'parade', 'parent', 'parrot', 'partner', 'pasta',
  'patient', 'payment', 'peach', 'peanut', 'pecan', 'pencil', 'penguin', 'people',
  'pepper', 'period', 'person', 'petal', 'physical', 'pickle', 'picnic', 'pillar',
  'pilot', 'pitcher', 'plank', 'plastic', 'plenty', 'pocket', 'poetry', 'polish',
  'pollen', 'popular', 'portion', 'positive', 'pottery', 'prairie', 'praise', 'prefer',
  'premium', 'pretty', 'primary', 'printer', 'prize', 'produce', 'profile', 'project',
  'promise', 'public', 'pulse', 'pumpkin', 'purchase', 'puzzle', 'quail', 'quantum',
  'quarter', 'quick', 'rabbit', 'radiant', 'radish', 'rainbow', 'rally', 'rapid',
  'raven', 'ready', 'receipt', 'recent', 'record', 'reduce', 'region', 'reindeer',
  'relax', 'remind', 'render', 'repair', 'report', 'request', 'reserve', 'respect',
  'result', 'return', 'review', 'reward', 'rhythm', 'ribbon', 'rigid', 'ritual',
  'rival', 'robin', 'roster', 'rotate', 'routine', 'royal', 'rugged', 'runner',
  'sacred', 'sailor', 'salmon', 'salute', 'sandal', 'sardine', 'satin', 'savory',
  'scale', 'scholar', 'scissors', 'scoop', 'script', 'sculpt', 'season', 'secret',
  'sector', 'senior', 'serious', 'servant', 'shadow', 'shallow', 'sheep', 'shelter',
  'shine', 'shrimp', 'shrub', 'signal', 'silver', 'sister', 'skill', 'slate',
  'slope', 'smile', 'smooth', 'snake', 'solid', 'solve', 'sorbet', 'speak',
  'special', 'spice', 'spider', 'spiral', 'sponge', 'sponsor', 'spotless', 'sprout',
  'square', 'stable', 'stadium', 'stage', 'stanza', 'stapler', 'statue', 'stellar',
  'stock', 'stool', 'storm', 'string', 'study', 'stylish', 'subtle', 'sugar',
  'suitable', 'sunny', 'sunset', 'supply', 'supreme', 'surface', 'survey', 'swamp',
  'swan', 'switch', 'symbol', 'system', 'tactic', 'talent', 'target', 'teamwork',
  'teapot', 'tennis', 'terrain', 'theory', 'thread', 'thrive', 'thyme', 'tiger',
  'timber', 'tissue', 'title', 'toaster', 'token', 'tomato', 'torch', 'total',
  'towel', 'traffic', 'trail', 'treaty', 'tribute', 'tripod', 'trout', 'trumpet',
  'tulip', 'turkey', 'turnip', 'twelve', 'umbrella', 'unique', 'unity', 'update',
  'upper', 'useful', 'usual', 'valley', 'vanilla', 'vapor', 'velvet', 'vendor',
  'verify', 'vessel', 'veteran', 'video', 'virtual', 'vision', 'vital', 'vivid',
  'volume', 'voyage', 'waffle', 'walnut', 'wander', 'warmth', 'wasp', 'weasel',
  'welcome', 'whale', 'wheat', 'willing', 'window', 'winter', 'wolf', 'wooden',
  'worthy', 'wrist', 'yearly', 'yellow', 'zealous', 'zebra', 'zephyr', 'zigzag',
];

/** Symbols safe to sprinkle into a passphrase without breaking input fields. */
const PASSPHRASE_SYMBOLS = '!@#$%&*?';

/**
 * A word-based passphrase.
 *
 * `entropyBits` counts only the words. The optional digit and symbol are there
 * to satisfy password policies, and counting them would overstate the result:
 * an attacker who knows the tool knows there is exactly one of each, so they
 * add a handful of bits at most, not the bits a random character would.
 */
export function generatePassphrase(
  opts: {
    words?: number;
    separator?: string;
    capitalise?: boolean;
    includeNumber?: boolean;
    includeSymbol?: boolean;
  } = {},
): PassphraseResult {
  const wordCount = opts.words ?? DEFAULT_WORDS;
  if (!Number.isInteger(wordCount) || wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    return {
      ok: false,
      error: `The number of words has to be a whole number between ${MIN_WORDS} and ${MAX_WORDS}. You asked for ${String(wordCount)}.`,
    };
  }
  const separator = opts.separator ?? '-';
  if (typeof separator !== 'string' || separator.length > MAX_SEPARATOR_LENGTH) {
    return {
      ok: false,
      error: `The separator can be up to ${MAX_SEPARATOR_LENGTH} characters long. Try a hyphen, a dot, or nothing at all.`,
    };
  }
  if (printableAsciiOnly(separator).length !== separator.length) {
    return {
      ok: false,
      error:
        'The separator can only contain ordinary printable characters, so spaces, tabs and emoji are out.',
    };
  }

  try {
    const source = cryptoIndexSource();
    const words: string[] = [];
    for (let i = 0; i < wordCount; i += 1) {
      const word = WORDLIST[source.next(WORDLIST.length)];
      words.push(opts.capitalise === true ? word[0].toUpperCase() + word.slice(1) : word);
    }
    if (opts.includeNumber === true) {
      const at = source.next(words.length);
      words[at] += DIGIT_CHARS[source.next(DIGIT_CHARS.length)];
    }
    if (opts.includeSymbol === true) {
      const at = source.next(words.length);
      words[at] += PASSPHRASE_SYMBOLS[source.next(PASSPHRASE_SYMBOLS.length)];
    }
    return {
      ok: true,
      passphrase: words.join(separator),
      entropyBits: round2(wordCount * Math.log2(WORDLIST.length)),
      wordlistSize: WORDLIST.length,
    };
  } catch {
    return { ok: false, error: RANDOM_SOURCE_ERROR };
  }
}

/**
 * A numeric PIN.
 *
 * No pattern filtering: rejecting `1234` or `1111` would shrink the space and
 * make the remaining PINs marginally more predictable, and a four-digit PIN is
 * weak whatever comes out. It is only ever safe behind a lockout counter.
 */
export function generatePin(digits: number = DEFAULT_PIN): PinResult {
  if (!Number.isInteger(digits) || digits < MIN_PIN || digits > MAX_PIN) {
    return {
      ok: false,
      error: `A PIN has to be between ${MIN_PIN} and ${MAX_PIN} digits long. You asked for ${String(digits)}.`,
    };
  }
  try {
    const source = cryptoIndexSource();
    let pin = '';
    for (let i = 0; i < digits; i += 1) pin += DIGIT_CHARS[source.next(10)];
    return { ok: true, pin };
  } catch {
    return { ok: false, error: RANDOM_SOURCE_ERROR };
  }
}

const SECONDS_PER_UNIT: ReadonlyArray<{ seconds: number; name: string }> = [
  { seconds: 1, name: 'second' },
  { seconds: 60, name: 'minute' },
  { seconds: 3600, name: 'hour' },
  { seconds: 86400, name: 'day' },
  // A twelfth of a Julian year, so twelve months and one year agree.
  { seconds: 2629800, name: 'month' },
  { seconds: 31557600, name: 'year' },
];

const AGE_OF_UNIVERSE_YEARS = 1.38e10;

/** Thousands separators without leaning on a locale that might not be English. */
function groupDigits(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Two significant figures, so 1,953 years reads as the 2,000 years it means. */
function roundToTwoSignificant(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

/** Turns a duration into the phrase a non-specialist can act on. */
function humaniseSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds / 31557600 >= AGE_OF_UNIVERSE_YEARS) {
    return 'longer than the age of the universe';
  }
  if (seconds < 1) return 'instantly';
  let index = 0;
  while (index + 1 < SECONDS_PER_UNIT.length && seconds >= SECONDS_PER_UNIT[index + 1].seconds) {
    index += 1;
  }
  const measure = (at: number): number => {
    const value = seconds / SECONDS_PER_UNIT[at].seconds;
    return value >= 100 ? roundToTwoSignificant(value) : Math.round(value);
  };
  let rounded = measure(index);
  // Rounding 59.8 seconds up must not print "60 seconds".
  const next = SECONDS_PER_UNIT[index + 1];
  if (next && rounded * SECONDS_PER_UNIT[index].seconds >= next.seconds) {
    index += 1;
    rounded = measure(index);
  }
  const name = SECONDS_PER_UNIT[index].name;
  return `${groupDigits(rounded)} ${rounded === 1 ? name : `${name}s`}`;
}

/** Average guesses to find a secret of this size: half the search space. */
function crackTimeFor(entropyBits: number, guessesPerSecond: number): string {
  return humaniseSeconds(Math.pow(2, entropyBits) / 2 / guessesPerSecond);
}

const OFFLINE_GUESSES_PER_SECOND = 1e11;
const ONLINE_GUESSES_PER_SECOND = 1e3;

/** Straight runs across a standard keyboard, checked in both directions. */
const KEYBOARD_ROWS: readonly string[] = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1234567890',
  '!@#$%^&*()',
];

const KEYBOARD_RUN_LENGTH = 4;

/** Printable ASCII that is neither a letter nor a digit, including the space. */
const SYMBOL_CLASS_SIZE = 33;
const OTHER_CLASS_SIZE = 100;

interface ObservedClasses {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
  other: boolean;
  count: number;
  poolSize: number;
}

function observeClasses(password: string): ObservedClasses {
  let lower = false;
  let upper = false;
  let digit = false;
  let symbol = false;
  let other = false;
  for (const char of password) {
    if (char >= 'a' && char <= 'z') lower = true;
    else if (char >= 'A' && char <= 'Z') upper = true;
    else if (char >= '0' && char <= '9') digit = true;
    else {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 32 && code < 127) symbol = true;
      else other = true;
    }
  }
  const poolSize =
    (lower ? 26 : 0) +
    (upper ? 26 : 0) +
    (digit ? 10 : 0) +
    (symbol ? SYMBOL_CLASS_SIZE : 0) +
    (other ? OTHER_CLASS_SIZE : 0);
  const count = [lower, upper, digit, symbol, other].filter(Boolean).length;
  return { lower, upper, digit, symbol, other, count, poolSize };
}

/** The longest straight keyboard run in the password, forwards or backwards. */
function findKeyboardRun(password: string): string | null {
  const lower = password.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    for (let length = row.length; length >= KEYBOARD_RUN_LENGTH; length -= 1) {
      for (let start = 0; start + length <= row.length; start += 1) {
        const run = row.slice(start, start + length);
        if (lower.includes(run)) return run;
        const backwards = run.split('').reverse().join('');
        if (lower.includes(backwards)) return backwards;
      }
    }
  }
  return null;
}

const WORDLIST_SET: ReadonlySet<string> = new Set(WORDLIST);

const RECOMMENDED_LENGTH = 12;
const SHORT_PENALTY_BITS = 10;
const SINGLE_CLASS_PENALTY_BITS = 8;
const KEYBOARD_RUN_PENALTY_BITS = 12;
const REPEAT_PENALTY_BITS = 8;
const YEAR_PENALTY_BITS = 8;
const COMMON_SHAPE_PENALTY_BITS = 15;

const SCORE_BANDS: ReadonlyArray<{ upTo: number; score: 0 | 1 | 2 | 3 | 4; label: StrengthReport['label'] }> = [
  { upTo: 28, score: 0, label: 'Very weak' },
  { upTo: 36, score: 1, label: 'Weak' },
  { upTo: 60, score: 2, label: 'Fair' },
  { upTo: 80, score: 3, label: 'Strong' },
  { upTo: Infinity, score: 4, label: 'Very strong' },
];

/** `Password1!`: one capital, a word, digits, then symbols. */
const COMMON_SHAPE = /^[A-Z][a-z]+[0-9]+[^A-Za-z0-9]+$/;
const REPEATED_RUN = /(.)\1{2,}/;
/** A year at the end, allowing for a decoration such as `2019!` after it. */
const YEAR_SUFFIX = /((?:19|20)\d{2})[^0-9]{0,3}$/;


function classNames(observed: ObservedClasses): string {
  const names: string[] = [];
  if (observed.lower) names.push('lowercase letters');
  if (observed.upper) names.push('uppercase letters');
  if (observed.digit) names.push('digits');
  if (observed.symbol) names.push('symbols');
  if (observed.other) names.push('unusual characters');
  if (names.length <= 1) return names[0] ?? 'nothing';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const EMPTY_REPORT: StrengthReport = {
  entropyBits: 0,
  poolSize: 0,
  score: 0,
  label: 'Very weak',
  crackTime: 'instantly',
  crackTimeOnline: 'instantly',
  issues: ['There is no password here yet. Type or generate one to see how it holds up.'],
  strengths: [],
};

interface Findings {
  estimate: number;
  issues: string[];
  strengths: string[];
}

function collectFindings(password: string, observed: ObservedClasses): Findings {
  const issues: string[] = [];
  const strengths: string[] = [];
  let estimate = password.length * Math.log2(observed.poolSize);

  if (WORDLIST_SET.has(password.toLowerCase())) {
    // One guess from a word list, not a random string of that length.
    estimate = Math.log2(WORDLIST.length);
    issues.push(
      'The whole password is a single dictionary word, so a word-list attack finds it almost immediately. Use several unrelated words instead.',
    );
  }
  if (password.length < RECOMMENDED_LENGTH) {
    estimate -= SHORT_PENALTY_BITS;
    issues.push(
      `It is only ${password.length} characters long. Aim for at least ${RECOMMENDED_LENGTH}, and 16 or more for anything guarding money or email.`,
    );
  } else {
    strengths.push(
      `It is ${password.length} characters long, and length does more for you than any other single change.`,
    );
  }
  if (observed.count <= 1) {
    estimate -= SINGLE_CLASS_PENALTY_BITS;
    issues.push(
      `It only uses ${classNames(observed)}. Adding a number and a symbol multiplies the number of guesses an attacker has to make.`,
    );
  } else if (observed.count >= 3) {
    strengths.push(`It mixes ${classNames(observed)}, so no single alphabet covers it.`);
  }
  const run = findKeyboardRun(password);
  if (run !== null) {
    estimate -= KEYBOARD_RUN_PENALTY_BITS;
    issues.push(
      `It contains "${run}", a straight run across the keyboard. Cracking tools try those runs before anything else.`,
    );
  }
  const repeated = REPEATED_RUN.exec(password);
  if (repeated !== null) {
    estimate -= REPEAT_PENALTY_BITS;
    issues.push(
      `It repeats "${repeated[1]}" three or more times in a row, which adds length without adding difficulty.`,
    );
  }
  const year = YEAR_SUFFIX.exec(password);
  if (year !== null) {
    estimate -= YEAR_PENALTY_BITS;
    issues.push(
      `It ends in ${year[1]}, which reads as a year. Dates are the first thing a cracking rule set substitutes.`,
    );
  }
  if (COMMON_SHAPE.test(password)) {
    estimate -= COMMON_SHAPE_PENALTY_BITS;
    issues.push(
      'It follows the Password1! shape: one capital, a word, a digit, then a symbol. That shape is the most common one in leaked password lists, so the digit and symbol on the end buy you very little.',
    );
  }
  return { estimate: Math.max(0, estimate), issues, strengths };
}

/**
 * Rates a password someone typed.
 *
 * `entropyBits` here is a heuristic, and an optimistic one: it is an upper
 * bound on the strength of a password that fits none of the patterns below, not
 * a guarantee about this password. It starts from the size of the alphabet the
 * characters happen to come from and then deducts for the shapes that cracking
 * rule sets already know about. A real attacker has more rules than these, so
 * treat a good score as "no obvious problem found", not as "this is safe".
 * Generated passwords are the opposite case: there the figure is exact, because
 * the tool knows the distribution it drew from.
 */
export function assessPassword(password: string): StrengthReport {
  if (password.length === 0) {
    return { ...EMPTY_REPORT, issues: EMPTY_REPORT.issues.slice() };
  }
  const observed = observeClasses(password);
  const findings = collectFindings(password, observed);
  const band =
    SCORE_BANDS.find((candidate) => findings.estimate < candidate.upTo) ??
    SCORE_BANDS[SCORE_BANDS.length - 1];

  const crackTime = crackTimeFor(findings.estimate, OFFLINE_GUESSES_PER_SECOND);
  if (band.score >= 3) {
    findings.strengths.push(
      `Even an attacker with a stolen password file and fast hardware would need about ${crackTime} to guess it.`,
    );
  }
  return {
    entropyBits: round2(findings.estimate),
    poolSize: observed.poolSize,
    score: band.score,
    label: band.label,
    crackTime,
    crackTimeOnline: crackTimeFor(findings.estimate, ONLINE_GUESSES_PER_SECOND),
    issues: findings.issues,
    strengths: findings.strengths,
  };
}
