/**
 * ============================================================================
 * PAGE RANGES
 * ============================================================================
 * Turn `1-3, 7, 12-` into a list of page numbers.
 *
 * ── Why this is its own module with its own tests ─────────────────────────
 * It is the single most error-prone piece of the split tool and the only part
 * of it that can be tested without a browser or a real PDF. Off-by-one is the
 * whole risk: users count pages from 1, arrays index from 0, and a parser that
 * gets that wrong hands somebody the wrong page of a contract without ever
 * failing visibly. So the parser speaks 1-based page numbers throughout — the
 * numbers on screen and the numbers a user typed — and converting to indices is
 * one explicit step at the call site.
 *
 * ── What it accepts ───────────────────────────────────────────────────────
 * Commas or whitespace between items; hyphen, en dash or em dash inside a
 * range, because a pasted range from a word processor has been autocorrected to
 * an en dash and refusing it teaches nothing. `5-` means "5 to the end" and
 * `-5` means "start to 5", both of which people write without thinking.
 * Descending ranges (`9-3`) are read as the range they obviously mean rather
 * than rejected.
 *
 * ── What it refuses, and why refusing beats guessing ──────────────────────
 * A page number past the end of the document is an error, not something to
 * silently clamp. Somebody who typed `1-50` on a 12-page file has misremembered
 * which file they opened, and quietly handing back 12 pages hides that. The
 * message says how many pages there actually are.
 *
 * Duplicates and overlaps are collapsed, and the result is sorted: asking for
 * `3, 1-5, 3` means pages 1 to 5, once each, in order. Preserving the typed
 * order would let a user build `3,1,2` and expect a reordered document, which
 * is a different feature (and one this tool does not claim).
 * ============================================================================
 */

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/** Hyphen-minus, en dash, em dash and the non-breaking hyphen all mean "to". */
const DASH = /[-‐‑‒–—]/;

const SEPARATOR = /[\s,;]+/;

/**
 * Parse a range expression against a document of `pageCount` pages.
 *
 * Returns 1-based page numbers, ascending, with no duplicates. An empty
 * expression is an error rather than "everything": a blank box is far more
 * likely to be an oversight than a deliberate request for the whole document,
 * and the caller has a cheaper way to say "all".
 */
export function parsePageRanges(input: string, pageCount: number): RangeResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: 'That document has no pages to choose from.' };
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: `Enter which pages you want — for example 1-3, 5 or 8- for page 8 onwards.` };
  }

  const pages = new Set<number>();

  for (const rawPart of trimmed.split(SEPARATOR)) {
    const part = rawPart.trim();
    if (part === '') continue;

    // `split` on the dash rather than a regex match, so `3-7` and `3–7` take
    // the same path and a stray second dash (`3--7`) is caught as malformed
    // rather than silently reinterpreted.
    const bits = part.split(DASH);

    if (bits.length === 1) {
      const single = toPageNumber(bits[0] ?? '');
      if (single === null) return { ok: false, error: malformed(part) };
      if (single > pageCount) return { ok: false, error: outOfRange(single, pageCount) };
      pages.add(single);
      continue;
    }

    if (bits.length !== 2) return { ok: false, error: malformed(part) };

    const [fromText = '', toText = ''] = bits;
    // An open end on either side: `5-` is "5 to the end", `-5` is "up to 5".
    const from = fromText.trim() === '' ? 1 : toPageNumber(fromText);
    const to = toText.trim() === '' ? pageCount : toPageNumber(toText);
    if (from === null || to === null) return { ok: false, error: malformed(part) };

    const high = Math.max(from, to);
    if (high > pageCount) return { ok: false, error: outOfRange(high, pageCount) };

    // Descending is read as the range it obviously means.
    for (let page = Math.min(from, to); page <= high; page += 1) pages.add(page);
  }

  if (pages.size === 0) return { ok: false, error: malformed(trimmed) };

  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}

/** A positive whole number, or null. Rejects `1.5`, `0`, `-2`, `1e3` and `abc`. */
function toPageNumber(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const page = Number(value);
  return page >= 1 ? page : null;
}

function malformed(part: string): string {
  return `“${part}” is not a page range. Use numbers and ranges, like 1-3, 5, 8-.`;
}

function outOfRange(page: number, pageCount: number): string {
  return `Page ${page} does not exist — this document has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`;
}

/**
 * Group consecutive pages for display: `[1,2,3,7,9,10]` → `"1-3, 7, 9-10"`.
 *
 * The inverse of the parser, used to echo a selection back. Showing "6 pages"
 * alone leaves a user unsure whether their expression did what they meant;
 * showing the normalised form makes a typo obvious before they press the button.
 */
export function describePages(pages: readonly number[]): string {
  if (pages.length === 0) return 'no pages';

  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0] as number;
  let previous = start;

  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current !== undefined && current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    if (current === undefined) break;
    start = current;
    previous = current;
  }

  return parts.join(', ');
}
