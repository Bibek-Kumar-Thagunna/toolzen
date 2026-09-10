/**
 * ============================================================================
 * FILE NAMES
 * ============================================================================
 * Turning a name that arrived from outside into a name we are willing to put in
 * a `download` attribute.
 *
 * ── Why this is security code and not string formatting ────────────────────
 * §23 of the brief says to treat uploads as untrusted input, and a file *name*
 * is the part of an upload people forget is input. Every tool here runs in the
 * browser, so there is no server path to traverse — but the name still ends up
 * in a `download` attribute, and `download="../../autoexec.bat"` is not a
 * theoretical concern in a product that also intends to grow server-side tools
 * later. The rule this module enforces is simple and absolute: **a name is
 * never a path.** Only the final segment survives, which is what turns
 * `../../etc/passwd.png` into `passwd.png`.
 *
 * Beyond that it removes the characters that produce a file the user cannot
 * actually keep: ASCII control characters, the nine characters Windows forbids,
 * leading dots (hidden on Unix, awkward everywhere), trailing dots and spaces
 * (silently dropped by Windows, so the saved name would not be the one we
 * promised), and the MS-DOS device names that Windows still refuses.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 * It does not transliterate, slugify or ASCII-fold. Someone whose photo is
 * called `写真.png` or `vacaciones 🏖.png` gets their own name back. Almost
 * every "sanitise a filename" snippet on the internet reduces those to `.png`
 * or `file.png`, and doing that to a user's holiday photos is a bug that looks
 * like a feature.
 *
 * ── Relationship to tools/image/format.ts ──────────────────────────────────
 * `outputFileName()` there is the image-specific wrapper: it knows that an
 * unrecognised format should keep the extension the file arrived with, and that
 * the last-resort base name for a picture is `image`. It delegates the actual
 * safety work to this module, so there is exactly one sanitiser in the codebase
 * rather than one per category. Its existing test suite is what pins the shared
 * behaviour, which is why the helpers below reproduce it exactly.
 * ============================================================================
 */

/**
 * Control characters, built with `new RegExp` from escape sequences rather than
 * written as a literal class. Same matcher either way — but this file stays
 * plain ASCII, so it greps as text and a diff of it is readable. A source file
 * containing raw NUL bytes is a small trap for the next person.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

/** The nine characters Windows forbids in a name. */
const FORBIDDEN_CHARS = /[<>:"/\\|?*]/g;

/**
 * Names Windows refuses to create, because MS-DOS used them for devices and the
 * rule outlived the reason. `CON.png` is still rejected — the extension does not
 * save it — so a name that would produce a download the user cannot keep has to
 * be changed.
 */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** A base name this long is already absurd, and some filesystems cap at 255 bytes. */
export const MAX_BASE_CODE_POINTS = 200;

/**
 * Strip everything that makes a name unusable, without changing what it says.
 *
 * Whitespace collapses first, before the control-character pass: a tab between
 * two words has to become a space, not nothing, or `my\tphoto` would come back
 * as `myphoto`.
 */
export function sanitiseNamePart(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(FORBIDDEN_CHARS, '')
    .replace(/^[.\s]+/, '')
    .trim();
}

/** The final path segment, whichever separator the platform used. */
export function lastSegment(rawName: string): string {
  const raw = typeof rawName === 'string' ? rawName : '';
  const separator = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  return separator >= 0 ? raw.slice(separator + 1) : raw;
}

export interface SplitName {
  /** Everything before the extension, unsanitised. */
  base: string;
  /** Lower-cased, without the dot. Empty when there is no plausible extension. */
  extension: string;
}

/**
 * Split a name into base and extension, conservatively.
 *
 * Only one extension is removed, and only if it looks like one. `photo.tar.gz`
 * keeps its `.tar`, because that is part of the name the user chose. A trailing
 * digit group is never an extension, so `IMG_2024.123456` and `version.1.2.3`
 * keep every part of their names — real extensions start with a letter and are
 * short.
 */
export function splitName(rawName: string): SplitName {
  const segment = lastSegment(rawName);
  const dot = segment.lastIndexOf('.');
  const candidate = dot > 0 ? segment.slice(dot + 1) : '';
  const looksLikeExtension = /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(candidate);
  return looksLikeExtension
    ? { base: segment.slice(0, dot), extension: candidate.toLowerCase() }
    : { base: segment, extension: '' };
}

export interface SafeNameOptions {
  /** Appended to the base before the extension, e.g. `-compressed`. */
  suffix?: string;
  /** Used when sanitising leaves nothing behind. Sanitised itself. */
  fallback?: string;
}

/**
 * The safe base name for a download: sanitised, suffixed, capped and never
 * empty.
 *
 * The cap is applied by code point rather than by UTF-16 unit so it cannot
 * slice an emoji or any character outside the basic plane in half, which would
 * leave a lone surrogate in a filename.
 */
export function safeBaseName(rawBase: string, opts?: SafeNameOptions): string {
  const fallback = sanitiseNamePart(opts?.fallback ?? 'file') || 'file';
  let base = sanitiseNamePart(rawBase) + sanitiseNamePart(opts?.suffix ?? '');
  base = Array.from(base).slice(0, MAX_BASE_CODE_POINTS).join('');
  // Windows silently drops trailing dots and spaces, which would leave a name
  // that is not the one we said it was.
  base = base.replace(/[.\s]+$/, '');
  if (base === '') base = fallback;
  if (WINDOWS_RESERVED.has(base.toLowerCase())) base += `-${fallback}`;
  return base;
}

/**
 * A complete safe filename with the extension replaced.
 *
 * The extension is sanitised to a much stricter rule than the base: it is the
 * part an operating system uses to decide what opens the file, so anything that
 * is not a plain alphanumeric run is dropped rather than escaped.
 */
export function withExtension(rawName: string, extension: string, opts?: SafeNameOptions): string {
  const { base } = splitName(rawName);
  const safeBase = safeBaseName(base, opts);
  const safeExtension = extension
    .replace(/^\.+/, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
  return safeExtension === '' ? safeBase : `${safeBase}.${safeExtension}`;
}

/**
 * Make a list of names unique, in place order, by numbering the duplicates.
 *
 * Needed by every multi-file tool: merging two `scan.pdf` files from two
 * different folders, or batch-converting twenty phone photos that are all
 * called `image.jpg`, must not produce twenty downloads that overwrite each
 * other. The first occurrence keeps its name; later ones get ` (2)`, ` (3)`,
 * matching what a browser and both major file managers do, so the result looks
 * like something the user has seen before.
 *
 * Comparison is case-insensitive because Windows and macOS both treat
 * `Scan.pdf` and `scan.pdf` as the same file, and the download folder is where
 * that matters. The counter also re-checks its own output, so a list that
 * already contains `scan (2).pdf` does not get a second one.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const { base, extension } = splitName(name);
    const suffix = extension === '' ? '' : `.${extension}`;
    let candidate = name;
    let counter = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${base} (${counter})${suffix}`;
      counter += 1;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}
