/**
 * ============================================================================
 * A ZIP READER
 * ============================================================================
 * The counterpart to zip.ts: enough of the format to list an archive and pull
 * files out of it, including AES-encrypted entries.
 *
 * ── Why it reads the central directory and not the local headers ──────────
 * An archive can be walked from the front, header by header, and plenty of
 * code does. It is wrong in a way that only shows up on real files: an entry
 * written by a streaming program does not know its own size when its header
 * goes down, so it writes zeros and puts the real numbers in a data descriptor
 * *after* the data — which cannot be found without already knowing where the
 * data ends. Walking forwards through one of those archives reads a length of
 * zero and silently returns an empty file.
 *
 * The central directory at the end is authoritative, always complete, and is
 * what every real unzip program uses. It is found by scanning backwards for
 * the end-of-central-directory signature, which has to be done carefully
 * because that four-byte pattern can appear inside a compressed file — so the
 * scan checks that the record's own fields point somewhere sensible rather
 * than trusting the first match.
 *
 * ── What is deliberately not supported ────────────────────────────────────
 * ZIP64 (archives past 4 GB or 65,535 entries, which a browser tab cannot hold
 * anyway), and every compression method except stored and deflate. Methods
 * like bzip2, LZMA and zstd exist in the specification and appear in perhaps
 * one archive in a thousand; each is named in the error rather than producing
 * an empty file, so a user learns what happened.
 *
 * ── Safety ────────────────────────────────────────────────────────────────
 * Entry names in an archive are attacker-controlled: `../../.ssh/authorized_keys`
 * is the classic, and browsers have their own version where a name ending in
 * `.html` and opened from disk runs script. Nothing here writes to a
 * filesystem, but the names reach a download attribute, so `safeEntryName`
 * reduces every name to a single harmless segment.
 * ============================================================================
 */

import type { FailureReason } from '../analytics.ts';
import { crc32 } from './zip.ts';
import { lastSegment, sanitiseNamePart } from './name.ts';

const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
const LOCAL_HEADER_BYTES = 30;

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;
/** WinZip's AES marker. The real method is inside the 0x9901 extra field. */
export const METHOD_AES = 99;

/** Method codes worth naming when they turn up, instead of a bare number. */
const METHOD_NAMES: Readonly<Record<number, string>> = {
  1: 'shrink',
  6: 'implode',
  9: 'enhanced deflate',
  12: 'bzip2',
  14: 'LZMA',
  93: 'zstd',
  95: 'XZ',
  98: 'PPMd',
};

export interface ZipDirectoryEntry {
  /** The name as stored, which may contain slashes and anything else. */
  rawName: string;
  /** One safe segment, for a download attribute or a list. */
  name: string;
  /** True for the directory markers some programs write. */
  isDirectory: boolean;
  /** Declared compression method — 99 when the entry is AES-encrypted. */
  method: number;
  /** For an AES entry, the method to apply after decrypting. */
  innerMethod: number;
  /** AES key strength code: 1 = 128, 2 = 192, 3 = 256. Zero when not encrypted. */
  aesStrength: number;
  encrypted: boolean;
  /** True for the original, broken ZipCrypto rather than AES. */
  legacyEncryption: boolean;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  /** The entry's bytes, as stored — still compressed, still encrypted. */
  payload: Uint8Array;
}

export type ZipListResult =
  | { ok: true; entries: ZipDirectoryEntry[] }
  | { ok: false; reason: FailureReason; error: string };

export type ZipReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: FailureReason; error: string };

/**
 * A stored name reduced to one segment that is safe to hand to a browser.
 *
 * Folders are dropped rather than preserved: these files are going to a
 * download, one at a time or into a fresh archive, and a path is a suggestion
 * about someone else's disk.
 */
export function safeEntryName(rawName: string, index: number): string {
  const cleaned = sanitiseNamePart(lastSegment(rawName.replace(/\\/g, '/')));
  return cleaned === '' ? `file-${index + 1}` : cleaned;
}

/**
 * Find the end-of-central-directory record.
 *
 * Scanned from the back because the record is last, and validated because its
 * signature is four ordinary bytes that can occur by chance inside compressed
 * data. A candidate is accepted only if the directory it describes lies inside
 * the file and begins with a central header signature — which a coincidence
 * essentially never satisfies.
 */
function findEndRecord(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The comment field is 16 bits, so the record starts at most 65,557 bytes
  // from the end.
  const earliest = Math.max(0, bytes.length - END_RECORD_BYTES - 0xffff);
  for (let at = bytes.length - END_RECORD_BYTES; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) !== SIGNATURE_END) continue;
    const directoryAt = view.getUint32(at + 16, true);
    const directorySize = view.getUint32(at + 12, true);
    if (directoryAt + directorySize > bytes.length) continue;
    const count = view.getUint16(at + 10, true);
    if (count === 0) return at;
    if (directoryAt + 4 > bytes.length) continue;
    if (view.getUint32(directoryAt, true) !== SIGNATURE_CENTRAL) continue;
    return at;
  }
  return -1;
}

/** Pull the WinZip AES record out of an extra field, if it is there. */
function readAesExtra(extra: Uint8Array): { strength: number; innerMethod: number } | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (at + 4 + size > extra.length) return null;
    if (id === 0x9901 && size >= 7) {
      return {
        strength: extra[at + 4 + 4],
        innerMethod: view.getUint16(at + 4 + 5, true),
      };
    }
    at += 4 + size;
  }
  return null;
}

/**
 * List everything in an archive, with each entry's bytes located.
 *
 * The payload is a view into the caller's buffer rather than a copy, so
 * listing a 200 MB archive costs nothing until a file is actually read out.
 */
export function listZip(bytes: Uint8Array): ZipListResult {
  if (bytes.length < END_RECORD_BYTES) {
    return { ok: false, reason: 'corrupt_input', error: 'This file is too small to be a zip.' };
  }
  const endAt = findEndRecord(bytes);
  if (endAt < 0) {
    return {
      ok: false,
      reason: 'corrupt_input',
      error: 'This does not look like a zip file, or it is incomplete.',
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);

  if (count === 0xffff || view.getUint32(endAt + 12, true) === 0xffffffff) {
    return {
      ok: false,
      reason: 'unsupported_type',
      error: 'This archive uses the ZIP64 extensions, which this tool does not read.',
    };
  }

  const entries: ZipDirectoryEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + CENTRAL_HEADER_BYTES > bytes.length || view.getUint32(at, true) !== SIGNATURE_CENTRAL) {
      return { ok: false, reason: 'corrupt_input', error: 'This archive’s index is damaged.' };
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);

    const nameBytes = bytes.subarray(at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + nameLength);
    // Bit 11 promises UTF-8. Without it the name is officially CP437, but in
    // practice modern programs write UTF-8 regardless, and decoding as UTF-8
    // with replacement is closer to right than CP437 would be.
    const rawName = new TextDecoder('utf-8').decode(nameBytes);
    const extraAt = at + CENTRAL_HEADER_BYTES + nameLength;
    const extra = bytes.subarray(extraAt, extraAt + extraLength);

    // The local header's name and extra field can differ in length from the
    // central one, so the payload's position has to be read from the local
    // header rather than assumed.
    if (localAt + LOCAL_HEADER_BYTES > bytes.length) {
      return { ok: false, reason: 'corrupt_input', error: 'This archive points outside itself.' };
    }
    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const dataAt = localAt + LOCAL_HEADER_BYTES + localNameLength + localExtraLength;
    if (dataAt + compressedSize > bytes.length) {
      return { ok: false, reason: 'corrupt_input', error: 'This archive is truncated.' };
    }

    const aes = method === METHOD_AES ? readAesExtra(extra) : null;
    const encrypted = (flags & 0x0001) !== 0;
    entries.push({
      rawName,
      name: safeEntryName(rawName, i),
      isDirectory: rawName.endsWith('/') || rawName.endsWith('\\'),
      method,
      innerMethod: aes === null ? method : aes.innerMethod,
      aesStrength: aes === null ? 0 : aes.strength,
      encrypted,
      legacyEncryption: encrypted && method !== METHOD_AES,
      crc,
      compressedSize,
      uncompressedSize,
      payload: bytes.subarray(dataAt, dataAt + compressedSize),
    });

    at = extraAt + extraLength + commentLength;
  }

  return { ok: true, entries };
}

/**
 * Decompress one unencrypted entry.
 *
 * Encrypted entries do not come through here — they go to
 * `decryptAesEntry`, which needs the password and does its own inflating.
 */
export async function readZipEntry(entry: ZipDirectoryEntry): Promise<ZipReadResult> {
  if (entry.encrypted) {
    return {
      ok: false,
      reason: 'password_protected',
      error: 'This entry is encrypted and needs a password.',
    };
  }
  if (entry.method === METHOD_STORE) {
    return finish(Uint8Array.from(entry.payload), entry);
  }
  if (entry.method !== METHOD_DEFLATE) {
    const named = METHOD_NAMES[entry.method];
    return {
      ok: false,
      reason: 'unsupported_type',
      error: named
        ? `This entry is compressed with ${named}, which this tool does not read. 7-Zip does.`
        : `This entry uses compression method ${entry.method}, which this tool does not read.`,
    };
  }
  if (typeof DecompressionStream === 'undefined') {
    return {
      ok: false,
      reason: 'unsupported_type',
      error: 'This browser cannot decompress zip entries. Try a recent Chrome, Edge, Firefox or Safari.',
    };
  }
  try {
    const stream = new Blob([entry.payload as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return finish(new Uint8Array(await new Response(stream).arrayBuffer()), entry);
  } catch {
    return { ok: false, reason: 'corrupt_input', error: `“${entry.name}” could not be unpacked.` };
  }
}

/**
 * The checksum is the last gate, and it is checked rather than trusted: a
 * truncated download very often inflates to *something*, and without this the
 * user gets a file that opens to garbage instead of a message saying it
 * arrived damaged.
 */
function finish(bytes: Uint8Array, entry: ZipDirectoryEntry): ZipReadResult {
  if (entry.crc !== 0 && crc32(bytes) !== entry.crc) {
    return { ok: false, reason: 'corrupt_input', error: `“${entry.name}” did not arrive intact.` };
  }
  return { ok: true, bytes };
}
