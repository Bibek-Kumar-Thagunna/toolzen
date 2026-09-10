/**
 * A QR Code encoder written to ISO/IEC 18004 from the bit stream up: mode
 * selection, Reed-Solomon over GF(256), block interleaving, function patterns,
 * format and version information, and all eight data masks scored by the four
 * penalty rules.
 *
 * It is deliberately isomorphic. `encodeQr` hands back a boolean matrix and
 * nothing else, `qrToSvg` turns that matrix into a string, and neither touches
 * the DOM. Whatever renders a PNG - a canvas in the browser, something else on
 * a server - consumes the same matrix.
 *
 * Correctness is checked structurally rather than by eye: every module is
 * accounted for during construction, the three block tables cross-check against
 * the module geometry, and the test file carries a small byte-mode decoder that
 * reads the finished symbol back out.
 *
 * Left out on purpose: Kanji mode (mode 1000, Shift-JIS double bytes), which
 * only pays off for Japanese text and needs a large code table; and structured
 * append, which splits one message across up to 16 symbols and has almost no
 * reader support. Neither affects what a scanner reads from what we do emit.
 */

/** Error correction level, from about 7% of codewords recoverable (L) to 30% (H). */
export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** The encoding mode chosen for the payload. Widens to `string`. */
export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

export interface QrMatrix {
  /** Modules per side, 21 + 4 × (version − 1). Always odd. */
  size: number;
  /** `modules[y][x]`, true meaning dark. Row-major, `size` × `size`. */
  modules: boolean[][];
  /** 1 to 40. */
  version: number;
  ecc: EccLevel;
  /** The data mask that won on penalty score, or the one the caller forced. */
  mask: number;
  mode: QrMode;
  /**
   * True when an ECI header declaring UTF-8 was emitted, because the text needed
   * a code point outside Latin-1.
   *
   * Reported rather than kept private because it is the one property of a finished
   * symbol that changes which *readers* will cope with it: a conforming scanner
   * honours the header, a few older ones ignore it and render the bytes as
   * Latin-1. An interface that cannot see this cannot warn about it, and the
   * alternative — re-deriving the rule outside this file — is a second copy of a
   * decision that has to agree with this one forever.
   */
  eci: boolean;
  /**
   * Data codewords the payload occupies, and how many this symbol has in total.
   * Codewords rather than characters, because that is the quantity the symbol is
   * built from; `estimateCapacity` answers the character question.
   */
  capacityUsed: number;
  capacityTotal: number;
}

export type QrResult = { ok: true; qr: QrMatrix } | { ok: false; error: string };
export type PayloadResult = { ok: true; payload: string } | { ok: false; error: string };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

const ECC_LEVELS: EccLevel[] = ['L', 'M', 'Q', 'H'];

/** The 45 characters alphanumeric mode can carry, in their code order. */
const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Mode indicators (4 bits each) from Table 2. */
const MODE_INDICATOR: Record<QrMode, number> = { numeric: 0b0001, alphanumeric: 0b0010, byte: 0b0100 };
const ECI_MODE_INDICATOR = 0b0111;
/** ECI assignment number 26 is UTF-8. Emitted as one byte, `00011010`. */
const ECI_UTF8 = 26;

/**
 * Three tables from Annex A, transcribed separately and then made to argue with
 * each other. Each is indexed `[ecc][version - 1]`.
 *
 * `DATA_CODEWORDS` and `EC_CODEWORDS_PER_BLOCK` × `NUM_BLOCKS` must add up to the
 * total codeword count that falls out of the module geometry, for all 160
 * version × level combinations. A single digit mistyped anywhere in the 480
 * numbers below breaks that identity, which is what the test asserts. There is no
 * external oracle available here, so the redundancy *is* the check.
 */
const EC_CODEWORDS_PER_BLOCK: Record<EccLevel, number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

const NUM_BLOCKS: Record<EccLevel, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Total data codewords per symbol, which is the number a payload must fit inside. */
const DATA_CODEWORDS: Record<EccLevel, number[]> = {
  L: [19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523, 589, 647,
    721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531, 1631, 1735, 1843,
    1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956],
  M: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415, 453, 507,
    563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267, 1373, 1455,
    1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334],
  Q: [13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295, 325, 367,
    397, 445, 485, 512, 568, 614, 664, 718, 754, 808, 871, 911, 985, 1033, 1115,
    1171, 1231, 1286, 1354, 1426, 1502, 1582, 1666],
  H: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253, 283, 313,
    341, 385, 406, 442, 464, 514, 538, 596, 628, 661, 701, 745, 793, 845, 901, 961,
    986, 1054, 1096, 1142, 1222, 1276],
};

/** Modules per side. */
function sizeForVersion(version: number): number {
  return version * 4 + 17;
}

/**
 * Modules available to data and error correction, i.e. everything that is not a
 * function pattern, from the closed form in Annex A rather than by counting.
 *
 * The subtraction is the alignment patterns (`n²` of them at 25 modules each, less
 * the overlap with the two timing patterns and the three that are never drawn
 * because the finders are there) and then, from version 7, the 36 modules the two
 * version information blocks take.
 */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Codewords the symbol holds, data and EC together. */
function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

/** 0 to 7 modules left over after the last codeword. They are always light. */
function remainderBits(version: number): number {
  return rawDataModules(version) % 8;
}

/**
 * Row/column centres of the alignment patterns, ascending.
 *
 * The spec prints these as a table; they are also generated by a rule, which is
 * shorter and cannot be mistyped: the first centre is always 6, the last is always
 * `size - 7`, and the ones between are evenly spaced at an even step, filled in
 * from the far end so any rounding slack lands next to the first centre. Version 32
 * is the one case the rule gets wrong, so it is named.
 */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = sizeForVersion(version) - 7; positions.length < count; pos -= step) {
    positions.splice(1, 0, pos);
  }
  return positions;
}

export interface BlockInfo {
  totalCodewords: number;
  dataCodewords: number;
  ecPerBlock: number;
  numBlocks: number;
  /** The short blocks, which come first. */
  group1Blocks: number;
  group1DataCodewords: number;
  /** The long blocks, one data codeword each larger. Often zero of them. */
  group2Blocks: number;
  group2DataCodewords: number;
}

/**
 * How one symbol's codewords are cut into blocks.
 *
 * The two group sizes are derived rather than tabulated: the data codewords are
 * shared out as evenly as possible, so every block is either `floor(data / blocks)`
 * or one more than that, with the shorter blocks first. That is what the spec's
 * per-version block lists say, and deriving it removes 320 numbers that could have
 * been mistyped.
 */
function blockInfo(version: number, ecc: EccLevel): BlockInfo {
  const index = version - 1;
  const numBlocks = NUM_BLOCKS[ecc][index];
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[ecc][index];
  const dataCodewords = DATA_CODEWORDS[ecc][index];
  const shortLength = Math.floor(dataCodewords / numBlocks);
  const group1Blocks = numBlocks - (dataCodewords % numBlocks);
  return {
    totalCodewords: totalCodewords(version),
    dataCodewords,
    ecPerBlock,
    numBlocks,
    group1Blocks,
    group1DataCodewords: shortLength,
    group2Blocks: numBlocks - group1Blocks,
    group2DataCodewords: shortLength + 1,
  };
}

/**
 * GF(256) as QR uses it: the field generated by 2 modulo the primitive polynomial
 * x⁸ + x⁴ + x³ + x² + 1, which is 0x11D.
 *
 * `GF_EXP[i]` is α^i and `GF_LOG[v]` is the exponent that produces `v`, so a
 * multiply becomes an addition of logarithms. The exponent table runs to 512 rather
 * than 255 entries so that `GF_EXP[log(a) + log(b)]` needs no modulo - the sum of
 * two logarithms cannot exceed 508.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  // α^255 = α^0, so the tail is the head again and the wrap costs nothing at runtime.
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}

/** Multiply in GF(256). Zero has no logarithm, so it is handled before the tables. */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * The Reed-Solomon generator polynomial of the given degree, coefficients highest
 * power first: (x − α⁰)(x − α¹)…(x − α^(degree−1)), multiplied out here rather than
 * copied from the spec's table of α-exponents. Subtraction is XOR in this field, so
 * the signs vanish.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const root = GF_EXP[i];
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

/**
 * The `degree` error correction codewords for one data block: the remainder of
 * data(x)·x^degree divided by the generator polynomial.
 *
 * Written as a running window rather than a full long division over a copy of the
 * message, which is the same arithmetic with less allocation. The generator is monic
 * so the leading coefficient is 1 and the quotient term is simply the codeword
 * leaving the window.
 */
function rsRemainder(data: ArrayLike<number>, degree: number): number[] {
  const divisor = rsGenerator(degree).slice(1);
  const result = new Array<number>(degree).fill(0);
  for (let d = 0; d < data.length; d += 1) {
    const factor = data[d] ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < degree; i += 1) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/** A bit stream under construction. Most significant bit of each codeword first. */
function appendBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

/** Character count indicator width, which widens at versions 10 and 27. */
function charCountBits(mode: QrMode, version: number): number {
  const tier = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === 'numeric') return [10, 12, 14][tier];
  if (mode === 'alphanumeric') return [9, 11, 13][tier];
  return [8, 16, 16][tier];
}

const NUMERIC_RE = /^[0-9]+$/;

function isAlphanumeric(text: string): boolean {
  for (const char of text) {
    if (!ALPHANUMERIC_CHARS.includes(char)) return false;
  }
  return true;
}

/** True when any code point is outside Latin-1, which is byte mode's assumed charset. */
function needsEci(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0xff) return true;
  }
  return false;
}

interface Segment {
  mode: QrMode;
  /** Digits, alphanumeric characters, or UTF-8 bytes, depending on the mode. */
  unitCount: number;
  /** Byte mode payload. Empty for the other two modes. */
  bytes: Uint8Array;
  /** The source characters, for numeric and alphanumeric mode. */
  text: string;
  /**
   * Whether an ECI header precedes the mode indicator.
   *
   * Byte mode's charset is ISO-8859-1 by default, so a reader is entitled to
   * interpret our UTF-8 bytes as Latin-1 and hand back mojibake. ECI assignment 26
   * says "these bytes are UTF-8" and removes the ambiguity - at the cost of 12
   * extra bits and of the handful of older scanners that stumble over an ECI
   * header they were never taught to skip.
   *
   * So it goes in only when the text actually needs it, meaning at least one code
   * point above U+00FF. Below that, every reader worth supporting tries UTF-8
   * before falling back to Latin-1, and pure ASCII is identical either way; paying
   * the compatibility risk there would buy nothing.
   */
  eci: boolean;
}

/** The most compact mode that can carry the whole string. */
function buildSegment(text: string): Segment {
  const blank = new Uint8Array(0);
  if (NUMERIC_RE.test(text)) {
    return { mode: 'numeric', unitCount: text.length, bytes: blank, text, eci: false };
  }
  if (isAlphanumeric(text)) {
    return { mode: 'alphanumeric', unitCount: text.length, bytes: blank, text, eci: false };
  }
  const bytes = new TextEncoder().encode(text);
  return { mode: 'byte', unitCount: bytes.length, bytes, text, eci: needsEci(text) };
}

/** Bits the segment occupies at a given version, header included. */
function segmentBitLength(segment: Segment, version: number): number {
  const header = (segment.eci ? 12 : 0) + 4 + charCountBits(segment.mode, version);
  const { unitCount } = segment;
  if (segment.mode === 'numeric') {
    return header + Math.floor(unitCount / 3) * 10 + [0, 4, 7][unitCount % 3];
  }
  if (segment.mode === 'alphanumeric') {
    return header + Math.floor(unitCount / 2) * 11 + (unitCount % 2) * 6;
  }
  return header + unitCount * 8;
}

/** The segment's bits: optional ECI header, mode indicator, count, then the payload. */
function encodeSegment(segment: Segment, version: number): number[] {
  const bits: number[] = [];
  if (segment.eci) {
    appendBits(bits, ECI_MODE_INDICATOR, 4);
    appendBits(bits, ECI_UTF8, 8);
  }
  appendBits(bits, MODE_INDICATOR[segment.mode], 4);
  appendBits(bits, segment.unitCount, charCountBits(segment.mode, version));

  if (segment.mode === 'numeric') {
    // Groups of three digits in 10 bits; a trailing pair takes 7 and a single takes 4.
    for (let i = 0; i < segment.text.length; i += 3) {
      const group = segment.text.slice(i, i + 3);
      appendBits(bits, Number(group), group.length * 3 + 1);
    }
  } else if (segment.mode === 'alphanumeric') {
    // Pairs in 11 bits, base 45; an odd character at the end takes 6.
    for (let i = 0; i < segment.text.length; i += 2) {
      const first = ALPHANUMERIC_CHARS.indexOf(segment.text[i]);
      if (i + 1 === segment.text.length) {
        appendBits(bits, first, 6);
      } else {
        appendBits(bits, first * 45 + ALPHANUMERIC_CHARS.indexOf(segment.text[i + 1]), 11);
      }
    }
  } else {
    for (const byte of segment.bytes) appendBits(bits, byte, 8);
  }
  return bits;
}

/** Characters of the given mode that fit in `bits` bits of payload space. */
function unitsForBits(mode: QrMode, bits: number): number {
  if (bits <= 0) return 0;
  if (mode === 'numeric') {
    const rest = bits % 10;
    return Math.floor(bits / 10) * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
  }
  if (mode === 'alphanumeric') {
    return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  }
  return Math.floor(bits / 8);
}

/**
 * Characters of the given mode that fit at this version and level, which is what a
 * "you have N characters left" counter needs.
 *
 * Byte mode counts UTF-8 bytes, and the figure assumes no ECI header, matching the
 * published capacity tables. Text that triggers one loses 12 bits, so one or two
 * characters off the end.
 */
export function estimateCapacity(
  ecc: EccLevel,
  version: number,
  mode: 'numeric' | 'alphanumeric' | 'byte',
): number {
  if (!ECC_LEVELS.includes(ecc)) return 0;
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) return 0;
  return unitsForBits(mode, DATA_CODEWORDS[ecc][version - 1] * 8 - 4 - charCountBits(mode, version));
}

/** As above, but for one concrete segment, so an ECI header is charged for. */
function maxUnitsFor(segment: Segment, version: number, ecc: EccLevel): number {
  const overhead = (segment.eci ? 12 : 0) + 4 + charCountBits(segment.mode, version);
  return unitsForBits(segment.mode, DATA_CODEWORDS[ecc][version - 1] * 8 - overhead);
}

/** The smallest version in range whose data capacity the segment fits inside. */
function chooseVersion(segment: Segment, ecc: EccLevel, min: number, max: number): number | null {
  for (let version = min; version <= max; version += 1) {
    if (segmentBitLength(segment, version) <= DATA_CODEWORDS[ecc][version - 1] * 8) {
      return version;
    }
  }
  return null;
}

/**
 * Segment bits to data codewords: terminator, then zeros up to a byte boundary, then
 * the two pad codewords alternating until the block is full.
 *
 * The terminator is four zeros, or fewer when fewer will fit - a payload that ends
 * within four bits of capacity simply gets a shorter one, which the spec allows and
 * readers handle because the character count already told them where the data ends.
 */
function toDataCodewords(segment: Segment, version: number, ecc: EccLevel): number[] {
  const capacityBits = DATA_CODEWORDS[ecc][version - 1] * 8;
  const bits = encodeSegment(segment, version);
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) {
    codewords.push(pad);
  }
  return codewords;
}

/**
 * Data and error correction codewords woven into the order the symbol stores them:
 * the first codeword of every block, then the second of every block, and so on, with
 * the short blocks contributing nothing to the final data round. The EC codewords,
 * all blocks having the same number, follow in the same interleaved order.
 *
 * Interleaving is what makes the error correction worth having. A scratch or a thumb
 * over the symbol damages a contiguous run of modules; spreading each block across
 * the whole symbol turns that into a few errors in every block rather than the total
 * loss of one or two.
 */
function interleave(data: number[], version: number, ecc: EccLevel): number[] {
  const info = blockInfo(version, ecc);
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (let b = 0; b < info.numBlocks; b += 1) {
    const length = b < info.group1Blocks ? info.group1DataCodewords : info.group2DataCodewords;
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push(block);
    ecBlocks.push(rsRemainder(block, info.ecPerBlock));
  }

  const result: number[] = [];
  for (let i = 0; i < info.group2DataCodewords; i += 1) {
    for (const block of blocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < info.ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

/** Format information: 5 data bits, BCH(15, 5) parity, then the 0x5412 mask. */
const FORMAT_ECC_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/**
 * The 15 bits written beside the top-left finder and split across the other two.
 *
 * The five data bits are the level indicator then the mask number. The ten parity
 * bits are the remainder modulo the BCH generator 0x537. The whole thing is then
 * XORed with 0x5412 so that no combination of level and mask can come out all-zero,
 * which a reader would otherwise be unable to distinguish from blank space.
 */
function formatBits(ecc: EccLevel, mask: number): number {
  const data = (FORMAT_ECC_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * Version information for versions 7 and up: 6 data bits and BCH(18, 6) parity from
 * the generator 0x1F25, unmasked. Smaller symbols leave it out and readers infer the
 * version from the module count.
 */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/**
 * The symbol under construction.
 *
 * `isFunction` marks the modules that belong to a pattern and must not be masked or
 * written over by data. `assigned` is the paranoid twin: every module that has had
 * its colour decided, function or data or leftover remainder bit. Nothing sets a
 * module without setting the corresponding flag, so `assigned` being entirely true at
 * the end proves no module was silently left at its initial light value - the class
 * of bug that produces a symbol which scans on one reader and not another.
 */
interface Canvas {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
  assigned: boolean[][];
}

function newCanvas(size: number): Canvas {
  const grid = (): boolean[][] => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: grid(), isFunction: grid(), assigned: grid() };
}

/** Set a function pattern module. Out-of-range coordinates are ignored by design. */
function setFunction(canvas: Canvas, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  canvas.modules[y][x] = dark;
  canvas.isFunction[y][x] = true;
  canvas.assigned[y][x] = true;
}

/** Set a data or remainder module. */
function setData(canvas: Canvas, x: number, y: number, dark: boolean): void {
  canvas.modules[y][x] = dark;
  canvas.assigned[y][x] = true;
}

/**
 * A finder pattern and the light separator around it, drawn as concentric rings by
 * Chebyshev distance: dark at 0 and 1, light at 2, dark at 3, light at 4. Ring 4 is
 * the separator, and the parts of it that fall outside the symbol are dropped.
 */
function drawFinder(canvas: Canvas, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(canvas, cx + dx, cy + dy, ring !== 2 && ring !== 4);
    }
  }
}

/** A 5×5 alignment pattern: dark border, light ring, dark centre. */
function drawAlignment(canvas: Canvas, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(canvas, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/**
 * Every function pattern except the format bits, which need a mask number and so are
 * written last.
 *
 * The two timing patterns run the full width and height through row and column 6;
 * the finder patterns overwrite their ends with the same colours, so the order does
 * not matter. Alignment patterns go at every crossing of the coordinate list except
 * the three corners already occupied by finders.
 */
function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const { size } = canvas;
  for (let i = 0; i < size; i += 1) {
    setFunction(canvas, 6, i, i % 2 === 0);
    setFunction(canvas, i, 6, i % 2 === 0);
  }
  drawFinder(canvas, 3, 3);
  drawFinder(canvas, size - 4, 3);
  drawFinder(canvas, 3, size - 4);

  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i += 1) {
    for (let j = 0; j <= last; j += 1) {
      const atFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!atFinder) drawAlignment(canvas, positions[i], positions[j]);
    }
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const far = size - 11 + (i % 3);
      const near = Math.floor(i / 3);
      setFunction(canvas, far, near, dark);
      setFunction(canvas, near, far, dark);
    }
  }
}

/**
 * The format bits, in both of their locations.
 *
 * The first copy wraps the top-left finder, jumping over the timing module at (8, 6).
 * The second is split between the bottom-left and top-right corners so a symbol with
 * one damaged corner is still readable. The module at (8, size − 8) is the dark
 * module: always set, part of no pattern, and a reader's confirmation that it has the
 * orientation right.
 */
function drawFormatBits(canvas: Canvas, ecc: EccLevel, mask: number): void {
  const bits = formatBits(ecc, mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  const { size } = canvas;

  for (let i = 0; i <= 5; i += 1) setFunction(canvas, 8, i, bit(i));
  setFunction(canvas, 8, 7, bit(6));
  setFunction(canvas, 8, 8, bit(7));
  setFunction(canvas, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(canvas, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) setFunction(canvas, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(canvas, 8, size - 15 + i, bit(i));
  setFunction(canvas, 8, size - 8, true);
}

/**
 * The codewords, laid down in the order the symbol reads them: two-module-wide
 * columns from the right edge leftwards, each column pair filled upwards then the
 * next one downwards, right module before left, skipping function patterns.
 *
 * Column 6 is the vertical timing pattern. Rather than special-case it inside the
 * loop, the pair that would contain it steps one to the left, which keeps every
 * remaining pair two modules wide.
 *
 * When the codewords run out, whatever is left is the version's remainder bits. They
 * are light, and they are marked assigned here so the completeness check means what
 * it says.
 */
function placeCodewords(canvas: Canvas, codewords: number[]): void {
  const { size } = canvas;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (canvas.isFunction[y][x]) continue;
        const dark = i < codewords.length * 8 && ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
        setData(canvas, x, y, dark);
        i += 1;
      }
    }
  }
}

/**
 * The eight mask conditions from Table 10. A module is inverted where its condition
 * holds. Applying the same mask twice restores the symbol, which is how the search
 * over all eight masks avoids rebuilding the matrix each time.
 */
function maskCondition(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XOR the mask across every non-function module. */
function applyMask(canvas: Canvas, mask: number): void {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      if (!canvas.isFunction[y][x] && maskCondition(mask, x, y)) {
        canvas.modules[y][x] = !canvas.modules[y][x];
      }
    }
  }
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** Push a run length onto the seven-entry history, newest first. */
function pushRun(history: number[], length: number, size: number): void {
  // A run that starts at the edge is preceded by the quiet zone, which is light and
  // effectively unbounded; padding it by `size` lets the 4:1 ratio check see that.
  const padded = history[0] === 0 ? length + size : length;
  history.pop();
  history.unshift(padded);
}

/**
 * How many finder-like 1:1:3:1:1 sequences the last seven runs contain.
 *
 * The centre five runs must be in that ratio, and the spec also requires four
 * modules of light on one side of it - that is what stops an ordinary stretch of data
 * being mistaken for the finder pattern a reader locks onto. Either side counts, and
 * a sequence flanked by light on both sides counts twice, which is exactly how the
 * penalty is defined.
 */
function countFinderLike(history: number[]): number {
  const n = history[1];
  const core =
    n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  if (!core) return 0;
  return (
    (history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}

/** Close the final run of a line, padding it with the quiet zone, and score it. */
function finishLine(history: number[], darkRun: boolean, length: number, size: number): number {
  let runLength = length;
  if (darkRun) {
    pushRun(history, runLength, size);
    runLength = 0;
  }
  pushRun(history, runLength + size, size);
  return countFinderLike(history);
}

/** Rules 1 and 3 along one line, whether that line is a row or a column. */
function scoreLine(line: boolean[], size: number): number {
  let score = 0;
  let runColor = false;
  let runLength = 0;
  const history = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < size; i += 1) {
    if (line[i] === runColor) {
      runLength += 1;
      if (runLength === 5) score += PENALTY_N1;
      else if (runLength > 5) score += 1;
    } else {
      pushRun(history, runLength, size);
      if (!runColor) score += countFinderLike(history) * PENALTY_N3;
      runColor = line[i];
      runLength = 1;
    }
  }
  return score + finishLine(history, runColor, runLength, size) * PENALTY_N3;
}

/**
 * The masked symbol's penalty score. The mask with the lowest score wins, on the
 * theory that a symbol without long same-colour runs, large solid blocks, decoy
 * finder patterns or a lopsided dark/light balance is the one a camera has the
 * easiest time with.
 *
 * Rule 1 charges 3 for every run of five, plus 1 for each module beyond. Rule 2
 * charges 3 for every 2×2 block of one colour, counted at every position, so a 3×3
 * block is charged four times. Rule 3 charges 40 per finder-like sequence. Rule 4
 * charges 10 for each 5% the dark proportion strays from half.
 */
function penaltyScore(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  for (let y = 0; y < size; y += 1) score += scoreLine(modules[y], size);
  const column = new Array<boolean>(size).fill(false);
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) column[y] = modules[y][x];
    score += scoreLine(column, size);
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (
        color === modules[y][x + 1] &&
        color === modules[y + 1][x] &&
        color === modules[y + 1][x + 1]
      ) {
        score += PENALTY_N2;
      }
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) dark += 1;
    }
  }
  const total = size * size;
  // The smallest k ≥ 0 with (45 − 5k)% ≤ dark/total ≤ (55 + 5k)%, without leaving
  // integers: |dark × 20 − total × 10| / total is twice the deviation in twentieths.
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * PENALTY_N4;
}

/**
 * Assemble the finished symbol and pick its mask.
 *
 * The mask search scores the complete symbol, format bits included, because the
 * format bits are part of what a camera sees. Each candidate is applied, scored and
 * then XORed off again, so all eight are evaluated over one matrix rather than eight.
 */
function buildSymbol(
  codewords: number[],
  version: number,
  ecc: EccLevel,
  forcedMask: number | undefined,
): { canvas: Canvas; mask: number } {
  const canvas = newCanvas(sizeForVersion(version));
  drawFunctionPatterns(canvas, version);
  drawFormatBits(canvas, ecc, 0);
  placeCodewords(canvas, codewords);

  let mask = forcedMask ?? 0;
  if (forcedMask === undefined) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate += 1) {
      applyMask(canvas, candidate);
      drawFormatBits(canvas, ecc, candidate);
      const score = penaltyScore(canvas.modules);
      // Strictly less than, so the lowest-numbered mask wins a tie and the choice is
      // reproducible for a given payload.
      if (score < best) {
        best = score;
        mask = candidate;
      }
      applyMask(canvas, candidate);
    }
  }

  applyMask(canvas, mask);
  drawFormatBits(canvas, ecc, mask);
  return { canvas, mask };
}

/** What the tests need beyond the public matrix. */
export interface QrDetail {
  qr: QrMatrix;
  isFunction: boolean[][];
  assigned: boolean[][];
  dataCodewords: number[];
  interleaved: number[];
}

export interface EncodeQrOptions {
  /** Defaults to M, the level that suits printed and on-screen use alike. */
  ecc?: EccLevel;
  /** Floor on the symbol version. Useful when a batch of codes must match in size. */
  minVersion?: number;
  /** Ceiling on the symbol version, e.g. to keep modules large enough to print. */
  maxVersion?: number;
  /** Force a data mask 0-7 instead of scoring all eight. */
  mask?: number;
}

const UNIT_NAME: Record<QrMode, string> = {
  numeric: 'digit',
  alphanumeric: 'character',
  byte: 'byte',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Option validation, kept apart so the encoder proper reads as one pipeline. */
function validateOptions(opts: EncodeQrOptions): { min: number; max: number } | string {
  if (opts.ecc !== undefined && !ECC_LEVELS.includes(opts.ecc)) {
    return 'Choose an error correction level of L, M, Q or H.';
  }
  if (opts.mask !== undefined && (!Number.isInteger(opts.mask) || opts.mask < 0 || opts.mask > 7)) {
    return 'The mask pattern must be a whole number from 0 to 7.';
  }
  const min = opts.minVersion ?? MIN_VERSION;
  const max = opts.maxVersion ?? MAX_VERSION;
  for (const [label, value] of [['minVersion', min], ['maxVersion', max]] as [string, number][]) {
    if (!Number.isInteger(value) || value < MIN_VERSION || value > MAX_VERSION) {
      return `${label} must be a whole number from ${MIN_VERSION} to ${MAX_VERSION}.`;
    }
  }
  if (min > max) return 'minVersion cannot be larger than maxVersion.';
  return { min, max };
}

/**
 * The full pipeline, with the construction details the tests inspect.
 *
 * Two kinds of "it does not fit" get different sentences, because they call for
 * different actions: nothing at all fits in a version 40 symbol at this level, so
 * shorten the text or drop the level; or it would fit but not under the caller's own
 * `maxVersion`, so raise that instead.
 */
function encodeDetailed(
  text: string,
  opts: EncodeQrOptions = {},
): { ok: true; detail: QrDetail } | { ok: false; error: string } {
  const bounds = validateOptions(opts);
  if (typeof bounds === 'string') return { ok: false, error: bounds };
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'Enter some text, a link or a phone number to turn into a QR code.' };
  }

  const ecc = opts.ecc ?? 'M';
  const segment = buildSegment(text);
  const version = chooseVersion(segment, ecc, bounds.min, bounds.max);

  if (version === null) {
    const noun = UNIT_NAME[segment.mode];
    const absolute = maxUnitsFor(segment, MAX_VERSION, ecc);
    if (segment.unitCount > absolute) {
      const over = segment.unitCount - absolute;
      return {
        ok: false,
        error:
          `That is ${plural(over, noun)} too long. The largest QR code holds ` +
          `${plural(absolute, noun)} at error correction level ${ecc}` +
          `${ecc === 'L' ? '' : ', and more at level L'}.`,
      };
    }
    const needed = chooseVersion(segment, ecc, bounds.min, MAX_VERSION);
    return {
      ok: false,
      error:
        `This text needs a version ${needed} QR code at error correction level ${ecc}, ` +
        `but version ${bounds.max} is the largest allowed. Raise the maximum version or ` +
        'shorten the text.',
    };
  }

  const dataCodewords = toDataCodewords(segment, version, ecc);
  const interleaved = interleave(dataCodewords, version, ecc);
  const { canvas, mask } = buildSymbol(interleaved, version, ecc, opts.mask);

  // Codewords the payload itself needs, padding excluded, which is the number a
  // "how full is this symbol" readout wants. `dataCodewords` is always the full
  // capacity because it has been padded out to it.
  const used = Math.ceil(segmentBitLength(segment, version) / 8);

  return {
    ok: true,
    detail: {
      qr: {
        size: canvas.size,
        modules: canvas.modules,
        version,
        ecc,
        mask,
        mode: segment.mode,
        eci: segment.eci,
        capacityUsed: used,
        capacityTotal: dataCodewords.length,
      },
      isFunction: canvas.isFunction,
      assigned: canvas.assigned,
      dataCodewords,
      interleaved,
    },
  };
}

export type QrDetailResult =
  | { ok: true; detail: QrDetail }
  | { ok: false; error: string };

/**
 * Encode text as a QR symbol, or say why it will not fit.
 *
 * The mode and the version are chosen for the caller - the most compact mode the
 * characters allow, and the smallest version that holds them - because a larger
 * symbol than necessary is never the better answer. `opts` narrows the version
 * range or forces a mask when a batch of codes has to come out the same size.
 */
export function encodeQr(text: string, opts: EncodeQrOptions = {}): QrResult {
  const result = encodeDetailed(text, opts);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, qr: result.detail.qr };
}

/**
 * `encodeQr` plus the intermediate codewords and the module classification, which
 * is what the test suite reads the symbol back out of.
 */
export function encodeQrDetailed(text: string, opts: EncodeQrOptions = {}): QrDetailResult {
  return encodeDetailed(text, opts);
}

/**
 * The geometry and BCH helpers, under qualified names.
 *
 * They are pure functions of the version and the level, and they exist as exports
 * so the tables above can be checked against the published ones directly rather
 * than only through a finished symbol.
 */
export {
  alignmentPositions as qrAlignmentPositions,
  blockInfo as qrBlockInfo,
  formatBits as qrFormatBits,
  rawDataModules as qrRawDataModules,
  remainderBits as qrRemainderBits,
  sizeForVersion as qrSizeForVersion,
  totalCodewords as qrTotalCodewords,
  versionBits as qrVersionBits,
};

/** One module, in SVG user units. Eight keeps a version 40 symbol under 1500px. */
const DEFAULT_MODULE_SIZE = 8;
/** The quiet zone in modules. Four is the spec's minimum, and readers rely on it. */
const DEFAULT_MARGIN = 4;

export interface QrPathOptions {
  /** Side of one module. Default 8. */
  moduleSize?: number;
  /** Quiet zone in modules, included in the coordinates. Default 4. */
  margin?: number;
}

export interface QrSvgOptions extends QrPathOptions {
  /** Dark module colour. Any CSS colour. Default black. */
  dark?: string;
  /** Background colour, ignored when `transparent`. Default white. */
  light?: string;
  /** Draw each module as a circle instead of merging rows into one path. */
  rounded?: boolean;
  /** Leave the background out so the page shows through. */
  transparent?: boolean;
  /** Accessible name. Defaults to a description of the symbol. */
  title?: string;
}

/** The five characters that can escape an attribute value or open an element. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The dark modules as one SVG path, each row's consecutive dark modules merged into
 * a single rectangle sub-path: move to the top-left corner, right by the run, down
 * one module, back left, close.
 *
 * The merge is why this is a path and not a grid of `<rect>` elements. A version 40
 * symbol has around 15,000 dark modules; as rectangles that is a megabyte of markup
 * and a renderer visibly working at it, while the merged path is a few tens of
 * kilobytes. It also removes the hairline seams that appear between abutting
 * rectangles when a viewer antialiases them.
 */
export function qrToPathData(qr: QrMatrix, opts: QrPathOptions = {}): string {
  const moduleSize = opts.moduleSize ?? DEFAULT_MODULE_SIZE;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const parts: string[] = [];

  for (let y = 0; y < qr.size; y += 1) {
    const row = qr.modules[y];
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && row[x + run]) run += 1;
      const left = (x + margin) * moduleSize;
      const top = (y + margin) * moduleSize;
      const width = run * moduleSize;
      parts.push(`M${left} ${top}h${width}v${moduleSize}h${-width}z`);
      x += run;
    }
  }
  return parts.join('');
}

/**
 * The symbol as a standalone SVG document.
 *
 * `viewBox` and no fixed units mean the caller can scale it anywhere without
 * re-encoding, and `shape-rendering="crispEdges"` stops a viewer antialiasing the
 * module edges into grey, which is what makes a small QR code fail to scan.
 *
 * `role="img"` with a `<title>` gives assistive technology one named image rather
 * than several thousand unlabelled shapes.
 */
export function qrToSvg(qr: QrMatrix, opts: QrSvgOptions = {}): string {
  const moduleSize = opts.moduleSize ?? DEFAULT_MODULE_SIZE;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const dark = opts.dark ?? '#000000';
  const light = opts.light ?? '#ffffff';
  const side = (qr.size + margin * 2) * moduleSize;
  const title = opts.title ?? `QR code, version ${qr.version}, error correction level ${qr.ecc}`;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" ` +
      `viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" role="img">`,
    `<title>${escapeXml(title)}</title>`,
  ];
  if (!opts.transparent) {
    parts.push(`<rect width="${side}" height="${side}" fill="${escapeXml(light)}"/>`);
  }

  if (opts.rounded) {
    // Radius half a module, so neighbours touch rather than overlap. Readers cope
    // with this because they sample module centres, but it costs some error budget.
    const radius = moduleSize / 2;
    const dots: string[] = [];
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (!qr.modules[y][x]) continue;
        const cx = (x + margin) * moduleSize + radius;
        const cy = (y + margin) * moduleSize + radius;
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${radius}"/>`);
      }
    }
    parts.push(`<g fill="${escapeXml(dark)}">${dots.join('')}</g>`);
  } else {
    const path = qrToPathData(qr, { moduleSize, margin });
    parts.push(`<path fill="${escapeXml(dark)}" d="${path}"/>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * The payload builders below turn structured input into the de facto standard
 * strings that phone cameras act on: joining a network, saving a contact, opening a
 * composer. None of them encode anything - they hand back text for `encodeQr`.
 */

/** vCard and iCalendar line ends. Both specifications require CRLF, not LF. */
const CRLF = '\r\n';

/**
 * Backslash-escape what a `WIFI:` parser would otherwise read as structure: the
 * field separator, the key separator, the escape character itself, the comma some
 * readers also treat as a separator, and the double quote that would otherwise
 * start a quoted hexadecimal value.
 *
 * Without this an SSID containing a semicolon silently joins the wrong network, or
 * no network at all.
 */
function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/**
 * `WIFI:T:WPA;S:name;P:secret;;` - the Android/iOS network provisioning payload.
 *
 * The security type defaults to WPA when there is a password and to `nopass` when
 * there is not, which is what the caller means in each case. A `nopass` network has
 * no password field at all; sending an empty one makes some readers prompt for it.
 */
export function buildWifiPayload(p: {
  ssid: string;
  password?: string;
  security?: 'WPA' | 'WEP' | 'nopass';
  hidden?: boolean;
}): string {
  const password = p.password ?? '';
  const security = p.security ?? (password.length > 0 ? 'WPA' : 'nopass');
  const fields = [`T:${security}`, `S:${escapeWifi(p.ssid)}`];
  if (security !== 'nopass' && password.length > 0) {
    fields.push(`P:${escapeWifi(password)}`);
  }
  // Hidden networks do not answer a scan, so the reader has to be told the SSID is
  // real rather than a typo.
  if (p.hidden) fields.push('H:true');
  return `WIFI:${fields.join(';')};;`;
}

/**
 * Escape a vCard or iCalendar text value. Both specifications reserve the same three
 * characters - backslash, semicolon and comma - and both spell a line break `\n`
 * inside a value, since a real one would end the property.
 *
 * One pass over the string, so an escape never gets escaped again.
 */
function escapeTextValue(value: string): string {
  return value.replace(/([\\;,])/g, '\\$1').replace(/\r\n|[\r\n]/g, '\\n');
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * A vCard 3.0 contact.
 *
 * 3.0 rather than the newer 4.0 because it is what iOS and Android contact importers
 * agree on; 4.0 payloads still get rejected or half-imported by some readers.
 *
 * `N` and `FN` are mandatory in 3.0 and are always emitted, `N` as the five
 * semicolon-separated components with only the surname and given name filled in.
 * Everything else is left out when it is empty, because an empty property makes some
 * importers create a blank field on the saved contact.
 */
export function buildVCardPayload(p: {
  firstName?: string;
  lastName?: string;
  org?: string;
  title?: string;
  phone?: string;
  email?: string;
  url?: string;
  address?: string;
  note?: string;
}): string {
  const first = trimmed(p.firstName);
  const last = trimmed(p.lastName);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeTextValue(last)};${escapeTextValue(first)};;;`);
  lines.push(`FN:${escapeTextValue([first, last].filter((part) => part.length > 0).join(' '))}`);

  const properties: [string, string][] = [
    ['ORG', trimmed(p.org)],
    ['TITLE', trimmed(p.title)],
    ['TEL', trimmed(p.phone)],
    ['EMAIL', trimmed(p.email)],
    ['URL', trimmed(p.url)],
    ['NOTE', trimmed(p.note)],
  ];
  for (const [tag, value] of properties) {
    if (value !== '') lines.push(`${tag}:${escapeTextValue(value)}`);
  }
  // The seven ADR components are post office box, extended address, street, city,
  // region, postcode and country. One free-text address goes in the street slot.
  const address = trimmed(p.address);
  if (address !== '') lines.push(`ADR:;;${escapeTextValue(address)};;;;`);

  lines.push('END:VCARD');
  return `${lines.join(CRLF)}${CRLF}`;
}

/**
 * `mailto:` with the subject and body percent-encoded.
 *
 * The address itself is left alone. `encodeURIComponent` would turn its `@` into
 * `%40`, which is legal but which a handful of mail clients show verbatim in the
 * To field.
 */
export function buildEmailPayload(p: { to: string; subject?: string; body?: string }): string {
  const query: string[] = [];
  const subject = trimmed(p.subject);
  const body = p.body ?? '';
  if (subject !== '') query.push(`subject=${encodeURIComponent(subject)}`);
  if (body !== '') query.push(`body=${encodeURIComponent(body)}`);
  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  return `mailto:${trimmed(p.to)}${suffix}`;
}

/**
 * Keep digits and a leading plus. Spaces, brackets and dashes are how people write
 * phone numbers and how dialler payloads get ignored.
 */
function normalisePhone(value: string): string {
  const digits = value.replace(/[^0-9+]/g, '');
  return digits.startsWith('+') ? `+${digits.replace(/\+/g, '')}` : digits.replace(/\+/g, '');
}

/**
 * `SMSTO:number:message`, the form both Android and iOS cameras understand. The
 * message may contain colons; a reader takes everything after the second one.
 */
export function buildSmsPayload(p: { phone: string; message?: string }): string {
  const phone = normalisePhone(p.phone);
  const message = p.message ?? '';
  return message === '' ? `SMSTO:${phone}` : `SMSTO:${phone}:${message}`;
}

/** Six decimal places is about 10cm, which is finer than any consumer GPS fix. */
function formatDegrees(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * `geo:lat,lon` from RFC 5870, which opens the phone's own map application rather
 * than a particular vendor's website.
 *
 * The bounds are checked because a swapped pair is the common mistake and a latitude
 * of 120 is silently dropped at a pin in the ocean by some readers.
 */
export function buildGeoPayload(p: { lat: number; lon: number }): PayloadResult {
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat)) {
    return { ok: false, error: 'Enter the latitude as a number, for example 51.5007.' };
  }
  if (typeof p.lon !== 'number' || !Number.isFinite(p.lon)) {
    return { ok: false, error: 'Enter the longitude as a number, for example -0.1246.' };
  }
  if (p.lat < -90 || p.lat > 90) {
    return {
      ok: false,
      error: `Latitude runs from -90 to 90 degrees, so ${p.lat} is outside the world. ` +
        'Latitude and longitude may be the wrong way round.',
    };
  }
  if (p.lon < -180 || p.lon > 180) {
    return {
      ok: false,
      error: `Longitude runs from -180 to 180 degrees, so ${p.lon} is outside the world.`,
    };
  }
  return { ok: true, payload: `geo:${formatDegrees(p.lat)},${formatDegrees(p.lon)}` };
}

/**
 * A calendar date and time. The offset is optional; without one the value is read in
 * whatever zone the machine building the code is in, which is what someone typing a
 * local time means.
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/;

/** The last day of a month, so 30 February can be told apart from 30 April. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDateTime(value: string | undefined, label: string): { date: Date } | { error: string } {
  const text = trimmed(value);
  if (!ISO_DATETIME_RE.test(text)) {
    return { error: `Enter the ${label} as a date and time, for example 2026-09-03T14:00.` };
  }
  const unreal = { error: `${text} is not a real date and time. Check the ${label}.` };

  // A day past the end of its month has to be rejected here. `new Date` accepts
  // 2026-02-30 and quietly answers 2 March, which would put the event on a day the
  // caller never asked for.
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return unreal;

  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return unreal;
  return { date };
}

/** `20260903T140000Z`: iCalendar's basic format in UTC, unambiguous everywhere. */
function toBasicUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * A bare `VEVENT` block, which is what calendar applications accept from a QR code -
 * a full `VCALENDAR` wrapper costs 60 characters and adds nothing they need.
 *
 * Times go out in UTC so the event lands at the right moment wherever it is scanned.
 * An absent end time becomes an hour after the start, since a zero-length event is
 * almost never what was meant and readers show it as a bare marker.
 */
export function buildEventPayload(p: {
  title: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
}): PayloadResult {
  const title = trimmed(p.title);
  if (title === '') return { ok: false, error: 'Give the event a title.' };

  const start = parseDateTime(p.start, 'start time');
  if ('error' in start) return { ok: false, error: start.error };

  let end = new Date(start.date.getTime() + ONE_HOUR_MS);
  if (trimmed(p.end) !== '') {
    const parsed = parseDateTime(p.end, 'end time');
    if ('error' in parsed) return { ok: false, error: parsed.error };
    if (parsed.date.getTime() <= start.date.getTime()) {
      return {
        ok: false,
        error: 'The event has to end after it starts. Check the end date and time.',
      };
    }
    end = parsed.date;
  }

  const lines = [
    'BEGIN:VEVENT',
    `SUMMARY:${escapeTextValue(title)}`,
    `DTSTART:${toBasicUtc(start.date)}`,
    `DTEND:${toBasicUtc(end)}`,
  ];
  const location = trimmed(p.location);
  if (location !== '') lines.push(`LOCATION:${escapeTextValue(location)}`);
  const description = trimmed(p.description);
  if (description !== '') lines.push(`DESCRIPTION:${escapeTextValue(description)}`);
  lines.push('END:VEVENT');

  return { ok: true, payload: `${lines.join(CRLF)}${CRLF}` };
}
