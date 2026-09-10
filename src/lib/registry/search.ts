/**
 * ============================================================================
 * TOOL SEARCH
 * ============================================================================
 * Powers the command palette and the `/tools` filter box. Two constraints shape
 * every decision here:
 *
 *   1. It runs on the client, so the data it searches must be small. The full
 *      registry entry carries FAQ answers and several paragraphs of prose;
 *      shipping that to build a search box would be absurd. {@link SearchDoc}
 *      is the projection that actually ships — roughly a tweet per tool.
 *   2. It is a pure function of its input, with no import from the registry and
 *      no DOM, so `node --test --experimental-strip-types` can exercise the
 *      ranking directly. Hence the local `SearchSource` shape rather than an
 *      `import type { Tool }`: any `Tool` satisfies it structurally, and this
 *      file stays standalone.
 *
 * Ranking is a fixed tier table rather than a tuned similarity metric. For 24
 * items with hand-written keyword lists, "name prefix beats keyword prefix
 * beats fuzzy" is both predictable for us and legible to the user, and a user
 * who types three characters and does not see the obvious tool loses trust
 * immediately. Tiers are wide apart so tie-breaks never cross a tier.
 * ============================================================================
 */

/** The registry fields search is allowed to look at. `Tool` satisfies this. */
export interface SearchSource {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  icon: string;
  primaryKeyword: string;
  secondaryKeywords: readonly string[];
  synonyms: readonly string[];
  popular?: boolean;
}

/**
 * What crosses the server/client boundary. `terms` is pre-normalised at build
 * time so the client never re-folds the same strings on every keystroke, and
 * `haystack` is the concatenation used for cheap substring tests.
 */
export interface SearchDoc {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  icon: string;
  popular: boolean;
  /** Normalised name. */
  n: string;
  /** Normalised slug with hyphens turned into spaces. */
  s: string;
  /** Normalised keywords, most important first. */
  k: string[];
  /** Normalised synonyms. Never displayed. */
  y: string[];
  /** Normalised tagline. */
  t: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** Character ranges in `doc.name` to emphasise, merged and sorted. */
  ranges: [number, number][];
}

const MARKS = /\p{M}/gu;

/**
 * British and American spellings folded to one canonical token.
 *
 * The audience is global and English-first, so someone typing "colour palette"
 * must find the tool we spelled "Color Palette Generator", and someone typing
 * "optimise image" must find the compressor. Applied symmetrically to both the
 * index and the query, so a token maps to itself when it is already canonical.
 *
 * Deliberately an explicit list rather than a rule like `our -> or`: a rule good
 * enough to fix "colour" also turns "four" into "for". A dozen entries covers
 * every spelling that plausibly appears in a query for these tools, and adding
 * one is a one-line change with no risk of a surprising conflation.
 */
const SPELLING: Readonly<Record<string, string | undefined>> = {
  colour: 'color',
  colours: 'colors',
  coloured: 'colored',
  grey: 'gray',
  greyscale: 'grayscale',
  centre: 'center',
  centred: 'centered',
  optimise: 'optimize',
  optimised: 'optimized',
  optimisation: 'optimization',
  organise: 'organize',
  analyse: 'analyze',
  normalise: 'normalize',
  minimise: 'minimize',
  summarise: 'summarize',
  favourite: 'favorite',
  catalogue: 'catalog',
  licence: 'license',
};

/**
 * Fold to a comparable form: lowercase, strip accents, turn anything that is
 * not a letter or digit into a single space, then canonicalise spelling. So
 * "JPG→PNG", "jpg to png" and "JPG_PNG" all reduce to the same tokens, a user
 * typing "cafe" still finds "café", and "colour" finds "color".
 */
export function normalise(input: string): string {
  const folded = input
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (folded === '') return folded;
  return folded
    .split(' ')
    .map((token) => SPELLING[token] ?? token)
    .join(' ');
}

/** Build the client payload. Call on the server, pass the result as props. */
export function buildSearchIndex(sources: readonly SearchSource[]): SearchDoc[] {
  return sources.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    tagline: tool.tagline,
    category: tool.category,
    icon: tool.icon,
    popular: tool.popular === true,
    n: normalise(tool.name),
    s: normalise(tool.slug),
    k: [tool.primaryKeyword, ...tool.secondaryKeywords].map(normalise),
    y: tool.synonyms.map(normalise),
    t: normalise(tool.tagline),
  }));
}

/** Longest query worth considering. Bounds the work per keystroke. */
const MAX_QUERY = 64;

const TIER = {
  exact: 1000,
  namePrefix: 900,
  slugPrefix: 820,
  nameWord: 740,
  nameSubstring: 640,
  keywordPrefix: 560,
  synonymPrefix: 480,
  keywordSubstring: 420,
  synonymSubstring: 340,
  tagline: 260,
  category: 180,
  fuzzy: 90,
} as const;

/** True when `haystack` has a word starting with `needle`. */
function hasWordPrefix(haystack: string, needle: string): boolean {
  return haystack.startsWith(needle) || haystack.includes(` ${needle}`);
}

/**
 * Subsequence match, used only as a last resort so a typo or an abbreviation
 * ("jsnfmt") still finds something. Rejected unless the matched characters sit
 * reasonably close together, because an unbounded subsequence match will happily
 * claim that "abc" is in "a big calculator" and fill the palette with noise.
 */
function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length < 3) return 0;
  let first = -1;
  let at = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, at);
    if (found === -1) return 0;
    if (first === -1) first = found;
    at = found + 1;
  }
  const span = at - first;
  if (span > needle.length * 3) return 0;
  // Tighter and earlier is better; both terms stay well inside one tier.
  return TIER.fuzzy + Math.round((needle.length / span) * 40) - Math.min(first, 20);
}

/** Score one token against one document. Returns 0 for no match at all. */
function scoreToken(doc: SearchDoc, q: string): number {
  if (doc.n === q || doc.s === q) return TIER.exact;
  if (doc.n.startsWith(q)) return TIER.namePrefix;
  if (doc.s.startsWith(q)) return TIER.slugPrefix;
  if (hasWordPrefix(doc.n, q) || hasWordPrefix(doc.s, q)) return TIER.nameWord;
  if (doc.n.includes(q)) return TIER.nameSubstring;

  for (let i = 0; i < doc.k.length; i += 1) {
    // Earlier keywords are more important, but never enough to change tier.
    const decay = Math.min(i * 4, 40);
    if (hasWordPrefix(doc.k[i], q)) return TIER.keywordPrefix - decay;
  }
  for (const syn of doc.y) if (hasWordPrefix(syn, q)) return TIER.synonymPrefix;
  for (const kw of doc.k) if (kw.includes(q)) return TIER.keywordSubstring;
  for (const syn of doc.y) if (syn.includes(q)) return TIER.synonymSubstring;
  if (hasWordPrefix(doc.t, q)) return TIER.tagline;
  if (doc.category.includes(q)) return TIER.category;
  return fuzzyScore(doc.n, q) || fuzzyScore(doc.s, q);
}

/** Ranges of `query` inside `name`, for emphasis. Case- and accent-insensitive. */
function highlight(name: string, tokens: readonly string[]): [number, number][] {
  // Fold per character so an index in the folded string maps back to the
  // original. Dropping a character would shift every later index.
  const folded = [...name]
    .map((ch) => {
      const f = ch.normalize('NFKD').replace(MARKS, '').toLowerCase();
      return f.length === 1 ? f : ch.toLowerCase();
    })
    .join('');
  const found: [number, number][] = [];
  for (const token of tokens) {
    const at = folded.indexOf(token);
    if (at !== -1) found.push([at, at + token.length]);
  }
  if (found.length === 0) return found;
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [found[0]];
  for (const range of found.slice(1)) {
    const last = merged[merged.length - 1];
    if (range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export interface SearchOptions {
  /** Maximum hits. Default 8, which is what fits the palette without scrolling. */
  limit?: number;
  /** Shown when the query is empty. Default the `popular` tools. */
  fallback?: readonly SearchDoc[];
}

/**
 * Rank documents against a query.
 *
 * Multi-token queries are AND by default — "png webp" should mean both words,
 * not either. But strict AND turns a natural phrase into an empty state as soon
 * as one filler word misses ("compress my image"), and an empty state is the
 * single worst outcome for a search box, so a failed AND pass retries as OR
 * with a penalty. The user gets slightly-off results instead of nothing.
 */
export function searchTools(
  docs: readonly SearchDoc[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? 8;
  const normalised = normalise(query.slice(0, MAX_QUERY));

  if (normalised === '') {
    const base = options.fallback ?? docs.filter((doc) => doc.popular);
    return base.slice(0, limit).map((doc) => ({ doc, score: 0, ranges: [] }));
  }

  const tokens = normalised.split(' ').filter((token) => token.length > 1);
  // A single stray character still deserves a prefix search.
  if (tokens.length === 0) tokens.push(normalised);

  const rank = (requireAll: boolean): SearchHit[] => {
    const hits: SearchHit[] = [];
    for (const doc of docs) {
      let total = 0;
      let matched = 0;
      for (const token of tokens) {
        const score = scoreToken(doc, token);
        if (score > 0) {
          matched += 1;
          total += score;
        }
      }
      if (matched === 0) continue;
      if (requireAll && matched < tokens.length) continue;
      // Average so a two-word query cannot outrank a one-word exact hit purely
      // by accumulating, and penalise partial matches on the OR pass.
      const score = total / tokens.length - (matched < tokens.length ? 200 : 0);
      hits.push({ doc, score, ranges: highlight(doc.name, tokens) });
    }
    return hits;
  };

  const hits = (() => {
    const strict = rank(true);
    return strict.length > 0 ? strict : rank(false);
  })();

  const order = new Map(docs.map((doc, i) => [doc.slug, i]));
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.doc.popular !== b.doc.popular) return a.doc.popular ? -1 : 1;
    return (order.get(a.doc.slug) ?? 0) - (order.get(b.doc.slug) ?? 0);
  });
  return hits.slice(0, limit);
}

/** Group hits by category for the `/tools` page, preserving rank order. */
export function groupByCategory(hits: readonly SearchHit[]): Map<string, SearchHit[]> {
  const out = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const bucket = out.get(hit.doc.category);
    if (bucket) bucket.push(hit);
    else out.set(hit.doc.category, [hit]);
  }
  return out;
}
