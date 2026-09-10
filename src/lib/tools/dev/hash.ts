/**
 * Hashes and HMACs, all of them from `crypto.subtle`.
 *
 * Nothing here implements a hash by hand. WebCrypto is present in Node 18+ and in
 * every browser, it is constant-time where that matters, and a hand-rolled SHA-256
 * in JavaScript would be slower, larger and one typo away from producing confident
 * nonsense.
 *
 * **MD5 is deliberately missing.** `crypto.subtle` does not implement it, and the
 * only way to offer it would be to ship a hand-written MD5 — which means adding
 * cryptographically broken code to the bundle for a purpose nobody should be using
 * it for. If it is ever genuinely needed for a legacy checksum, that is a decision
 * to take deliberately, with the tool page saying plainly what it is for.
 *
 * Isomorphic: no Node imports, so the same file hashes a textarea in the browser
 * and a string on the server.
 */

import { encodeBytes } from './base64.ts';

/** Everything `crypto.subtle.digest` will do, and nothing it will not. */
export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export type HashResult =
  | { ok: true; hex: string; base64: string; bytes: number }
  | { ok: false; error: string };

export type HmacResult =
  | { ok: true; hex: string; base64: string }
  | { ok: false; error: string };

const HEX_DIGITS = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += HEX_DIGITS[bytes[i] >> 4] + HEX_DIGITS[bytes[i] & 15];
  }
  return out;
}

function isSupported(algorithm: string): algorithm is HashAlgorithm {
  return (HASH_ALGORITHMS as readonly string[]).includes(algorithm);
}

function unknownAlgorithm(algorithm: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `"${algorithm}" is not a hash this tool can do. Choose one of ${HASH_ALGORITHMS.join(', ')}. MD5 is not offered on purpose — it is broken, and nothing new should use it.`,
  };
}

const UNAVAILABLE =
  'Hashing is not available here. It needs the browser\'s built-in crypto, which only works on a secure (https) page.';

/**
 * Hash raw bytes. Every other function here funnels into this one.
 *
 * `bytes` in the result is the size of the *input* that was hashed, which is what
 * a page wants to show next to a file; the digest length is fixed by the algorithm
 * and is in `ALGORITHM_NOTES`.
 */
export async function hashBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<HashResult> {
  if (!isSupported(algorithm)) return unknownAlgorithm(String(algorithm));
  try {
    const digest = new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
    return { ok: true, hex: toHex(digest), base64: encodeBytes(digest), bytes: bytes.length };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

/** Hash text as UTF-8, which is what every other tool on earth means by hashing a string. */
export async function hashText(text: string, algorithm: HashAlgorithm): Promise<HashResult> {
  return hashBytes(new TextEncoder().encode(text), algorithm);
}

/**
 * All four digests of the same text, for the comparison table on the tool page.
 *
 * An algorithm that could not be computed comes back as an empty string. The only
 * realistic cause is WebCrypto being unavailable, which takes all four down
 * together and which `hashText` reports as a sentence.
 */
export async function hashAll(text: string): Promise<Record<HashAlgorithm, string>> {
  const bytes = new TextEncoder().encode(text);
  const results = await Promise.all(HASH_ALGORITHMS.map((algorithm) => hashBytes(bytes, algorithm)));
  const out = {} as Record<HashAlgorithm, string>;
  HASH_ALGORITHMS.forEach((algorithm, index) => {
    const result = results[index];
    out[algorithm] = result && result.ok ? result.hex : '';
  });
  return out;
}

/**
 * HMAC: a keyed hash, which is what you want when the question is "did the person
 * who sent this know the secret", not just "has this changed".
 */
export async function hmac(text: string, secret: string, algorithm: HashAlgorithm): Promise<HmacResult> {
  if (!isSupported(algorithm)) return unknownAlgorithm(String(algorithm));
  if (secret === '') {
    // WebCrypto rejects a zero-length key outright, and rightly: an HMAC with no
    // key is just a hash of the message with extra steps.
    return { ok: false, error: 'Enter a secret key. An HMAC without a key is only a hash.' };
  }
  const encoder = new TextEncoder();
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign'],
    );
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
    return { ok: true, hex: toHex(signature), base64: encodeBytes(signature) };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

/**
 * What each algorithm is for, in the words the tool page prints.
 *
 * `safeForPasswords` is `false` for every one of them and is typed as the literal
 * `false` so it cannot quietly become true. This is not pessimism: these hashes are
 * built to be fast, and fast is exactly wrong for storing a password, because it
 * lets an attacker with the stolen file try billions of guesses. Password storage
 * wants a deliberately slow, salted function — bcrypt, scrypt or Argon2.
 */
export const ALGORITHM_NOTES: Record<
  HashAlgorithm,
  { label: string; bits: number; safeForPasswords: false; note: string }
> = {
  'SHA-1': {
    label: 'SHA-1',
    bits: 160,
    safeForPasswords: false,
    note: 'Broken for collision resistance — two different files can be made to share a SHA-1, and that has been done in practice. Use it only to read legacy checksums (git object ids, old file manifests), never to prove something has not been tampered with.',
  },
  'SHA-256': {
    label: 'SHA-256',
    bits: 256,
    safeForPasswords: false,
    note: 'The sensible default: fast, everywhere, and no known weakness. Right for file checksums, signatures and content addressing — and still wrong for passwords, because being fast is the problem there.',
  },
  'SHA-384': {
    label: 'SHA-384',
    bits: 384,
    safeForPasswords: false,
    note: 'SHA-512 truncated to 384 bits. Chosen when a standard or certificate profile asks for it rather than on its own merits.',
  },
  'SHA-512': {
    label: 'SHA-512',
    bits: 512,
    safeForPasswords: false,
    note: 'A longer digest, and often faster than SHA-256 on 64-bit hardware. A longer hash does not make it any more suitable for passwords.',
  },
};

let crcTable: Int32Array | null = null;

/**
 * The 256-entry CRC-32 table, built on first use and kept. Computing it eagerly
 * would cost every page that imports this file 256 loops it may never need.
 */
function crcLookup(): Int32Array {
  if (crcTable) return crcTable;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      // 0xEDB88320 is the reversed form of the standard CRC-32 polynomial, which
      // is what a right-shifting implementation needs.
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value;
  }
  crcTable = table;
  return table;
}

/**
 * CRC-32 as used by zip, gzip and PNG.
 *
 * A checksum, not a hash: it catches accidental corruption — a truncated download,
 * a flipped bit — and a forgery is trivial to construct, so it must never stand in
 * for SHA-256. It is here because it is what those file formats store.
 */
export function crc32(bytes: Uint8Array): number {
  const table = crcLookup();
  let crc = -1; // 0xFFFFFFFF as a signed 32-bit int
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** The same value as eight lowercase hex digits, the way checksum tools print it. */
export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}
