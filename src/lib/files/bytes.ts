/**
 * ============================================================================
 * BYTE SIZES
 * ============================================================================
 * Formatting a byte count, and nothing else.
 *
 * ── Why this is its own module ─────────────────────────────────────────────
 * `humanBytes` started life in `tools/image/format.ts`, which is the right
 * place for it if only image tools ever need it. They do not: the PDF merger
 * reports an output size, the dropzone quotes a per-file ceiling, and the
 * upload error sentences quote both. Importing it from the image module would
 * pull ~1,700 lines of signature tables and format lookups into a bundle that
 * has no images in it, which is precisely the failure §9 of the brief calls
 * out — "a user visiting a calculator should not download libraries required
 * only for PDF processing" — with the nouns swapped.
 *
 * So the implementation lives here and `tools/image/format.ts` re-exports it.
 * One function, one behaviour, one set of tests, and a two-line module for
 * everyone who only needs the number.
 * ============================================================================
 */

/**
 * 1024-based, because that is what every operating system's file properties
 * dialogue shows, whatever the standards say about KiB. A user comparing our
 * "2.4 MB" against Finder's "2.4 MB" should see the same number.
 */
const BYTE_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * A byte count as people read it: `512 B`, `1.0 KB`, `2.4 MB`.
 *
 * Whole bytes below a kilobyte, one decimal above — enough to tell 1.2 MB from
 * 1.9 MB, not enough to imply a precision that a re-encode does not have.
 *
 * Both rounding boundaries are handled explicitly because both produce a wrong
 * unit if ignored: 1023.6 B rounds to 1024 and must read `1.0 KB` rather than
 * `1024 B`, and 1048575 B divides to 1024.0 KB and must read `1.0 MB`.
 */
export function humanBytes(n: number): string {
  if (!Number.isFinite(n)) return '0 B';
  const sign = n < 0 ? '-' : '';
  let value = Math.abs(n);
  if (value < 1024) {
    const whole = Math.round(value);
    if (whole < 1024) return `${sign}${whole} B`;
    value = whole;
  }
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  let text = value.toFixed(1);
  if (Number(text) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
    text = value.toFixed(1);
  }
  return `${sign}${text} ${BYTE_UNITS[unit]}`;
}

/**
 * A limit for prose: `30 MB`, not `30.0 MB`.
 *
 * Ceilings are round numbers by construction, and the extra `.0` in "each file
 * can be up to 30.0 MB" reads like a measurement rather than a rule. Falls back
 * to {@link humanBytes} whenever the value is not a clean multiple, so an
 * unusual limit is still reported truthfully instead of being rounded into a
 * different number.
 */
export function humanLimit(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return humanBytes(n);
  for (let unit = BYTE_UNITS.length - 1; unit >= 1; unit -= 1) {
    const scale = 1024 ** unit;
    if (n >= scale && n % scale === 0) return `${n / scale} ${BYTE_UNITS[unit]}`;
  }
  return humanBytes(n);
}
