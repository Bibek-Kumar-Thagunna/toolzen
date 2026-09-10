/**
 * URL slug generation.
 *
 * The pipeline is deliberately boring and predictable:
 *
 * 1. Each code point is folded on its own: NFKD, then combining marks are
 *    dropped, then a lookup table catches the letters NFKD leaves alone.
 * 2. Runs of surviving ASCII letters and digits become *words*.
 * 3. Words are joined with the separator.
 *
 * Building words rather than running a chain of regex replacements is what
 * makes "never emit a double separator" and "never leave a leading or trailing
 * one" true by construction instead of by cleanup, and it gives
 * {@link slugifyPreview} an exact list of what was thrown away.
 */

export interface SlugOptions {
  /** Joins the words. Default `'-'`. `''` runs them together. */
  separator?: string;
  /** Default `true`. */
  lowercase?: boolean;
  /**
   * Characters, not words. Cuts at a word boundary. Unset, zero or negative all
   * mean no limit.
   */
  maxLength?: number;
  /** Default `false`. Drops English filler words such as `the` and `of`. */
  stripStopWords?: boolean;
  /**
   * Default `true`. Turns on the ß/Cyrillic/Greek tables. With it off, only
   * what NFKD can strip an accent from survives; everything else is dropped.
   */
  transliterate?: boolean;
}

export interface SlugPreview {
  slug: string;
  /** Things worth telling the user, in the order they are worth knowing. */
  warnings: string[];
}

/**
 * Letters NFKD refuses to decompose, because their Latin equivalent is a
 * spelling convention rather than a base letter carrying an accent.
 */
const LATIN_EXTRAS: Readonly<Record<string, string | undefined>> = {
  'ß': 'ss', 'ẞ': 'SS', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ð': 'd',
  'þ': 'th', 'ł': 'l', 'ħ': 'h', 'ı': 'i', 'ŋ': 'n', 'ƒ': 'f', 'ĸ': 'k',
  'ŧ': 't', 'ƶ': 'z', 'ȷ': 'j', 'ſ': 's', 'ə': 'e', 'ʒ': 'z',
};

/** Russian, plus the Ukrainian and Serbian letters that differ from it. */
const CYRILLIC: Readonly<Record<string, string | undefined>> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh',
  'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ы': 'y', 'э': 'e',
  'ю': 'yu', 'я': 'ya', 'і': 'i', 'ї': 'i', 'є': 'ye', 'ґ': 'g',
  'ђ': 'dj', 'ј': 'j', 'љ': 'lj', 'њ': 'nj', 'ћ': 'c', 'џ': 'dz',
};

/** Modern (ELOT 743) values: `β` is `v`, not `b`. */
const GREEK: Readonly<Record<string, string | undefined>> = {
  'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i',
  'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x',
  'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y',
  'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
};

/**
 * Applied *before* NFKD. Both of these are a base letter plus a diacritic, so
 * NFKD would otherwise flatten `ё` to `e` and `й` to `i` and lose the
 * conventional spelling.
 */
const PRE_NFKD: Readonly<Record<string, string | undefined>> = {
  'ё': 'yo', 'Ё': 'Yo', 'й': 'y', 'Й': 'Y',
};

/**
 * Uppercase entries are derived rather than typed out, so the tables above stay
 * short enough to check by eye. Multi-character uppercase forms (`ß` → `SS`)
 * are skipped, and anything already present wins — that is how `ς` avoids
 * overwriting the `Σ` that `σ` produced.
 */
function withUpperCase(
  table: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...table };
  for (const [from, to] of Object.entries(table)) {
    if (to === undefined) continue;
    const upper = from.toUpperCase();
    if (upper.length !== 1 || out[upper] !== undefined) continue;
    out[upper] = to.charAt(0).toUpperCase() + to.slice(1);
  }
  return out;
}

const TRANSLITERATION: Readonly<Record<string, string | undefined>> = {
  ...withUpperCase(LATIN_EXTRAS),
  ...withUpperCase(CYRILLIC),
  ...withUpperCase(GREEK),
};

/**
 * Removed *without* ending the current word, so `don't` slugs as `dont` rather
 * than `don-t`. The Cyrillic soft and hard signs belong here for the same
 * reason: they modify the letter before them and have no Latin spelling.
 * `­` is the soft hyphen, invisible in a browser and easy to paste in.
 */
const SILENT = new Set(["'", '’', '‘', '`', '´', 'ʼ', '­', 'ъ', 'ь', 'Ъ', 'Ь']);

/** English filler, only consulted when `stripStopWords` is on. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'if', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'our', 'so', 'than', 'that', 'the', 'their',
  'then', 'there', 'these', 'they', 'this', 'to', 'was', 'were', 'will',
  'with', 'you', 'your',
]);

const COMBINING_MARKS = /\p{M}/gu;

/**
 * Characters whose loss is worth a warning. Punctuation and spaces are word
 * boundaries and go silently; a letter, a digit or an emoji vanishing is
 * something the user should hear about.
 */
const CARRIES_MEANING = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

function isAsciiAlnum(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
}

/**
 * Marks "a word ends here" inside a fold. It has to be in-band because a single
 * code point can decompose into several words: NFKD turns `½` into `1`, a
 * fraction slash and `2`, and the answer is `1-2` rather than `12`.
 */
const BREAK = '\u0000';

/**
 * One code point in, its ASCII spelling out. Every character of the result is
 * either an ASCII letter or digit, or {@link BREAK}.
 */
function foldCodePoint(cp: string, transliterate: boolean): string {
  const pre = transliterate ? PRE_NFKD[cp] : undefined;
  const decomposed = (pre ?? cp).normalize('NFKD').replace(COMBINING_MARKS, '');
  let out = '';
  for (const ch of decomposed) {
    if (isAsciiAlnum(ch)) {
      out += ch;
      continue;
    }
    out += (transliterate ? TRANSLITERATION[ch] : undefined) ?? BREAK;
  }
  return out;
}

interface Folded {
  words: string[];
  /** Distinct meaningful characters that produced nothing, in first-seen order. */
  dropped: string[];
}

/**
 * The single pass. Anything that folds to a break ends the current word, which
 * is why `hello---world` and `hello world` yield the same two words and why a
 * double separator — or a leading or trailing one — is unrepresentable rather
 * than cleaned up afterwards.
 */
function foldToWords(input: string, transliterate: boolean): Folded {
  const words: string[] = [];
  const dropped = new Set<string>();
  let current = '';
  for (const cp of input) {
    if (SILENT.has(cp)) continue;
    const folded = foldCodePoint(cp, transliterate);
    // Nothing but breaks means this code point contributed no letters at all.
    if (folded.replaceAll(BREAK, '') === '' && CARRIES_MEANING.test(cp)) dropped.add(cp);
    for (const ch of folded) {
      if (ch !== BREAK) {
        current += ch;
        continue;
      }
      if (current !== '') {
        words.push(current);
        current = '';
      }
    }
  }
  if (current !== '') words.push(current);
  return { words, dropped: [...dropped] };
}

interface Truncation {
  slug: string;
  truncated: boolean;
  /** True only for the one case where a word had to be cut in half. */
  midWord: boolean;
}

/**
 * Whole words only. The exception is a first word already longer than the
 * limit: cutting it mid-word beats returning nothing at all.
 */
function truncateToWords(
  words: readonly string[],
  separator: string,
  limit: number,
): Truncation {
  if (words.length === 0) return { slug: '', truncated: false, midWord: false };
  if (words[0].length > limit) {
    return { slug: words[0].slice(0, limit), truncated: true, midWord: true };
  }
  let slug = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${slug}${separator}${words[i]}`;
    if (next.length > limit) return { slug, truncated: true, midWord: false };
    slug = next;
  }
  return { slug, truncated: false, midWord: false };
}

/** Lists at most three examples: the point is recognition, not an inventory. */
function describeDropped(dropped: readonly string[]): string {
  const shown = dropped.slice(0, 3).join(' ');
  const rest = dropped.length - 3;
  const noun = dropped.length === 1 ? 'character' : 'characters';
  return (
    `Dropped ${dropped.length} ${noun} with no Latin spelling: ${shown}` +
    `${rest > 0 ? ` and ${rest} more` : ''}.`
  );
}

/**
 * The slug plus everything worth saying about how it got there. `slugify` is
 * this function with the warnings discarded, so the two can never drift.
 */
export function slugifyPreview(input: string, opts: SlugOptions = {}): SlugPreview {
  const separator = opts.separator ?? '-';
  const warnings: string[] = [];

  const { words, dropped } = foldToWords(input, opts.transliterate !== false);
  let kept = opts.lowercase === false ? words : words.map((word) => word.toLowerCase());

  if (opts.stripStopWords === true && kept.length > 0) {
    const filtered = kept.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
    // Stripping every word would leave nothing to link to, so it is not done.
    if (filtered.length === 0) warnings.push('Every word is a stop word, so none were removed.');
    else kept = filtered;
  }

  // Zero, negative and non-finite limits all mean "no limit": a number field
  // sitting at 0 is a user who has not chosen one, not a request for one letter.
  const requested =
    opts.maxLength === undefined || !Number.isFinite(opts.maxLength)
      ? 0
      : Math.floor(opts.maxLength);
  const limit = requested > 0 ? requested : 0;
  const { slug, truncated, midWord } =
    limit > 0
      ? truncateToWords(kept, separator, limit)
      : { slug: kept.join(separator), truncated: false, midWord: false };

  if (dropped.length > 0) warnings.push(describeDropped(dropped));
  if (midWord) {
    warnings.push(`The first word is longer than ${limit} characters, so it was cut short.`);
  } else if (truncated) {
    warnings.push(`Shortened to ${limit} characters at a word boundary.`);
  }
  if (slug === '') {
    warnings.push('Nothing usable was left — add some letters or numbers.');
  }

  return { slug, warnings };
}

export function slugify(input: string, opts: SlugOptions = {}): string {
  return slugifyPreview(input, opts).slug;
}

