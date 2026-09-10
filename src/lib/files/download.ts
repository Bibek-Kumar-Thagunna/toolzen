/**
 * Handing a finished file to the user. Browser-only, and deliberately the only
 * module that is.
 *
 * Everything else in `src/lib` is isomorphic and unit-tested; this is the one
 * place that has to touch `document` and `URL.createObjectURL`, so it is kept
 * small enough to read in one sitting and it degrades the way every other
 * module does — a `{ ok: false }` with a sentence written for a person, never a
 * thrown exception reaching a click handler.
 *
 * Three details here are the difference between a download that works and one
 * that works on the reviewer's laptop only:
 *
 * - The object URL is revoked on a timer, not immediately after `click()`.
 *   Safari starts the download asynchronously, and revoking in the same tick
 *   cancels it. Never revoking it pins the whole file in memory, which for a
 *   twenty-photo batch is the difference between a working tab and a killed one.
 * - The anchor is appended to the document before clicking. Firefox ignores a
 *   click on an element that is not in the tree.
 * - `download` carries the sanitised name from `name.ts`. A browser will happily
 *   accept a name the operating system then refuses to write.
 */

import type { FailureReason } from '../analytics.ts';
import { lastSegment, sanitiseNamePart, withExtension } from './name.ts';
import { writeZip, type ZipEntry } from './zip.ts';

export type DeliveryResult = { ok: true; name: string } | { ok: false; reason: FailureReason; error: string };

/**
 * The generic failure. A download can only fail here for reasons the user cannot
 * do anything about — a revoked permission, a tab being torn down — so the
 * sentence offers the one thing that does help.
 */
const FAILED =
  'The download could not be started. Trying again usually works; the file is still here either way.';

const NO_BROWSER =
  'Downloads need to run in a browser tab. Reload the page and try again — nothing was sent anywhere.';

/** How long the object URL stays alive after the click. Generous, and still nothing. */
const REVOKE_AFTER_MS = 60_000;

function hasBrowser(): boolean {
  return typeof document !== 'undefined' && typeof URL.createObjectURL === 'function';
}

/**
 * The name a browser will accept and an operating system will keep. Path
 * segments and forbidden characters are stripped; an unusable name falls back
 * rather than producing a file called `.` that the user cannot find.
 */
export function safeDownloadName(rawName: string, fallback = 'download'): string {
  const cleaned = sanitiseNamePart(lastSegment(rawName));
  return cleaned === '' ? fallback : cleaned;
}

/**
 * Name for a batch archive: `compressed-images.zip` rather than
 * `download-1725384000000.zip`, because the user will look for it later.
 */
export function archiveName(label: string): string {
  return withExtension(label, 'zip', { fallback: 'files' });
}

/** Deliver a blob under a given name. */
export function downloadBlob(blob: Blob, rawName: string): DeliveryResult {
  if (!hasBrowser()) return { ok: false, reason: 'unknown', error: NO_BROWSER };
  const name = safeDownloadName(rawName);
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    // Firefox ignores a click on a detached element, and the anchor must not be
    // visible or focusable while it is in the tree.
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    revokeLater(url);
    return { ok: true, name };
  } catch {
    if (url !== null) URL.revokeObjectURL(url);
    return { ok: false, reason: 'unknown', error: FAILED };
  }
}

function revokeLater(url: string): void {
  // A timer, not the same tick: Safari begins the transfer asynchronously and
  // revoking immediately cancels it. Sixty seconds is long enough for any disk
  // and short enough that a twenty-photo batch does not stay resident.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
}

/** Deliver raw bytes — an encoded image, a generated PDF — under a given name. */
export function downloadBytes(bytes: Uint8Array, rawName: string, mime: string): DeliveryResult {
  // A fresh copy of the buffer, because `bytes` may be a view onto a larger
  // scratch buffer that the caller reuses for the next file.
  const blob = new Blob([bytes.slice()], { type: mime });
  return downloadBlob(blob, rawName);
}

/**
 * Deliver text. The BOM is deliberate for CSV only: Excel reads a UTF-8 CSV
 * without one as the local code page and mangles every accented name in it.
 */
export function downloadText(
  value: string,
  rawName: string,
  opts?: { mime?: string; bom?: boolean },
): DeliveryResult {
  const mime = opts?.mime ?? 'text/plain;charset=utf-8';
  const body = opts?.bom === true ? `\uFEFF${value}` : value;
  return downloadBlob(new Blob([body], { type: mime }), rawName);
}

/**
 * Deliver several results as one archive.
 *
 * The alternative — a click per file — is not one: browsers treat a burst of
 * programmatic downloads as suspicious, so the user would get one file out of
 * twenty and no explanation. See `zip.ts` for why the archive is stored rather
 * than deflated.
 */
export function downloadZip(entries: readonly ZipEntry[], label: string): DeliveryResult {
  const archive = writeZip(entries);
  if (!archive.ok) return archive;
  return downloadBytes(archive.bytes, archiveName(label), 'application/zip');
}
