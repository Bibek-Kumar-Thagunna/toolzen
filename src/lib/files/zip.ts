/**
 * A minimal ZIP writer, so a batch tool can offer one "Download all" button.
 *
 * Why this exists at all: several tools accept up to twenty files and return
 * twenty results. The alternative to a ZIP is clicking `<a download>` once per
 * file, and browsers treat a burst of programmatic downloads as suspicious —
 * Chrome prompts, Safari drops all but the first, and mobile Safari does
 * nothing useful at all. A "Download all" that silently delivers one file out
 * of twenty is exactly the fake UI the product must not ship, so the archive is
 * built here instead.
 *
 * Why not a library: this file is the whole feature, and a general ZIP package
 * brings streaming, encryption, ZIP64 and directory trees that a flat archive
 * of results never touches.
 *
 * Stored, not deflated. Every entry is written with method 0. The results being
 * archived are JPEG, PNG, WebP and PDF — already-compressed formats where
 * deflate spends CPU to save low single-digit percentages, and where the CPU is
 * the user's phone. It also keeps this module pure and synchronous: raw deflate
 * would have to be injected, because `CompressionStream('deflate-raw')` is
 * async and is not available in every browser the site supports.
 *
 * Correctness notes, since a malformed archive is worse than no archive: the
 * UTF-8 name flag (bit 11) is set so `写真.jpg` survives; sizes and CRCs are
 * written in the local header rather than a data descriptor, because every
 * unzip program reads those; and the central directory offsets are absolute
 * byte positions, which is the part that has to be exactly right. The tests
 * check the output by unpacking it with a real ZIP implementation.
 */

import type { FailureReason } from '../analytics.ts';
import { lastSegment, sanitiseNamePart, uniqueNames } from './name.ts';

/** ZIP stores entry counts in 16 bits, and no tool here offers more than a few dozen files. */
export const ZIP_MAX_ENTRIES = 0xffff;

/**
 * Sizes and offsets are 32-bit fields. Passing this needs ZIP64, which no tool
 * on the site can reach: the largest batch is twenty files at thirty megabytes.
 */
export const ZIP_MAX_TOTAL_BYTES = 0xffffffff;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;

const SIGNATURE_LOCAL = 0x04034b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_END = 0x06054b50;

/** Deflate-capable reader, stored entries, and UTF-8 names all arrived in 2.0. */
const VERSION_2_0 = 20;
/** Bit 11: the name is UTF-8 rather than the legacy code page. */
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;

let crcTable: Uint32Array | null = null;

/** Built once on first use: 256 entries is cheap, but not on a page that never zips. */
function table(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const next = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    next[i] = value >>> 0;
  }
  crcTable = next;
  return next;
}

/**
 * CRC-32 as ZIP defines it (IEEE 802.3, reflected, initial and final xor with
 * ~0). Returned unsigned, because `>>> 0` is the difference between a valid
 * archive and one every unzip program rejects.
 */
export function crc32(bytes: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = lookup[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface DosStamp {
  time: number;
  date: number;
}

/**
 * MS-DOS timestamps: two-second resolution, no timezone, and the epoch is 1980.
 * Anything earlier — a system clock that never got set, most often — is clamped,
 * because an out-of-range field makes some readers refuse the whole archive.
 */
function dosStamp(when: Date): DosStamp {
  const stamp = Number.isFinite(when.getTime()) ? when : new Date();
  const year = stamp.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time:
      (stamp.getHours() << 11) | (stamp.getMinutes() << 5) | Math.floor(stamp.getSeconds() / 2),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate(),
  };
}

/** One file in the archive. The archive is flat: names never describe folders. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Defaults to the moment the archive is written, which is what a user expects. */
  modified?: Date;
}

export type ZipResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: FailureReason; error: string };

interface PreparedEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  stamp: DosStamp;
  offset: number;
}

/**
 * Entry names are flattened and de-duplicated here as a safety net. Callers pass
 * names that are already sanitised, but an archive whose entries collide
 * extracts to fewer files than it contains — silent data loss at the last step
 * of the workflow, in the one place a user would never think to check.
 */
function entryNames(entries: readonly ZipEntry[]): string[] {
  const flat = entries.map((entry, index) => {
    const cleaned = sanitiseNamePart(lastSegment(entry.name));
    return cleaned === '' ? `file-${index + 1}` : cleaned;
  });
  return uniqueNames(flat);
}

const TOO_BIG =
  'The archive would be too large to build in the browser. Downloading the files individually still works.';

/**
 * Build a stored ZIP archive.
 *
 * Returns the house result shape rather than throwing: the caller is a download
 * button, and the two ways this can fail are both worth a sentence a user can
 * act on. Neither is reachable by any tool currently shipped, which is the point
 * of checking rather than trusting.
 */
export function writeZip(entries: readonly ZipEntry[], opts?: { modified?: Date }): ZipResult {
  if (entries.length === 0) {
    return { ok: false, reason: 'invalid_input', error: 'There are no files to download yet.' };
  }
  if (entries.length > ZIP_MAX_ENTRIES) {
    return { ok: false, reason: 'too_many_files', error: TOO_BIG };
  }

  const encoder = new TextEncoder();
  const names = entryNames(entries);
  const fallbackStamp = dosStamp(opts?.modified ?? new Date());

  let total = END_RECORD_BYTES;
  const prepared: PreparedEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const name = encoder.encode(names[i]);
    if (name.length > 0xffff) {
      return { ok: false, reason: 'invalid_input', error: TOO_BIG };
    }
    const data = entries[i].data;
    const modified = entries[i].modified;
    prepared.push({
      name,
      data,
      crc: crc32(data),
      stamp: modified === undefined ? fallbackStamp : dosStamp(modified),
      offset: 0,
    });
    // Every byte the entry costs: its local header, its central directory
    // header, its name twice, and the file itself.
    total +=
      LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + name.length * 2 + data.length;
    if (total > ZIP_MAX_TOTAL_BYTES) {
      return { ok: false, reason: 'too_large', error: TOO_BIG };
    }
  }

  return { ok: true, bytes: assemble(prepared, total) };
}

/**
 * Write the three sections in order: every local header followed by its bytes,
 * then the central directory, then the end record pointing at it. The archive is
 * allocated once at its exact final size, because growing a buffer that can hold
 * six hundred megabytes of photos is how a phone tab gets killed.
 */
function assemble(entries: PreparedEntry[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let at = 0;

  for (const entry of entries) {
    entry.offset = at;
    view.setUint32(at, SIGNATURE_LOCAL, true);
    view.setUint16(at + 4, VERSION_2_0, true);
    view.setUint16(at + 6, FLAG_UTF8_NAMES, true);
    view.setUint16(at + 8, METHOD_STORE, true);
    view.setUint16(at + 10, entry.stamp.time, true);
    view.setUint16(at + 12, entry.stamp.date, true);
    view.setUint32(at + 14, entry.crc, true);
    // Stored, so the compressed and uncompressed sizes are the same number.
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true);
    at += LOCAL_HEADER_BYTES;
    bytes.set(entry.name, at);
    at += entry.name.length;
    bytes.set(entry.data, at);
    at += entry.data.length;
  }

  const centralAt = at;
  for (const entry of entries) {
    view.setUint32(at, SIGNATURE_CENTRAL, true);
    // Made by MS-DOS/FAT with no external attributes, so the extracting program
    // applies its own default permissions. Claiming a Unix mode here would mean
    // guessing one on behalf of a browser that has no idea.
    view.setUint16(at + 4, VERSION_2_0, true);
    view.setUint16(at + 6, VERSION_2_0, true);
    view.setUint16(at + 8, FLAG_UTF8_NAMES, true);
    view.setUint16(at + 10, METHOD_STORE, true);
    view.setUint16(at + 12, entry.stamp.time, true);
    view.setUint16(at + 14, entry.stamp.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true);
    view.setUint16(at + 32, 0, true);
    view.setUint16(at + 34, 0, true);
    view.setUint16(at + 36, 0, true);
    view.setUint32(at + 38, 0, true);
    view.setUint32(at + 42, entry.offset, true);
    at += CENTRAL_HEADER_BYTES;
    bytes.set(entry.name, at);
    at += entry.name.length;
  }

  view.setUint32(at, SIGNATURE_END, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralAt, true);
  view.setUint32(at + 16, centralAt, true);
  view.setUint16(at + 20, 0, true);

  return bytes;
}
