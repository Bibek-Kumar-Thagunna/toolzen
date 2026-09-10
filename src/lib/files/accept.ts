/**
 * ============================================================================
 * ACCEPTING FILES
 * ============================================================================
 * The check that runs the moment a file is dropped, before anything is decoded.
 *
 * ── What this is, and what it is not ───────────────────────────────────────
 * This is a **courtesy filter**, not a security boundary, and the distinction
 * matters enough to state at the top of the file.
 *
 * `File.type` is not evidence. It comes from the operating system's extension
 * mapping, so it is empty on Linux for anything the desktop environment does not
 * know, it is `image/x-png` on some Windows installs, and it is trivially
 * changed by renaming the file. Deciding what a file *is* from its declared type
 * would be exactly the mistake §23 of the brief warns about.
 *
 * So the division of labour is:
 *
 *   - This module answers "should I even try?" — instantly, with no I/O, so the
 *     user gets a specific sentence about the file they just dropped instead of
 *     a spinner followed by a generic failure.
 *   - The engine answers "what is this?" — from the actual bytes.
 *     `sniffImage()` reads the magic number, `isFormatMismatch()` reports a
 *     `.png` that is really a JPEG, and the PDF reader validates the header.
 *     Those are the real gate, and they run regardless of what this said.
 *
 * A file that passes here and fails there is normal and handled. A file that
 * fails here never wastes the user's time.
 *
 * ── Why matching is MIME *or* extension ────────────────────────────────────
 * Either alone rejects files that plainly work. MIME alone fails on the Linux
 * desktop where `type` is `''`; extension alone fails for a camera export with
 * no extension at all, and for a file pasted from the clipboard, which arrives
 * as `image.png` only because the browser invented that name. Accepting either
 * signal keeps the false-rejection rate near zero, and false *acceptance* costs
 * nothing because the engine sniffs anyway.
 * ============================================================================
 */
import type { FailureReason } from '../analytics.ts';
import type { AcceptSpec } from '../registry/types.ts';
import { humanLimit } from './bytes.ts';
import { lastSegment, sanitiseNamePart, splitName } from './name.ts';

/** The subset of `File` this module needs. Keeps it testable in Node. */
export interface FileLike {
  name: string;
  size: number;
  /** The browser's guess. May be `''`. Never trusted, only consulted. */
  type: string;
}

/** Why a file was turned away. A subset of the analytics failure vocabulary. */
export type RejectReason = Extract<
  FailureReason,
  'unsupported_type' | 'too_large' | 'too_many_files' | 'corrupt_input'
>;

export interface Rejection {
  reason: RejectReason;
  /** A complete sentence for the user. Names the file and says what to do. */
  error: string;
}

export type FileCheck = { ok: true } | ({ ok: false } & Rejection);

/**
 * The `accept` attribute for a file input.
 *
 * The registry already stores the list in the attribute's own format — MIME
 * types and dotted extensions, mixed — because that is what browsers want and
 * inventing a second representation to convert between would only create a way
 * for the two to disagree.
 */
export function acceptAttribute(spec: AcceptSpec): string {
  return spec.mime.join(',');
}

/**
 * The file's name as it can safely appear in a message.
 *
 * A name arrived from outside and is about to be interpolated into a sentence
 * shown on the page. React escapes it, so this is not about markup — it is about
 * a 400-character name from a Windows path destroying the layout of an error
 * message, and about control characters making the sentence unreadable.
 */
export function describeFile(name: string): string {
  const clean = sanitiseNamePart(lastSegment(name));
  const trimmed = Array.from(clean).slice(0, 60).join('');
  return trimmed === '' ? 'That file' : `“${trimmed}”`;
}

/**
 * Whether the file matches one entry of the accept list, by declared type or by
 * extension. `image/*` wildcards are honoured because the attribute supports
 * them and a spec is free to use one.
 */
export function matchesAccept(file: FileLike, spec: AcceptSpec): boolean {
  const declared = file.type.trim().toLowerCase();
  const { extension } = splitName(file.name);
  for (const entry of spec.mime) {
    const token = entry.trim().toLowerCase();
    if (token === '') continue;
    // A wildcard means the tool genuinely takes anything — Base64 encodes bytes,
    // and every byte sequence is valid input. It has to be checked before the
    // `declared === ''` guard below, or a file the OS could not classify would
    // be refused by the one spec that refuses nothing.
    if (token === '*' || token === '*/*') return true;
    if (token.startsWith('.')) {
      if (extension !== '' && `.${extension}` === token) return true;
      continue;
    }
    if (declared === '') continue;
    if (token.endsWith('/*')) {
      if (declared.startsWith(token.slice(0, -1))) return true;
      continue;
    }
    if (declared === token) return true;
  }
  return false;
}

/**
 * Check one file against the spec.
 *
 * Order is deliberate: emptiness, then size, then type. An empty file is
 * reported as empty rather than as the wrong type, because that is what it is —
 * usually an interrupted download or, on some browsers, a folder that was
 * dropped instead of a file. A 200 MB file is reported as too large even if its
 * extension is also wrong, because the size is the thing the user can act on.
 */
export function checkFile(file: FileLike, spec: AcceptSpec): FileCheck {
  const label = describeFile(file.name);

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      ok: false,
      reason: 'corrupt_input',
      error: `${label} is empty. If you dropped a folder, open it and pick the files inside.`,
    };
  }

  if (spec.maxBytes > 0 && file.size > spec.maxBytes) {
    return {
      ok: false,
      reason: 'too_large',
      error: `${label} is larger than ${humanLimit(spec.maxBytes)}, which is as much as this tool can handle in one go.`,
    };
  }

  if (!matchesAccept(file, spec)) {
    return {
      ok: false,
      reason: 'unsupported_type',
      error: `${label} is not a supported file. This tool works with ${spec.label}.`,
    };
  }

  return { ok: true };
}

export interface BatchRejection<T> extends Rejection {
  file: T;
}

export interface BatchResult<T> {
  /** Files to add to the queue, in the order they arrived. */
  accepted: T[];
  rejected: BatchRejection<T>[];
  /** One sentence for the UI, or `null` when nothing was turned away. */
  message: string | null;
  /**
   * The single code to report to analytics. The dominant reason, tie-broken by
   * first occurrence — reporting the *first* rejection would blame one stray
   * unsupported file for a drop of twenty oversized ones.
   */
  reason: RejectReason | null;
}

const files = (n: number): string => (n === 1 ? '1 file' : `${n} files`);

/**
 * Check a whole drop, apply the file-count cap, and produce one message.
 *
 * ── Partial acceptance is the point ────────────────────────────────────────
 * Dropping twenty-five photos into a twenty-file tool adds twenty and says so.
 * Rejecting the entire drop because of the last five would make the user redo
 * the selection, which is the kind of small cruelty that makes people leave.
 *
 * The cap is applied *after* per-file validation, so an unsupported file cannot
 * consume a slot that a usable one needed.
 */
export function checkBatch<T extends FileLike>(
  incoming: readonly T[],
  spec: AcceptSpec,
  opts?: { existing?: number },
): BatchResult<T> {
  const existing = Math.max(0, Math.trunc(opts?.existing ?? 0));
  const cap = spec.maxFiles > 0 ? spec.maxFiles : Number.MAX_SAFE_INTEGER;
  const room = Math.max(0, cap - existing);

  const passed: T[] = [];
  const rejected: BatchRejection<T>[] = [];

  for (const file of incoming) {
    const check = checkFile(file, spec);
    if (check.ok) passed.push(file);
    else rejected.push({ file, reason: check.reason, error: check.error });
  }

  const accepted = passed.slice(0, room);
  for (const file of passed.slice(room)) {
    rejected.push({
      file,
      reason: 'too_many_files',
      error:
        cap === 1
          ? `This tool works on one file at a time, so ${describeFile(file.name)} was not added.`
          : `This tool takes up to ${cap} files at a time, so ${describeFile(file.name)} was not added.`,
    });
  }

  return { accepted, rejected, message: summarise(rejected, spec, cap), reason: dominant(rejected) };
}

function dominant<T>(rejected: readonly BatchRejection<T>[]): RejectReason | null {
  if (rejected.length === 0) return null;
  const counts = new Map<RejectReason, number>();
  for (const item of rejected) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  let best = rejected[0].reason;
  let bestCount = 0;
  // Iterating the rejections rather than the Map keeps the tie-break on first
  // occurrence: insertion order of a Map is by first write, which is the same
  // thing, but relying on that would be relying on a detail.
  for (const item of rejected) {
    const count = counts.get(item.reason) ?? 0;
    if (count > bestCount) {
      best = item.reason;
      bestCount = count;
    }
  }
  return best;
}

/**
 * One sentence covering every rejection.
 *
 * A single rejection gets its own specific sentence, naming the file. Several
 * rejections for the same reason get one grouped sentence, because five
 * identical messages stacked up is noise, not information. A mixed batch gets
 * the most specific sentence available plus an honest count of the rest —
 * writing "some files were skipped" and leaving the user to guess which, or why,
 * is the version of this that gets a support email.
 */
function summarise<T>(
  rejected: readonly BatchRejection<T>[],
  spec: AcceptSpec,
  cap: number,
): string | null {
  if (rejected.length === 0) return null;
  if (rejected.length === 1) return rejected[0].error;

  const reasons = new Set(rejected.map((item) => item.reason));
  const count = rejected.length;

  if (reasons.size === 1) {
    switch (rejected[0].reason) {
      case 'too_large':
        return `${files(count)} were skipped — each one is larger than ${humanLimit(spec.maxBytes)}.`;
      case 'unsupported_type':
        return `${files(count)} were skipped because this tool works with ${spec.label}.`;
      case 'corrupt_input':
        return `${files(count)} were skipped because they are empty.`;
      case 'too_many_files':
        return `${files(count)} were not added — this tool takes up to ${cap} at a time.`;
    }
  }

  return `${rejected[0].error} ${files(count - 1)} were skipped as well.`;
}
