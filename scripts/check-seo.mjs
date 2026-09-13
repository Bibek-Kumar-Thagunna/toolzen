/**
 * ============================================================================
 * ON-PAGE SEO AUDIT
 * ============================================================================
 * Runs in `npm run check`, so the build fails on a page that would compete
 * badly. The point is not to chase a score — it is that on-page discipline
 * across forty-odd pages cannot be held by memory, and the tenth tool added in
 * a hurry is the one that ships with a duplicate description.
 *
 * ── What this checks, and why each one earns its place ────────────────────
 *
 * TITLE AND DESCRIPTION LENGTH
 *   A title over ~60 characters is truncated in the result, and the truncated
 *   part is usually the distinguishing half. A description under ~120 leaves
 *   space a competitor is using to argue for the click.
 *
 * UNIQUENESS
 *   Two pages with the same title are two pages competing for the same query,
 *   and Google picks one — usually not the one you wanted. This also catches
 *   copy-paste, which is how near-duplicate pages get made.
 *
 * KEYWORD PLACEMENT
 *   The primary keyword has to appear in the title, the H1 and the description.
 *   Not as a ranking trick — as a relevance signal and, more practically,
 *   because a searcher scanning ten blue links looks for their own words. The
 *   match is normalised (case, plurals, punctuation, filler words) because
 *   "Images to PDF" is the same phrase as "image to pdf" and a checker that
 *   cannot see that generates busywork and gets switched off.
 *
 * THE MODIFIER QUERIES
 *   "free", "no watermark", "without uploading", "no sign up", "offline" are
 *   how people actually search for this category, and a badge in the header
 *   does not answer them — a search engine matches text. Every tool page must
 *   answer each of those in its own words, with its own facts, in the FAQ.
 *   This is the check that found that none of the pages did.
 *
 * NEAR-DUPLICATE ANSWERS
 *   Which creates the opposite risk: forty pages with the same four boilerplate
 *   answers is the thin-content pattern that gets a site filtered wholesale. So
 *   each answer is compared against the same answer on every other page, and
 *   too much overlap fails. This is the check that keeps the one above honest.
 *
 * DEPTH
 *   A floor, not a target. Word count is not a ranking factor; having nothing
 *   to say about the subject is. The floor is set where a page stops being able
 *   to cover its topic rather than where competitors happen to sit.
 *
 * INTERNAL LINKING
 *   Every tool must be linked from at least two others, so nothing is reachable
 *   only through the sitemap. Orphans are the pages that never get crawled
 *   often enough to rank.
 *
 * ── What this deliberately does NOT check ─────────────────────────────────
 * Keyword density, exact-match counts, or anything else from the 2011 playbook.
 * They are not ranking factors, and optimising for them produces the kind of
 * copy that reads like it was written for a machine, which is itself a signal.
 * ============================================================================
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];

function fail(where, message) {
  problems.push(`${where}: ${message}`);
}
function warn(where, message) {
  warnings.push(`${where}: ${message}`);
}

/* ── limits ────────────────────────────────────────────────────────────── */

const TITLE_MAX = 60;
const DESCRIPTION_MIN = 120;
const DESCRIPTION_MAX = 158;
/** Below this a page cannot have covered its subject. Not a target. */
const BODY_WORDS_MIN = 250;
const FAQ_MIN = 4;
/** Two pages should not share more than this fraction of an answer's wording. */
const MAX_ANSWER_OVERLAP = 0.6;
/** Every tool must be linked from at least this many other tool pages. */
const INBOUND_LINKS_MIN = 2;

/**
 * The query shapes people actually type, and what counts as answering one.
 *
 * Each needs at least one FAQ question *or* answer that matches. The patterns
 * are generous — this is checking that the subject is addressed somewhere on
 * the page, not policing phrasing.
 */
const MODIFIERS = [
  {
    id: 'free',
    why: '"free <tool>" is the highest-volume modifier in this category',
    pattern: /\b(free|cost|charge|pay|paid|price|subscription|trial)\b/i,
  },
  {
    id: 'watermark',
    why: '"no watermark" is what people add after being burned by a competitor',
    pattern: /\bwatermark/i,
    // Only where it is a real question. Nobody searches for a percentage
    // calculator without a watermark, and writing the word onto that page to
    // satisfy a checker is the keyword stuffing this file refuses to do. The
    // test is whether the tool hands back a file: that is when a competitor
    // has something to brand, and when the searcher has been burned before.
    appliesTo: (tool) =>
      tool.surface === 'files' ||
      /\bdownload/i.test(
        [...tool.howTo.steps, ...tool.features.map((feature) => feature.body)].join(' '),
      ),
  },
  {
    id: 'signup',
    why: '"without signing up" / "no account" / "no email"',
    pattern: /\b(sign[- ]?up|signing up|account|register|log[- ]?in|email address)\b/i,
  },
  {
    id: 'upload',
    why: '"without uploading" / "offline" / "is it safe" — the privacy query',
    pattern: /\b(upload|uploaded|offline|server|private|privacy|leave your device)\b/i,
  },
  {
    id: 'limit',
    why: '"unlimited" / "file size limit" / "how many"',
    pattern: /\b(limit|maximum|how many|how large|how big|size|unlimited|batch)\b/i,
  },
];

/* ── normalising, so the keyword check is not pedantic ─────────────────── */

/** Words that carry no matching value and differ freely between phrasings. */
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'your', 'my',
  'online', 'free', 'tool', 'converter', 'convert', 'with', 'into', 'from',
]);

/** Crude but sufficient: the plurals that actually occur in tool names. */
function singular(word) {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && /(s|x|z|ch|sh)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.length > 2 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** A phrase reduced to its meaningful stems, in order. */
function stems(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '' && !FILLER.has(word))
    .map(singular);
}

/**
 * Is `phrase` present in `text`, allowing for plurals, punctuation, case and
 * filler words — but requiring the meaningful words in the same order?
 *
 * Order matters: "pdf to image" and "image to pdf" are different tools, and a
 * bag-of-words match would call them the same.
 */
function containsPhrase(text, phrase) {
  const want = stems(phrase);
  if (want.length === 0) return true;
  const have = stems(text);
  for (let at = 0; at + want.length <= have.length; at += 1) {
    let all = true;
    for (let i = 0; i < want.length; i += 1) {
      if (have[at + i] !== want[i]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Jaccard overlap of the word sets — enough to spot copy-paste. */
function overlap(a, b) {
  const left = new Set(stems(a));
  const right = new Set(stems(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/* ── load the registry ─────────────────────────────────────────────────── */

const { tools, guides } = await import(join(root, 'src/lib/registry/index.ts'));

if (!Array.isArray(tools) || tools.length === 0) {
  console.error('check-seo: no tools found — has the registry moved?');
  process.exit(1);
}

/* ── per-page checks ───────────────────────────────────────────────────── */

for (const tool of tools) {
  const where = `${tool.slug}`;

  if (tool.metaTitle.length > TITLE_MAX) {
    fail(where, `metaTitle is ${tool.metaTitle.length} chars; over ${TITLE_MAX} is truncated in the result`);
  }
  if (tool.metaDescription.length > DESCRIPTION_MAX) {
    fail(where, `metaDescription is ${tool.metaDescription.length} chars; over ${DESCRIPTION_MAX} is truncated`);
  }
  if (tool.metaDescription.length < DESCRIPTION_MIN) {
    fail(where, `metaDescription is only ${tool.metaDescription.length} chars; under ${DESCRIPTION_MIN} wastes space a competitor is using`);
  }

  // Placement of the phrase the page is built to answer.
  if (!containsPhrase(tool.metaTitle, tool.primaryKeyword)) {
    fail(where, `metaTitle does not contain the primary keyword "${tool.primaryKeyword}"`);
  }
  if (!containsPhrase(tool.h1, tool.primaryKeyword)) {
    fail(where, `h1 does not contain the primary keyword "${tool.primaryKeyword}"`);
  }
  if (!containsPhrase(tool.metaDescription, tool.primaryKeyword)) {
    fail(where, `metaDescription does not contain the primary keyword "${tool.primaryKeyword}"`);
  }
  // The first paragraph on the page, and the text Google most often lifts when
  // it rewrites a description. Worth carrying the phrase — but only when the
  // H1 directly above it does not already, because "An age calculator that…"
  // sitting under a heading reading "Age calculator" is repetition a reader
  // notices and a search engine does not reward. This is a warning rather than
  // an error for the same reason: there are pages where the natural sentence
  // does not contain the phrase and forcing it in makes the page worse.
  if (
    !containsPhrase(tool.tagline, tool.primaryKeyword) &&
    !containsPhrase(tool.h1, tool.primaryKeyword)
  ) {
    warn(where, `neither the H1 nor the tagline contains "${tool.primaryKeyword}"`);
  }

  if (tool.faq.length < FAQ_MIN) {
    fail(where, `${tool.faq.length} FAQ entries; ${FAQ_MIN} is the floor for a FAQPage worth marking up`);
  }

  const bodyWords = tool.content.flatMap((section) => section.body).join(' ').split(/\s+/).length;
  if (bodyWords < BODY_WORDS_MIN) {
    fail(where, `${bodyWords} words of body copy; under ${BODY_WORDS_MIN} the page cannot have covered its subject`);
  }

  // The modifier queries.
  const faqText = tool.faq.map((item) => `${item.q} ${item.a}`).join(' ');
  for (const modifier of MODIFIERS) {
    if (modifier.appliesTo && !modifier.appliesTo(tool)) continue;
    if (!modifier.pattern.test(faqText)) {
      fail(where, `no FAQ answers the "${modifier.id}" query — ${modifier.why}`);
    }
  }

  // Cross-links out. `related` is topped up automatically at render time, but
  // a hand-picked list is what makes the anchor text meaningful.
  if (tool.related.length < 3) {
    fail(where, `only ${tool.related.length} hand-picked related tools; 3 is the floor`);
  }
  for (const slug of tool.related) {
    if (!tools.some((other) => other.slug === slug)) {
      fail(where, `related tool "${slug}" does not exist`);
    }
    if (slug === tool.slug) fail(where, 'related links to itself');
  }
}

/* ── site-wide checks ──────────────────────────────────────────────────── */

function duplicates(field) {
  const seen = new Map();
  for (const tool of tools) {
    const value = tool[field].trim().toLowerCase();
    const first = seen.get(value);
    if (first !== undefined) {
      fail(tool.slug, `${field} is identical to ${first}'s — they will compete for the same query`);
    } else {
      seen.set(value, tool.slug);
    }
  }
}
duplicates('metaTitle');
duplicates('metaDescription');
duplicates('h1');
duplicates('primaryKeyword');

/**
 * Near-duplicate FAQ answers.
 *
 * The modifier check above pushes every page to answer the same five
 * questions, and the lazy way to satisfy it is to paste the same five answers
 * onto forty pages. That is the thin-content pattern, so it is checked for
 * directly: each page's answer to a given question is compared with every other
 * page's, and heavy overlap fails.
 */
const byModifier = new Map(MODIFIERS.map((modifier) => [modifier.id, []]));
for (const tool of tools) {
  for (const modifier of MODIFIERS) {
    if (modifier.appliesTo && !modifier.appliesTo(tool)) continue;
    const match = tool.faq.find((item) => modifier.pattern.test(`${item.q} ${item.a}`));
    if (match) byModifier.get(modifier.id).push({ slug: tool.slug, text: match.a });
  }
}
for (const [id, answers] of byModifier) {
  for (let i = 0; i < answers.length; i += 1) {
    for (let j = i + 1; j < answers.length; j += 1) {
      const score = overlap(answers[i].text, answers[j].text);
      if (score > MAX_ANSWER_OVERLAP) {
        fail(
          answers[i].slug,
          `its "${id}" answer is ${Math.round(score * 100)}% the same as ${answers[j].slug}'s — forty pages of boilerplate is the thin-content pattern`,
        );
      }
    }
  }
}

/** Inbound links, so nothing is reachable only from the sitemap. */
const inbound = new Map(tools.map((tool) => [tool.slug, 0]));
for (const tool of tools) {
  for (const slug of tool.related) {
    if (inbound.has(slug)) inbound.set(slug, inbound.get(slug) + 1);
  }
}
for (const [slug, count] of inbound) {
  if (count < INBOUND_LINKS_MIN) {
    fail(slug, `linked from only ${count} other tool${count === 1 ? '' : 's'}; an orphan page is crawled rarely and ranks accordingly`);
  }
}

/** Synonyms feed the on-site search, and a tool with none is unfindable there. */
for (const tool of tools) {
  if (tool.synonyms.length < 4) {
    warn(tool.slug, `${tool.synonyms.length} synonyms — these power the site search, not the meta tags`);
  }
  if (tool.secondaryKeywords.length < 3) {
    warn(tool.slug, `${tool.secondaryKeywords.length} secondary keywords`);
  }
}

/** Nothing in a meta tag should look machine-written. */
for (const tool of tools) {
  if (/\|/.test(tool.metaTitle)) {
    warn(tool.slug, 'metaTitle uses a pipe; the site appends its own separator');
  }
  // Stuffing is the *phrase* repeating, not its first word. "Convert text
  // between lowercase, UPPERCASE, Title Case and Sentence case" uses "case"
  // four times and is a list, not an optimisation; an earlier version of this
  // check flagged it, which is how a linter teaches people to ignore it.
  const phrase = stems(tool.primaryKeyword);
  // A keyword that reduces to a single stem — "case converter", where
  // "converter" is filler — is just a common noun, and counting it measures
  // nothing. Two stems or more, or the check does not apply.
  if (phrase.length < 2) continue;
  const inDescription = stems(tool.metaDescription);
  let repeats = 0;
  for (let at = 0; at + phrase.length <= inDescription.length; at += 1) {
    if (phrase.every((word, i) => inDescription[at + i] === word)) repeats += 1;
  }
  if (repeats > 1) {
    warn(tool.slug, `"${tool.primaryKeyword}" appears ${repeats} times in the description — once is the signal, twice is stuffing`);
  }
}

/* ── the static pages have titles too ──────────────────────────────────── */

const APP_DIR = join(root, 'src/app');
function pagesWithoutMetadata(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      pagesWithoutMetadata(path, out);
    } else if (entry.name === 'page.tsx') {
      const src = readFileSync(path, 'utf8');
      if (!/export const metadata|generateMetadata/.test(src)) {
        out.push(path.slice(root.length + 1));
      }
    }
  }
  return out;
}
for (const page of pagesWithoutMetadata(APP_DIR)) {
  fail(page, 'no metadata export — this page ships with no title or description');
}

/* ── guides ────────────────────────────────────────────────────────────── */

/**
 * The guides are held to the same floors as the tool pages, plus two of their
 * own.
 *
 * They exist because the SERPs they target are full of thin pages, so shipping
 * a thin page of our own would be self-defeating in a way that is easy to do
 * and hard to notice: a guide has no widget to make it obviously useful, which
 * means nothing about the page complains when the prose is filler.
 *
 * `answer` is length-checked in both directions. Too short and it is a
 * restatement of the title rather than an answer; too long and it is no longer
 * the thing a reader can take in before deciding whether to stay, which is its
 * only job.
 *
 * `sources` is required because the entire competitive argument for these
 * pages is that they are checkable where the alternatives are vague. A guide
 * making technical claims with nothing to check them against is the format
 * this section was created to beat.
 */
const ANSWER_MIN_WORDS = 30;
const ANSWER_MAX_WORDS = 120;
const GUIDE_BODY_WORDS_MIN = 500;

for (const guide of guides) {
  const where = `guides/${guide.slug}`;

  if (guide.metaTitle.length > TITLE_MAX) {
    fail(where, `metaTitle is ${guide.metaTitle.length} chars; over ${TITLE_MAX} is truncated in the result`);
  }
  if (guide.metaDescription.length > DESCRIPTION_MAX) {
    fail(where, `metaDescription is ${guide.metaDescription.length} chars; over ${DESCRIPTION_MAX} is truncated`);
  }
  if (guide.metaDescription.length < DESCRIPTION_MIN) {
    fail(where, `metaDescription is only ${guide.metaDescription.length} chars; under ${DESCRIPTION_MIN} wastes space a competitor is using`);
  }

  if (!containsPhrase(guide.title, guide.primaryKeyword)) {
    fail(where, `the H1 does not contain the primary keyword ${guide.primaryKeyword}`);
  }
  if (!containsPhrase(`${guide.metaTitle} ${guide.metaDescription}`, guide.primaryKeyword)) {
    fail(where, `neither metaTitle nor metaDescription contains ${guide.primaryKeyword}`);
  }

  const answerWords = guide.answer.trim().split(/\s+/).length;
  if (answerWords < ANSWER_MIN_WORDS) {
    fail(where, `the short answer is ${answerWords} words; under ${ANSWER_MIN_WORDS} it restates the title instead of answering it`);
  }
  if (answerWords > ANSWER_MAX_WORDS) {
    fail(where, `the short answer is ${answerWords} words; over ${ANSWER_MAX_WORDS} it is no longer something a reader takes in at a glance`);
  }

  const bodyWords = guide.body
    .flatMap((section) => section.body)
    .join(' ')
    .split(/\s+/).length;
  if (bodyWords < GUIDE_BODY_WORDS_MIN) {
    fail(where, `${bodyWords} words of body copy; under ${GUIDE_BODY_WORDS_MIN} this is one more thin page in a SERP made of thin pages`);
  }

  if (guide.faq.length < FAQ_MIN) {
    fail(where, `${guide.faq.length} FAQ entries; ${FAQ_MIN} is the floor for a FAQPage worth marking up`);
  }
  if (guide.sources.length === 0) {
    fail(where, 'no sources — a guide making technical claims must name what they can be checked against');
  }
  if (guide.tools.length === 0) {
    fail(where, 'links to no tool; a guide that cannot hand the reader a fix is an article, not a guide');
  }
  for (const slug of guide.tools) {
    if (!tools.some((tool) => tool.slug === slug)) {
      fail(where, `hands off to ${slug}, which is not a tool`);
    }
  }
  for (const slug of guide.related) {
    if (slug === guide.slug) fail(where, 'related links to itself');
    if (!guides.some((entry) => entry.slug === slug)) {
      fail(where, `related guide ${slug} does not exist`);
    }
  }
}

/** Guides compete with each other if their answers say the same thing. */
for (let i = 0; i < guides.length; i += 1) {
  for (let j = i + 1; j < guides.length; j += 1) {
    const a = guides[i];
    const b = guides[j];
    const shared = overlap(a.answer, b.answer);
    if (shared > MAX_ANSWER_OVERLAP) {
      fail(
        `guides/${a.slug}`,
        `its short answer is ${Math.round(shared * 100)}% the same as ${b.slug}'s — two pages answering one question compete with each other`,
      );
    }
  }
}

/* ── report ────────────────────────────────────────────────────────────── */

console.log(`Audited ${tools.length} tool pages and ${guides.length} guides.`);
if (warnings.length > 0) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const warning of warnings) console.log(`  · ${warning}`);
}
if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('\nERRORS: none');
