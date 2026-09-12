/**
 * ============================================================================
 * AES-256 BLOCK ENCRYPTION
 * ============================================================================
 * One function that matters: `encryptBlock`. Sixteen bytes in, sixteen bytes
 * out, under a 256-bit key.
 *
 * ── Why this exists when the browser ships AES ─────────────────────────────
 * It should not have to. `crypto.subtle` implements AES-CTR natively and is
 * both faster and better reviewed than anything written here.
 *
 * The obstacle is one line in Brian Gladman's encryption code, which WinZip
 * adopted and which every AES-encrypted .zip in the world therefore uses:
 *
 *     while (i < 16 && !++buf[i]) i++;      // increment the counter
 *
 * That walks up from byte zero, so the counter is **little-endian**. WebCrypto
 * increments the rightmost bits, big-endian, as SP 800-38A specifies. The two
 * produce completely different keystreams after the first block, and the
 * difference is not configurable: `length` selects how many of the *trailing*
 * bits advance, and we need the leading ones.
 *
 * Every way round it inside WebCrypto costs one asynchronous call per sixteen
 * bytes — including the CBC trick, where encrypting a zero block with the
 * counter as the IV yields E(counter). Six million promises to lock a hundred
 * megabytes is not a tool, so the block function is implemented here and the
 * keystream is built from it. It is the same choice every browser ZIP library
 * has made.
 *
 * Everything else stays native: PBKDF2, HMAC and the whole AES-GCM path in the
 * site's own container format all run in `crypto.subtle`, where they belong.
 *
 * ── Scope, deliberately narrow ────────────────────────────────────────────
 * Encryption only, 256-bit keys only, no mode, no padding, no key handling.
 * CTR needs the forward transform in both directions, so the inverse cipher is
 * dead code the site would never call and is not written.
 *
 * ── On timing ─────────────────────────────────────────────────────────────
 * This is a table-driven implementation, so its memory access pattern depends
 * on the key — the cache-timing weakness that hardware AES instructions exist
 * to remove. It is the accepted trade in a browser, where a JavaScript
 * implementation has no way to be constant-time anyway, and the threat it
 * matters against (an attacker measuring cache behaviour on the same machine)
 * already has far easier routes to a file the user is holding in a tab.
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * aes.test.ts runs the FIPS-197 worked example and the NIST AES-256 ECB
 * known-answer vectors, then encrypts random blocks and compares against
 * `openssl enc -aes-256-ecb`. A cipher is either exactly right or useless, so
 * the tests are exhaustive rather than representative.
 * ============================================================================
 */

/** The AES substitution box, from FIPS-197 figure 7. */
const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

/**
 * The four round tables. Each folds SubBytes, ShiftRows and MixColumns into one
 * lookup, which is the standard software formulation from the Rijndael
 * proposal — a round becomes sixteen table reads and twelve XORs instead of a
 * field multiplication per byte.
 *
 * They are derived here rather than written out because 4 KB of hex literals
 * cannot be reviewed, and a single wrong digit produces a cipher that looks
 * fine until it disagrees with every other implementation on earth.
 */
function buildTables(): Uint32Array[] {
  const t0 = new Uint32Array(256);
  const t1 = new Uint32Array(256);
  const t2 = new Uint32Array(256);
  const t3 = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const s = SBOX[i];
    // xtime: multiply by 2 in GF(2^8) with the AES reduction polynomial.
    const s2 = ((s << 1) ^ ((s & 0x80) !== 0 ? 0x11b : 0)) & 0xff;
    const s3 = s2 ^ s;
    t0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    t1[i] = ((s3 << 24) | (s2 << 16) | (s << 8) | s) >>> 0;
    t2[i] = ((s << 24) | (s3 << 16) | (s2 << 8) | s) >>> 0;
    t3[i] = ((s << 24) | (s << 16) | (s3 << 8) | s2) >>> 0;
  }
  return [t0, t1, t2, t3];
}

const [T0, T1, T2, T3] = buildTables();

/** Round constants for the key schedule: 2^(i-1) in GF(2^8). */
const RCON = new Uint32Array([
  0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000,
  0x1b000000, 0x36000000,
]);

/** AES-256: 32-byte key, 14 rounds, 60 words of expanded key. */
export const AES_256_KEY_BYTES = 32;
export const AES_BLOCK_BYTES = 16;
const ROUNDS = 14;
const SCHEDULE_WORDS = 4 * (ROUNDS + 1);

function subWord(word: number): number {
  return (
    ((SBOX[(word >>> 24) & 0xff] << 24) |
      (SBOX[(word >>> 16) & 0xff] << 16) |
      (SBOX[(word >>> 8) & 0xff] << 8) |
      SBOX[word & 0xff]) >>>
    0
  );
}

/**
 * An expanded AES-256 key.
 *
 * Held as a class so a caller cannot accidentally pass a raw key where a
 * schedule belongs, and so the per-block work stays allocation-free: expanding
 * the key once and reusing it is the difference between a tolerable and an
 * unusable throughput over a hundred megabytes.
 */
export class Aes256 {
  private readonly schedule: Uint32Array;

  constructor(key: Uint8Array) {
    if (key.length !== AES_256_KEY_BYTES) {
      throw new RangeError(`AES-256 needs a ${AES_256_KEY_BYTES}-byte key, got ${key.length}`);
    }
    const words = new Uint32Array(SCHEDULE_WORDS);
    const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
    for (let i = 0; i < 8; i += 1) words[i] = view.getUint32(i * 4, false);

    for (let i = 8; i < SCHEDULE_WORDS; i += 1) {
      let temp = words[i - 1];
      if (i % 8 === 0) {
        // RotWord, SubWord, then the round constant.
        temp = (((temp << 8) | (temp >>> 24)) >>> 0);
        temp = (subWord(temp) ^ RCON[i / 8 - 1]) >>> 0;
      } else if (i % 8 === 4) {
        // The extra substitution that only AES-256 performs.
        temp = subWord(temp);
      }
      words[i] = (words[i - 8] ^ temp) >>> 0;
    }
    this.schedule = words;
  }

  /**
   * Encrypt one block.
   *
   * Reads 16 bytes at `inOffset` of `input` and writes 16 bytes at `outOffset`
   * of `output`. The two may be the same array; the state is fully read into
   * locals before anything is written back.
   */
  encryptBlock(
    input: Uint8Array,
    inOffset: number,
    output: Uint8Array,
    outOffset: number,
  ): void {
    const k = this.schedule;

    // AddRoundKey, reading the block as four big-endian words.
    let s0 =
      (((input[inOffset] << 24) |
        (input[inOffset + 1] << 16) |
        (input[inOffset + 2] << 8) |
        input[inOffset + 3]) >>>
        0) ^
      k[0];
    let s1 =
      (((input[inOffset + 4] << 24) |
        (input[inOffset + 5] << 16) |
        (input[inOffset + 6] << 8) |
        input[inOffset + 7]) >>>
        0) ^
      k[1];
    let s2 =
      (((input[inOffset + 8] << 24) |
        (input[inOffset + 9] << 16) |
        (input[inOffset + 10] << 8) |
        input[inOffset + 11]) >>>
        0) ^
      k[2];
    let s3 =
      (((input[inOffset + 12] << 24) |
        (input[inOffset + 13] << 16) |
        (input[inOffset + 14] << 8) |
        input[inOffset + 15]) >>>
        0) ^
      k[3];

    let at = 4;
    for (let round = 1; round < ROUNDS; round += 1) {
      const t0 =
        (T0[(s0 >>> 24) & 0xff] ^
          T1[(s1 >>> 16) & 0xff] ^
          T2[(s2 >>> 8) & 0xff] ^
          T3[s3 & 0xff] ^
          k[at]) >>>
        0;
      const t1 =
        (T0[(s1 >>> 24) & 0xff] ^
          T1[(s2 >>> 16) & 0xff] ^
          T2[(s3 >>> 8) & 0xff] ^
          T3[s0 & 0xff] ^
          k[at + 1]) >>>
        0;
      const t2 =
        (T0[(s2 >>> 24) & 0xff] ^
          T1[(s3 >>> 16) & 0xff] ^
          T2[(s0 >>> 8) & 0xff] ^
          T3[s1 & 0xff] ^
          k[at + 2]) >>>
        0;
      const t3 =
        (T0[(s3 >>> 24) & 0xff] ^
          T1[(s0 >>> 16) & 0xff] ^
          T2[(s1 >>> 8) & 0xff] ^
          T3[s2 & 0xff] ^
          k[at + 3]) >>>
        0;
      s0 = t0;
      s1 = t1;
      s2 = t2;
      s3 = t3;
      at += 4;
    }

    // The last round omits MixColumns, so it is SubBytes and ShiftRows by hand
    // rather than a table read.
    output[outOffset] = SBOX[(s0 >>> 24) & 0xff] ^ ((k[at] >>> 24) & 0xff);
    output[outOffset + 1] = SBOX[(s1 >>> 16) & 0xff] ^ ((k[at] >>> 16) & 0xff);
    output[outOffset + 2] = SBOX[(s2 >>> 8) & 0xff] ^ ((k[at] >>> 8) & 0xff);
    output[outOffset + 3] = SBOX[s3 & 0xff] ^ (k[at] & 0xff);

    output[outOffset + 4] = SBOX[(s1 >>> 24) & 0xff] ^ ((k[at + 1] >>> 24) & 0xff);
    output[outOffset + 5] = SBOX[(s2 >>> 16) & 0xff] ^ ((k[at + 1] >>> 16) & 0xff);
    output[outOffset + 6] = SBOX[(s3 >>> 8) & 0xff] ^ ((k[at + 1] >>> 8) & 0xff);
    output[outOffset + 7] = SBOX[s0 & 0xff] ^ (k[at + 1] & 0xff);

    output[outOffset + 8] = SBOX[(s2 >>> 24) & 0xff] ^ ((k[at + 2] >>> 24) & 0xff);
    output[outOffset + 9] = SBOX[(s3 >>> 16) & 0xff] ^ ((k[at + 2] >>> 16) & 0xff);
    output[outOffset + 10] = SBOX[(s0 >>> 8) & 0xff] ^ ((k[at + 2] >>> 8) & 0xff);
    output[outOffset + 11] = SBOX[s1 & 0xff] ^ (k[at + 2] & 0xff);

    output[outOffset + 12] = SBOX[(s3 >>> 24) & 0xff] ^ ((k[at + 3] >>> 24) & 0xff);
    output[outOffset + 13] = SBOX[(s0 >>> 16) & 0xff] ^ ((k[at + 3] >>> 16) & 0xff);
    output[outOffset + 14] = SBOX[(s1 >>> 8) & 0xff] ^ ((k[at + 3] >>> 8) & 0xff);
    output[outOffset + 15] = SBOX[s2 & 0xff] ^ (k[at + 3] & 0xff);
  }
}

/**
 * AES-CTR with the little-endian counter WinZip's AES entries use.
 *
 * The counter starts at zero and is incremented *before* each block, so the
 * first keystream block is E(01 00 00 … 00). Encryption and decryption are the
 * same operation; `data` is transformed in place.
 *
 * `from` and `to` let a caller run a long file in slices without copying it,
 * so a progress bar can move and a cancel can be honoured. The counter is
 * derived from the absolute position rather than kept as state, so slicing
 * cannot desynchronise it.
 */
export function ctrXor(cipher: Aes256, data: Uint8Array, from = 0, to = data.length): void {
  const counter = new Uint8Array(AES_BLOCK_BYTES);
  const keystream = new Uint8Array(AES_BLOCK_BYTES);

  // Block indices are 1-based, and `from` is required to sit on a boundary so
  // that a sliced call resumes on exactly the block it left off at.
  if (from % AES_BLOCK_BYTES !== 0) {
    throw new RangeError('a CTR slice has to start on a 16-byte boundary');
  }
  let block = from / AES_BLOCK_BYTES + 1;

  for (let at = from; at < to; at += AES_BLOCK_BYTES) {
    // The 128-bit little-endian encoding of the block index. Only the low four
    // bytes can ever be reached here — that is 64 GB — but the whole counter is
    // written so the format is honoured rather than approximated.
    counter[0] = block & 0xff;
    counter[1] = (block >>> 8) & 0xff;
    counter[2] = (block >>> 16) & 0xff;
    counter[3] = (block >>> 24) & 0xff;
    cipher.encryptBlock(counter, 0, keystream, 0);

    const end = Math.min(at + AES_BLOCK_BYTES, to);
    for (let i = at; i < end; i += 1) {
      data[i] ^= keystream[i - at];
    }
    block += 1;
  }
}
