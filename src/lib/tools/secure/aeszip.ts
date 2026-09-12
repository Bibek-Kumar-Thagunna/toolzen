/**
 * ============================================================================
 * AES-ENCRYPTED ZIP (WinZip AE-2)
 * ============================================================================
 * A password-protected .zip that 7-Zip, WinRAR, Keka, PeaZip and macOS's
 * Archive Utility open with the password and nothing else.
 *
 * ── Why this format and not the one built into Windows ────────────────────
 * ZIP has two encryption schemes. The original, "ZipCrypto", is the one
 * Windows Explorer can open without extra software, and it has been broken
 * since 1994: a known-plaintext attack recovers the internal state from a few
 * bytes of any file whose content is guessable — and the first bytes of a JPEG,
 * a PDF or a Word document are entirely guessable. Free tools break it in
 * seconds on a laptop. Offering it would mean putting the word "encrypted" on
 * something that is not.
 *
 * So this writes the other one: WinZip's AES specification, AE-2, with 256-bit
 * keys. The cost is honest and has to be stated on the page — Windows'
 * built-in unzipper cannot open it, and the recipient needs 7-Zip or similar.
 * The alternative is a file that opens easily for the recipient and equally
 * easily for anyone else.
 *
 * ── The shape of an encrypted entry ───────────────────────────────────────
 *     salt (16 bytes) │ password check (2) │ ciphertext │ auth code (10)
 *
 * The key comes from PBKDF2-HMAC-SHA1 over the password and salt, producing 66
 * bytes: 32 for AES, 32 for the HMAC, and 2 that are stored in the clear as a
 * password check. That check is what lets a reader say "wrong password"
 * immediately rather than decrypting a gigabyte first — and being two bytes, it
 * lets a wrong password through about once in 65,536 tries, which the
 * authentication code then catches.
 *
 * ── The part worth being unhappy about ────────────────────────────────────
 * 1000 PBKDF2 iterations is the specification's number, frozen in 2003 and
 * used by every program that reads these files. A GPU runs billions of SHA-1
 * operations a second, so 1000 iterations is roughly no defence at all against
 * someone guessing passwords offline. There is no way to raise it and stay
 * compatible: the count is not stored in the file, it is hardcoded in every
 * reader.
 *
 * That is exactly why the site offers its own container as well, where the
 * iteration count is ours to choose and is stored in the header. The page has
 * to say this plainly, because "AES-256" reads as "unbreakable" and here the
 * cipher was never the weak part — the password is.
 *
 * ── Why AE-2 rather than AE-1 ─────────────────────────────────────────────
 * AE-1 stores the file's CRC in the clear. That leaks a checksum of the
 * plaintext, which is enough to confirm a guess about a small file's contents
 * without the password. AE-2 writes zero there and relies on the HMAC instead,
 * and every reader that handles AES zips handles AE-2.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * aeszip.test.ts hands the output to 7-Zip and to pyzipper — two independent
 * implementations — and checks that the files come back byte for byte, that a
 * wrong password fails, and that a flipped ciphertext byte is detected.
 * ============================================================================
 */

import type { FailureReason } from '../../analytics.ts';
import { Aes256, ctrXor } from '../../crypto/aes.ts';
import { crc32, writeZip, type ZipEntry, type ZipResult } from '../../files/zip.ts';

/** WinZip's compression-method marker for an AES entry. */
export const METHOD_AES = 99;
/** Extra field header id for the AES record. */
export const EXTRA_ID_AES = 0x9901;
/** "AES encryption" in the version-needed field. */
const VERSION_AES = 51;
/** General purpose bit 0: this entry is encrypted. */
const FLAG_ENCRYPTED = 0x0001;

/** AES-256 in WinZip's strength enumeration. */
const STRENGTH_256 = 3;
const SALT_BYTES = 16;
const PASSWORD_CHECK_BYTES = 2;
const AUTH_CODE_BYTES = 10;
const AES_KEY_BYTES = 32;
const MAC_KEY_BYTES = 32;

/**
 * Fixed by the specification and not by us. See the header: this is the number
 * every reader hardcodes, so changing it produces files nothing can open.
 */
const PBKDF2_ITERATIONS = 1000;

/** Method codes for the *actual* compression, recorded inside the extra field. */
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Encrypt in slices this big, so a long file can report progress and be cancelled. */
const SLICE_BYTES = 1 << 20;

export interface SecureFile {
  name: string;
  bytes: Uint8Array;
  modified?: Date;
}

export interface SecureOptions {
  /** Called with bytes processed and the total, for a progress bar. */
  onProgress?: (done: number, total: number) => void;
  /** Awaited between slices. Throw from it to cancel. */
  checkpoint?: () => Promise<void> | void;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

/**
 * The 0x9901 extra field: eleven bytes saying which AES variant this is and
 * what the compression method would have been if the entry were not encrypted.
 * The outer method field reads 99 for every AES entry, so without this record a
 * reader has no idea whether to inflate what it decrypts.
 */
function aesExtraField(actualMethod: number): Uint8Array {
  const field = new Uint8Array(11);
  field.set(u16(EXTRA_ID_AES), 0);
  field.set(u16(7), 2); // the seven bytes that follow
  field.set(u16(2), 4); // AE-2
  field[6] = 0x41; // 'A'
  field[7] = 0x45; // 'E'
  field[8] = STRENGTH_256;
  field.set(u16(actualMethod), 9);
  return field;
}

/**
 * Everything derived from the password, in one PBKDF2 pass.
 *
 * The specification concatenates all three: the AES key, the HMAC key, and the
 * two-byte check value, in that order. Deriving them separately would be three
 * times the work for the same bytes.
 */
async function deriveKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ cipher: Aes256; macKey: CryptoKey; check: Uint8Array }> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const total = AES_KEY_BYTES + MAC_KEY_BYTES + PASSWORD_CHECK_BYTES;
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-1' },
      material,
      total * 8,
    ),
  );
  const macKey = await crypto.subtle.importKey(
    'raw',
    bits.slice(AES_KEY_BYTES, AES_KEY_BYTES + MAC_KEY_BYTES) as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return {
    cipher: new Aes256(bits.slice(0, AES_KEY_BYTES)),
    macKey,
    check: bits.slice(AES_KEY_BYTES + MAC_KEY_BYTES),
  };
}

/**
 * Deflate, if the browser can and if it helps.
 *
 * Encryption destroys any redundancy in the data, so compression has to happen
 * first or not at all — which is why every zip program compresses then
 * encrypts, and why a "compressed" encrypted archive built the other way round
 * is always the same size as its input.
 *
 * Returns null when deflate is unavailable or made the data bigger, which is
 * the normal outcome for photographs, video and anything already zipped.
 */
async function maybeDeflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || bytes.length === 0) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
      new CompressionStream('deflate-raw'),
    );
    const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
    return deflated.length < bytes.length ? deflated : null;
  } catch {
    return null;
  }
}

/**
 * Encrypt one file into the payload an AES zip entry carries.
 *
 * The CRC is taken over the *original* bytes before anything happens to them,
 * because that is what a reader checks after it has decrypted and inflated.
 * AE-2 does not store it — it is computed here so the same routine can be
 * reused by the reader for verification.
 */
async function encryptPayload(
  bytes: Uint8Array,
  password: string,
  opts: SecureOptions,
  onSlice: (count: number) => void,
): Promise<{ payload: Uint8Array; method: number }> {
  const deflated = await maybeDeflate(bytes);
  const body = deflated ?? bytes;
  const method = deflated === null ? METHOD_STORE : METHOD_DEFLATE;

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const { cipher, macKey, check } = await deriveKeys(password, salt);

  // Copied because the caller's array is the file the user still has open in
  // the list, and CTR works in place.
  const ciphertext = Uint8Array.from(body);
  for (let at = 0; at < ciphertext.length; at += SLICE_BYTES) {
    const end = Math.min(at + SLICE_BYTES, ciphertext.length);
    ctrXor(cipher, ciphertext, at, end);
    onSlice(end - at);
    if (opts.checkpoint) await opts.checkpoint();
  }

  const auth = new Uint8Array(
    await crypto.subtle.sign('HMAC', macKey, ciphertext as BufferSource),
  ).slice(0, AUTH_CODE_BYTES);

  const payload = new Uint8Array(
    SALT_BYTES + PASSWORD_CHECK_BYTES + ciphertext.length + AUTH_CODE_BYTES,
  );
  payload.set(salt, 0);
  payload.set(check, SALT_BYTES);
  payload.set(ciphertext, SALT_BYTES + PASSWORD_CHECK_BYTES);
  payload.set(auth, SALT_BYTES + PASSWORD_CHECK_BYTES + ciphertext.length);
  return { payload, method };
}

/**
 * Build a password-protected .zip.
 *
 * Names are flattened by the writer, as they are for every other archive the
 * site produces: these are the user's own files and the archive is opened by
 * whatever the recipient has, so a stored path is an instruction to someone
 * else's unzip program about where to put a file.
 */
export async function writeAesZip(
  files: readonly SecureFile[],
  password: string,
  opts: SecureOptions = {},
): Promise<ZipResult> {
  if (files.length === 0) {
    return { ok: false, reason: 'invalid_input', error: 'There are no files to lock.' };
  }
  if (password === '') {
    return { ok: false, reason: 'invalid_input', error: 'Choose a password first.' };
  }

  const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  let done = 0;

  const entries: ZipEntry[] = [];
  for (const file of files) {
    const { payload, method } = await encryptPayload(file.bytes, password, opts, (count) => {
      done += count;
      opts.onProgress?.(done, total);
    });
    entries.push({
      name: file.name,
      data: payload,
      ...(file.modified ? { modified: file.modified } : {}),
      raw: {
        method: METHOD_AES,
        // AE-2 stores no CRC. The authentication code replaces it, and a
        // checksum of the plaintext would confirm guesses about a small file.
        crc: 0,
        uncompressedSize: file.bytes.length,
        extra: aesExtraField(method),
        flags: FLAG_ENCRYPTED,
        versionNeeded: VERSION_AES,
      },
    });
  }

  return writeZip(entries);
}

export type DecryptResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: FailureReason; error: string };

const WRONG_PASSWORD = 'That password does not open this file.';

/**
 * Turn an encrypted entry's payload back into the file.
 *
 * Checked in the order the format allows: the two-byte check first because it
 * costs nothing, then the authentication code over the whole ciphertext, and
 * only then the CRC of the decompressed result. Each catches something the
 * next cannot — a wrong password, a tampered or truncated file, and a bug in
 * the inflate step respectively.
 */
export async function decryptAesEntry(
  payload: Uint8Array,
  password: string,
  actualMethod: number,
  expectedCrc: number | null,
  opts: SecureOptions = {},
): Promise<DecryptResult> {
  const overhead = SALT_BYTES + PASSWORD_CHECK_BYTES + AUTH_CODE_BYTES;
  if (payload.length < overhead) {
    return { ok: false, reason: 'corrupt_input', error: 'This entry is too short to be valid.' };
  }

  const salt = payload.subarray(0, SALT_BYTES);
  const check = payload.subarray(SALT_BYTES, SALT_BYTES + PASSWORD_CHECK_BYTES);
  const ciphertext = Uint8Array.from(
    payload.subarray(SALT_BYTES + PASSWORD_CHECK_BYTES, payload.length - AUTH_CODE_BYTES),
  );
  const auth = payload.subarray(payload.length - AUTH_CODE_BYTES);

  const { cipher, macKey, check: expected } = await deriveKeys(password, salt);
  if (check[0] !== expected[0] || check[1] !== expected[1]) {
    return { ok: false, reason: 'password_protected', error: WRONG_PASSWORD };
  }

  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', macKey, ciphertext as BufferSource),
  );
  for (let i = 0; i < AUTH_CODE_BYTES; i += 1) {
    if (signed[i] !== auth[i]) {
      // The password check passes about once in 65,536 wrong guesses, so this
      // is a wrong password far more often than it is a damaged file — and
      // saying "damaged" to someone who mistyped would send them looking for
      // the wrong problem.
      return {
        ok: false,
        reason: 'password_protected',
        error: `${WRONG_PASSWORD} If you are sure it is right, the file may have been damaged in transit.`,
      };
    }
  }

  for (let at = 0; at < ciphertext.length; at += SLICE_BYTES) {
    const end = Math.min(at + SLICE_BYTES, ciphertext.length);
    ctrXor(cipher, ciphertext, at, end);
    opts.onProgress?.(end, ciphertext.length);
    if (opts.checkpoint) await opts.checkpoint();
  }

  let bytes = ciphertext;
  if (actualMethod === METHOD_DEFLATE) {
    if (typeof DecompressionStream === 'undefined') {
      return {
        ok: false,
        reason: 'unsupported_type',
        error:
          'This browser cannot decompress the file. Try a recent Chrome, Edge, Firefox or Safari.',
      };
    }
    try {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
        new DecompressionStream('deflate-raw'),
      );
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return { ok: false, reason: 'corrupt_input', error: 'This entry could not be decompressed.' };
    }
  } else if (actualMethod !== METHOD_STORE) {
    return {
      ok: false,
      reason: 'unsupported_type',
      error: `This entry uses compression method ${actualMethod}, which this tool does not read.`,
    };
  }

  if (expectedCrc !== null && expectedCrc !== 0 && crc32(bytes) !== expectedCrc) {
    return { ok: false, reason: 'corrupt_input', error: 'This entry did not survive intact.' };
  }

  return { ok: true, bytes };
}
