/**
 * ============================================================================
 * THE .tzlock CONTAINER
 * ============================================================================
 * The site's own locked-file format, for when the recipient opening it on
 * Toolzen is the point.
 *
 * ── What this buys, honestly ──────────────────────────────────────────────
 * Two things, and neither of them is "stronger encryption than a zip".
 *
 * First, the work factor. An AES zip is stuck on 1000 PBKDF2 iterations
 * because that number is hardcoded in every program that reads one (see
 * aeszip.ts). Here the iteration count lives in the header, so it can be set
 * to something a graphics card cannot chew through and raised later without
 * breaking a single existing file. That is a real improvement, and it is the
 * only part of this format that is about security.
 *
 * Second, and this is a product decision rather than a security one: no
 * existing program knows this layout, so in practice the recipient comes to
 * the site to open it. That is convenience and it is traffic. It is **not**
 * protection — the code that reads this file is public JavaScript that anyone
 * can read, so a determined person can write their own reader in an afternoon.
 * What they cannot do is open the file without the password, and that is where
 * all the actual security lives. The page has to say this in those words,
 * because a user who believes "only Toolzen can open it" is a user who will
 * pick a weak password.
 *
 * ── The obligation that comes with a private format ───────────────────────
 * A file nobody else can read is a file that becomes rubbish if this site
 * disappears. Two things answer for that, and neither is optional:
 *
 *   1. The version byte. Version 1 is read forever. A future version adds a
 *      case to the reader; it never replaces one.
 *   2. `public/unlock.html` — a single self-contained page, downloadable from
 *      the tool, that decrypts a .tzlock with no network and no site. Keep a
 *      copy next to the file and the format outlives the domain.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *     "TZLOCK\x1a"   7   magic, with a control byte so a text editor or an
 *                        upload filter treats it as binary
 *     version        1   = 1
 *     kdf            1   1 = PBKDF2-HMAC-SHA256
 *     cipher         1   1 = AES-256-GCM
 *     compression    1   0 = none, 1 = raw deflate
 *     iterations     4   PBKDF2 rounds, little-endian
 *     salt           16
 *     nonce          12  the GCM initialisation vector
 *     hintLength     2   little-endian
 *     hint           …   UTF-8, in the clear, optional
 *     payload        …   ciphertext with the 16-byte GCM tag appended
 *
 * The whole header — every byte before the payload — is passed to GCM as
 * additional authenticated data. So the iteration count, the compression flag
 * and the hint cannot be altered by anyone without the password: changing one
 * byte makes the file refuse to open rather than open differently. A format
 * that authenticates only its payload lets an attacker rewrite the header.
 *
 * ── What the plaintext is ─────────────────────────────────────────────────
 * A plain .zip of the files, built by the site's own writer, optionally
 * deflated. That means unlocking is decrypt-then-unzip, the format carries
 * names and folders for free, and the standalone page can hand back the inner
 * .zip for any unzip program to open — one more way the file is not a hostage.
 * ============================================================================
 */

import type { FailureReason } from '../../analytics.ts';
import { writeZip, type ZipEntry } from '../../files/zip.ts';
import type { SecureFile, SecureOptions } from './aeszip.ts';

const MAGIC = new Uint8Array([0x54, 0x5a, 0x4c, 0x4f, 0x43, 0x4b, 0x1a]); // "TZLOCK\x1a"
export const TZLOCK_VERSION = 1;
export const TZLOCK_EXTENSION = '.tzlock';

const KDF_PBKDF2_SHA256 = 1;
const CIPHER_AES_256_GCM = 1;
const COMPRESSION_NONE = 0;
const COMPRESSION_DEFLATE = 1;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BITS = 128;
const HINT_MAX_BYTES = 200;

const HEADER_FIXED_BYTES = MAGIC.length + 1 + 1 + 1 + 1 + 4 + SALT_BYTES + NONCE_BYTES + 2;

/**
 * The work factor, chosen rather than inherited.
 *
 * 600,000 PBKDF2-SHA256 rounds is the OWASP figure and costs a fraction of a
 * second on a laptop and about a second on a phone — a delay a person locking
 * a file will accept once, and a multiplier of six hundred over what an AES zip
 * can offer. It is written into every file, so raising it later leaves old
 * files readable.
 */
export const TZLOCK_ITERATIONS = 600_000;

/**
 * Everything has to be held in memory twice over — the files, the inner
 * archive, the ciphertext — and GCM in the browser is a single call that
 * cannot be streamed. This is the point past which a tab is likely to be
 * killed rather than finish, so it is refused up front with a number, instead
 * of failing halfway through with a message about memory.
 */
export const TZLOCK_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export type LockResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: FailureReason; error: string };

export type UnlockResult =
  | { ok: true; files: { name: string; bytes: Uint8Array }[] }
  | { ok: false; reason: FailureReason; error: string };

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || bytes.length === 0) return null;
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out.length < bytes.length ? out : null;
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** The header, complete except for the payload that follows it. */
function buildHeader(
  compression: number,
  iterations: number,
  salt: Uint8Array,
  nonce: Uint8Array,
  hint: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(HEADER_FIXED_BYTES + hint.length);
  const view = new DataView(header.buffer);
  let at = 0;
  header.set(MAGIC, at);
  at += MAGIC.length;
  header[at++] = TZLOCK_VERSION;
  header[at++] = KDF_PBKDF2_SHA256;
  header[at++] = CIPHER_AES_256_GCM;
  header[at++] = compression;
  view.setUint32(at, iterations, true);
  at += 4;
  header.set(salt, at);
  at += SALT_BYTES;
  header.set(nonce, at);
  at += NONCE_BYTES;
  view.setUint16(at, hint.length, true);
  at += 2;
  header.set(hint, at);
  return header;
}

export interface LockOptions extends SecureOptions {
  /**
   * A reminder shown to whoever opens the file. Stored in the clear and
   * authenticated, so it cannot be edited — but anyone holding the file can
   * read it, which is the whole point and which the form has to say.
   */
  hint?: string;
}

/**
 * Lock a set of files into one .tzlock.
 */
export async function writeTzlock(
  files: readonly SecureFile[],
  password: string,
  opts: LockOptions = {},
): Promise<LockResult> {
  if (files.length === 0) {
    return { ok: false, reason: 'invalid_input', error: 'There are no files to lock.' };
  }
  if (password === '') {
    return { ok: false, reason: 'invalid_input', error: 'Choose a password first.' };
  }
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (total > TZLOCK_MAX_TOTAL_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      error: `That is more than ${Math.round(TZLOCK_MAX_TOTAL_BYTES / (1024 * 1024))} MB in one file. Lock it in two batches, or use the plain zip option, which works file by file.`,
    };
  }

  const entries: ZipEntry[] = files.map((file) => ({
    name: file.name,
    data: file.bytes,
    ...(file.modified ? { modified: file.modified } : {}),
  }));
  const inner = writeZip(entries);
  if (!inner.ok) return inner;

  opts.onProgress?.(1, 4);
  if (opts.checkpoint) await opts.checkpoint();

  const packed = await deflate(inner.bytes);
  const plaintext = packed ?? inner.bytes;
  const compression = packed === null ? COMPRESSION_NONE : COMPRESSION_DEFLATE;

  opts.onProgress?.(2, 4);
  if (opts.checkpoint) await opts.checkpoint();

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const hintBytes = new TextEncoder().encode(opts.hint ?? '').slice(0, HINT_MAX_BYTES);
  const header = buildHeader(compression, TZLOCK_ITERATIONS, salt, nonce, hintBytes);

  const key = await deriveKey(password, salt, TZLOCK_ITERATIONS, ['encrypt']);
  opts.onProgress?.(3, 4);
  if (opts.checkpoint) await opts.checkpoint();

  const payload = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: header as BufferSource,
        tagLength: TAG_BITS,
      },
      key,
      plaintext as BufferSource,
    ),
  );

  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  opts.onProgress?.(4, 4);
  return { ok: true, bytes: out };
}

export interface TzlockHeader {
  version: number;
  iterations: number;
  compression: number;
  hint: string;
  salt: Uint8Array;
  nonce: Uint8Array;
  /** Where the ciphertext starts, and the exact bytes GCM authenticates. */
  headerBytes: Uint8Array;
}

/**
 * Read the header without needing the password.
 *
 * Separate from unlocking so the page can show the hint and confirm the file
 * is one of ours *before* asking for a password — and so a file that is not a
 * .tzlock at all is named as such immediately rather than after a second of
 * key derivation followed by "wrong password", which would send the user
 * hunting for a password that was never the problem.
 */
export function readTzlockHeader(
  bytes: Uint8Array,
): { ok: true; header: TzlockHeader } | { ok: false; reason: FailureReason; error: string } {
  if (bytes.length < HEADER_FIXED_BYTES) {
    return { ok: false, reason: 'corrupt_input', error: 'This file is too short to be a locked file.' };
  }
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC[i]) {
      return {
        ok: false,
        reason: 'unsupported_type',
        error: 'This is not a Toolzen-locked file. If it is a password-protected .zip, it opens here too.',
      };
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = MAGIC.length;
  const version = bytes[at++];
  if (version !== TZLOCK_VERSION) {
    return {
      ok: false,
      reason: 'unsupported_type',
      // Reached only by a file from a *newer* build, since version 1 is never
      // retired. Saying so points at the fix rather than at the file.
      error: `This file was made with a newer version of the tool (format ${version}). Reload the page and try again.`,
    };
  }
  const kdf = bytes[at++];
  const cipher = bytes[at++];
  const compression = bytes[at++];
  if (kdf !== KDF_PBKDF2_SHA256 || cipher !== CIPHER_AES_256_GCM) {
    return { ok: false, reason: 'unsupported_type', error: 'This file uses settings this version does not know.' };
  }
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_DEFLATE) {
    return { ok: false, reason: 'corrupt_input', error: 'This file declares an unknown compression setting.' };
  }
  const iterations = view.getUint32(at, true);
  at += 4;
  const salt = bytes.slice(at, at + SALT_BYTES);
  at += SALT_BYTES;
  const nonce = bytes.slice(at, at + NONCE_BYTES);
  at += NONCE_BYTES;
  const hintLength = view.getUint16(at, true);
  at += 2;
  if (hintLength > HINT_MAX_BYTES || at + hintLength > bytes.length) {
    return { ok: false, reason: 'corrupt_input', error: 'This file’s header is damaged.' };
  }
  const hint = new TextDecoder().decode(bytes.subarray(at, at + hintLength));
  at += hintLength;

  return {
    ok: true,
    header: {
      version,
      iterations,
      compression,
      hint,
      salt,
      nonce,
      headerBytes: bytes.slice(0, at),
    },
  };
}

/**
 * Unlock a .tzlock.
 *
 * There is one failure message for a wrong password and for a damaged file,
 * because GCM genuinely cannot tell them apart — a modified byte and a wrong
 * key both fail the same tag check. Guessing at which one it was, as most
 * tools do, is how someone ends up re-downloading a file that was fine.
 */
export async function readTzlock(
  bytes: Uint8Array,
  password: string,
  opts: SecureOptions = {},
): Promise<UnlockResult> {
  const parsed = readTzlockHeader(bytes);
  if (!parsed.ok) return parsed;
  const { header } = parsed;

  // A file claiming a hundred million rounds would freeze the tab for minutes.
  // The count is authenticated, so a legitimate file cannot carry an absurd
  // one, but the check has to happen before the work, not after.
  if (header.iterations < 1000 || header.iterations > 5_000_000) {
    return { ok: false, reason: 'corrupt_input', error: 'This file asks for an unreasonable amount of work to open. It is probably damaged.' };
  }

  opts.onProgress?.(1, 3);
  const key = await deriveKey(password, header.salt, header.iterations, ['decrypt']);
  if (opts.checkpoint) await opts.checkpoint();
  opts.onProgress?.(2, 3);

  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: header.nonce as BufferSource,
          additionalData: header.headerBytes as BufferSource,
          tagLength: TAG_BITS,
        },
        key,
        bytes.subarray(header.headerBytes.length) as BufferSource,
      ),
    );
  } catch {
    return {
      ok: false,
      reason: 'password_protected',
      error: 'That password does not open this file — or the file was altered on the way here.',
    };
  }

  if (header.compression === COMPRESSION_DEFLATE) {
    const expanded = await inflate(plaintext);
    if (expanded === null) {
      return { ok: false, reason: 'corrupt_input', error: 'The contents could not be unpacked.' };
    }
    plaintext = expanded;
  }

  opts.onProgress?.(3, 3);
  // Deliberately returned as the inner archive's bytes for the caller to read
  // with the ZIP reader, rather than parsed here: this module's job is the
  // envelope.
  return { ok: true, files: [{ name: 'archive.zip', bytes: plaintext }] };
}
