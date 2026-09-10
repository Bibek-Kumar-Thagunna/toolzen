import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_VERSION,
  buildEmailPayload,
  buildEventPayload,
  buildGeoPayload,
  buildSmsPayload,
  buildVCardPayload,
  buildWifiPayload,
  encodeQr,
  encodeQrDetailed,
  estimateCapacity,
  qrAlignmentPositions,
  qrBlockInfo,
  qrFormatBits,
  qrRawDataModules,
  qrRemainderBits,
  qrSizeForVersion,
  qrToPathData,
  qrToSvg,
  qrTotalCodewords,
  qrVersionBits,
} from './qr.ts';
import type { EccLevel, QrDetail, QrMatrix, QrMode } from './qr.ts';

/**
 * There is no QR library to check against here, so this file carries its own
 * independent implementation of everything that can be derived from the standard:
 * the function pattern geometry, the eight mask conditions, the module placement
 * order, GF(256) arithmetic without lookup tables, and a byte/numeric/alphanumeric
 * decoder that reads a finished symbol back out.
 *
 * Where a published table exists it is transcribed here and asserted against - the
 * alignment centres, the 32 format strings, the 34 version strings, the character
 * capacities, and the two worked examples whose codewords appear in the standard and
 * in the widely used tutorial derived from it. Where no table exists, the redundancy
 * between two independent derivations is the oracle.
 */

const LEVELS: EccLevel[] = ['L', 'M', 'Q', 'H'];

/** Deterministic PRNG, so a failing round trip is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unwraps an encode that is expected to succeed. */
function detailOf(text: string, opts: Parameters<typeof encodeQrDetailed>[1] = {}): QrDetail {
  const result = encodeQrDetailed(text, opts);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.detail;
}

function matrixOf(text: string, opts: Parameters<typeof encodeQr>[1] = {}): QrMatrix {
  return detailOf(text, opts).qr;
}

function errorOf(text: string, opts: Parameters<typeof encodeQr>[1] = {}): string {
  const result = encodeQr(text, opts);
  assert.equal(result.ok, false, 'expected this encode to fail');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

function hex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

test('the canonical alphanumeric example is a version 1 symbol', () => {
  const qr = matrixOf('HELLO WORLD', { ecc: 'M' });
  assert.equal(qr.version, 1);
  assert.equal(qr.size, 21);
  assert.equal(qr.mode, 'alphanumeric');
  assert.equal(qr.ecc, 'M');
  assert.equal(qr.modules.length, 21);
  for (const row of qr.modules) assert.equal(row.length, 21);
  // 11 characters: 4 mode bits, 9 count bits, five pairs at 11 bits and one at 6.
  assert.equal(qr.capacityUsed, Math.ceil((4 + 9 + 5 * 11 + 6) / 8));
  assert.equal(qr.capacityTotal, 16);
});

test('the two published worked examples produce their published codewords', () => {
  // ISO/IEC 18004 Annex I: "01234567" as a version 1, level M symbol. The standard
  // prints both halves, so this pins the numeric bit packing, the pad codewords and
  // the Reed-Solomon remainder against the specification itself.
  const iso = detailOf('01234567', { ecc: 'M', minVersion: 1, maxVersion: 1 });
  assert.equal(iso.qr.mode, 'numeric');
  assert.equal(
    hex(iso.dataCodewords),
    '10 20 0C 56 61 80 EC 11 EC 11 EC 11 EC 11 EC 11',
  );
  assert.equal(
    hex(iso.interleaved.slice(16)),
    'A5 24 D4 C1 ED 36 C7 87 2C 55',
  );

  // The same symbol for "HELLO WORLD" at level M, the example carried through the
  // widely used step-by-step derivation of the standard.
  const hello = detailOf('HELLO WORLD', { ecc: 'M', minVersion: 1, maxVersion: 1 });
  assert.equal(
    hex(hello.dataCodewords),
    '20 5B 0B 78 D1 72 DC 4D 43 40 EC 11 EC 11 EC 11',
  );
  assert.equal(
    hex(hello.interleaved.slice(16)),
    'C4 23 27 77 EB D7 E7 E2 5D 17',
  );
  // One block at version 1, so interleaving is the identity on the data half.
  assert.deepEqual(hello.interleaved.slice(0, 16), hello.dataCodewords);
});

/**
 * Alignment pattern centres for versions 1 to 40, transcribed from the standard's
 * table rather than generated, so the rule the encoder uses has something to be
 * wrong against. Version 32 is the row that no simple rule reproduces.
 */
const ALIGNMENT_CENTRES: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

function sizeOf(version: number): number {
  return version * 4 + 17;
}

/**
 * Which modules belong to a function pattern, worked out here from the geometry in
 * the standard and never from the encoder.
 *
 * The three corners are solid reserved blocks: 9 x 9 at the top left (finder,
 * separator and the first format copy), 8 x 9 at the top right and 9 x 8 at the
 * bottom left (finder, separator, the second format copy and the dark module). The
 * timing patterns run between them, the alignment patterns sit at every crossing of
 * the centre list except the three already occupied by finders, and from version 7 the
 * two version information blocks sit beside the top-right and bottom-left finders.
 */
function functionMap(version: number): boolean[][] {
  const size = sizeOf(version);
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number): void => {
    map[y][x] = true;
  };

  for (let y = 0; y <= 8; y += 1) {
    for (let x = 0; x <= 8; x += 1) mark(x, y);
  }
  for (let y = 0; y <= 8; y += 1) {
    for (let x = size - 8; x < size; x += 1) mark(x, y);
  }
  for (let y = size - 8; y < size; y += 1) {
    for (let x = 0; x <= 8; x += 1) mark(x, y);
  }
  for (let i = 9; i < size - 8; i += 1) {
    mark(6, i);
    mark(i, 6);
  }

  const centres = ALIGNMENT_CENTRES[version - 1];
  for (const cy of centres) {
    for (const cx of centres) {
      const atFinder =
        (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (atFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
      }
    }
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }
  return map;
}

function countTrue(map: readonly boolean[][]): number {
  let total = 0;
  for (const row of map) {
    for (const value of row) {
      if (value) total += 1;
    }
  }
  return total;
}

test('the alignment centres match the published table for all 40 versions', () => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    assert.deepEqual(
      qrAlignmentPositions(version),
      ALIGNMENT_CENTRES[version - 1],
      `version ${version}`,
    );
    assert.equal(qrSizeForVersion(version), sizeOf(version));
  }
});

/**
 * The identity that catches a typo anywhere in the 480 numbers of the three block
 * tables, for all 160 version and level combinations.
 *
 * Counting function pattern modules with an independently built map gives the number
 * of modules left for data, and therefore the codeword count and the remainder bits,
 * with no reference to the tables at all. The blocks then have to add up to exactly
 * that count twice over: once as data plus error correction, and once as the two
 * group sizes the encoder derives by sharing the data codewords out evenly.
 */
test('the block tables agree with the module geometry for all 160 combinations', () => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const size = sizeOf(version);
    const functionModules = countTrue(functionMap(version));
    const dataModules = size * size - functionModules;

    assert.equal(qrRawDataModules(version), dataModules, `version ${version} data modules`);
    assert.equal(qrTotalCodewords(version), Math.floor(dataModules / 8), `version ${version}`);
    assert.equal(qrRemainderBits(version), dataModules % 8, `version ${version} remainder`);
    assert.ok(qrRemainderBits(version) <= 7);

    for (const ecc of LEVELS) {
      const info = qrBlockInfo(version, ecc);
      const label = `version ${version} level ${ecc}`;
      const fromBlocks =
        info.group1Blocks * (info.group1DataCodewords + info.ecPerBlock) +
        info.group2Blocks * (info.group2DataCodewords + info.ecPerBlock);

      assert.equal(fromBlocks, Math.floor(dataModules / 8), `${label} block sum`);
      assert.equal(info.totalCodewords, fromBlocks, `${label} total`);
      assert.equal(info.group1Blocks + info.group2Blocks, info.numBlocks, `${label} block count`);
      assert.equal(
        info.group1Blocks * info.group1DataCodewords + info.group2Blocks * info.group2DataCodewords,
        info.dataCodewords,
        `${label} data split`,
      );
      assert.equal(info.group2DataCodewords, info.group1DataCodewords + 1, `${label} group sizes`);
      assert.ok(info.group1Blocks >= 1, `${label} needs at least one short block`);
      // Error correction has to be able to fix at least one codeword per block, and a
      // block cannot be longer than the 255 codewords GF(256) can address.
      assert.ok(info.ecPerBlock >= 2, `${label} ec per block`);
      assert.ok(info.group2DataCodewords + info.ecPerBlock <= 255, `${label} block length`);
    }
  }
});

/**
 * The 32 format strings from the standard's table, indexed by level then mask. The
 * four values in the first column are the ones most often quoted, and the rest are
 * checked below against the BCH code they belong to, so a transcription slip here
 * cannot pass: changing any single bit of a valid codeword leaves a value that is no
 * longer divisible by the generator.
 */
const FORMAT_STRINGS: Record<EccLevel, number[]> = {
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
};

/** The two-bit level indicator, which is not in numeric order. */
const LEVEL_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Remainder of `value` divided by `generator` over GF(2), both as bit patterns. */
function polyMod(value: number, generator: number): number {
  const width = 32 - Math.clz32(generator);
  let rest = value;
  for (let bit = 31 - Math.clz32(rest); bit >= width - 1; bit = 31 - Math.clz32(rest)) {
    rest ^= generator << (bit - (width - 1));
    if (rest === 0) break;
  }
  return rest;
}

test('the format information matches the published table for all 32 pairs', () => {
  // The anchors, spelled out, so the table above is tied to numbers that are quoted
  // in the standard and in every implementation of it.
  assert.equal(FORMAT_STRINGS.L[0], 0x77c4);
  assert.equal(FORMAT_STRINGS.M[0], 0x5412);
  assert.equal(FORMAT_STRINGS.Q[0], 0x355f);
  assert.equal(FORMAT_STRINGS.H[0], 0x1689);

  for (const ecc of LEVELS) {
    for (let mask = 0; mask < 8; mask += 1) {
      const expected = FORMAT_STRINGS[ecc][mask];
      const label = `level ${ecc} mask ${mask}`;
      assert.equal(qrFormatBits(ecc, mask), expected, label);
      assert.ok(expected <= 0x7fff, label);

      // Independent of the table: unmasking recovers the five data bits, and the
      // fifteen bits are a codeword of the BCH(15, 5) code generated by 0x537.
      const unmasked = expected ^ 0x5412;
      assert.equal(unmasked >>> 10, (LEVEL_BITS[ecc] << 3) | mask, `${label} data bits`);
      assert.equal(polyMod(unmasked, 0x537), 0, `${label} parity`);
    }
  }
  // All 32 differ, which is what makes the level and the mask readable at all.
  const all = LEVELS.flatMap((ecc) => FORMAT_STRINGS[ecc]);
  assert.equal(new Set(all).size, 32);
});

/** Version information for versions 7 to 40, from the standard's table. */
const VERSION_STRINGS: Record<number, number> = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3, 11: 0x0bbf6, 12: 0x0c762,
  13: 0x0d847, 14: 0x0e60d, 15: 0x0f928, 16: 0x10b78, 17: 0x1145d, 18: 0x12a17,
  19: 0x13532, 20: 0x149a6, 21: 0x15683, 22: 0x168c9, 23: 0x177ec, 24: 0x18ec4,
  25: 0x191e1, 26: 0x1afab, 27: 0x1b08e, 28: 0x1cc1a, 29: 0x1d33f, 30: 0x1ed75,
  31: 0x1f250, 32: 0x209d5, 33: 0x216f0, 34: 0x228ba, 35: 0x2379f, 36: 0x24b0b,
  37: 0x2542e, 38: 0x26a64, 39: 0x27541, 40: 0x28c69,
};

test('the version information matches the published table for versions 7 to 40', () => {
  // The quoted anchors. 0x209D5 belongs to version 32, not to version 20: its top six
  // bits are the version number, and 0x209D5 >> 12 is 32.
  assert.equal(VERSION_STRINGS[7], 0x07c94);
  assert.equal(VERSION_STRINGS[32], 0x209d5);
  assert.equal(VERSION_STRINGS[40], 0x28c69);
  assert.equal(VERSION_STRINGS[20], 0x149a6);
  assert.equal(0x209d5 >>> 12, 32);

  for (let version = 7; version <= MAX_VERSION; version += 1) {
    const expected = VERSION_STRINGS[version];
    const label = `version ${version}`;
    assert.equal(qrVersionBits(version), expected, label);
    // Six data bits carrying the version, then BCH(18, 6) parity from 0x1F25, with no
    // masking step - unlike the format information, this cannot come out all zero.
    assert.equal(expected >>> 12, version, `${label} data bits`);
    assert.equal(polyMod(expected, 0x1f25), 0, `${label} parity`);
  }
  const all = Object.values(VERSION_STRINGS);
  assert.equal(new Set(all).size, 34);
});

/** The finder pattern as the standard pictures it, dark as 1. */
const FINDER = [
  '1111111',
  '1000001',
  '1011101',
  '1011101',
  '1011101',
  '1000001',
  '1111111',
];

/** The alignment pattern, likewise. */
const ALIGNMENT = ['11111', '10001', '10101', '10001', '11111'];

function assertStamp(
  modules: readonly boolean[][],
  picture: readonly string[],
  left: number,
  top: number,
  label: string,
): void {
  for (let dy = 0; dy < picture.length; dy += 1) {
    for (let dx = 0; dx < picture[dy].length; dx += 1) {
      assert.equal(
        modules[top + dy][left + dx],
        picture[dy][dx] === '1',
        `${label} at ${left + dx},${top + dy}`,
      );
    }
  }
}

/** Reads a 15 bit format string out of one of its two copies. */
function readFormat(modules: readonly boolean[][], copy: 0 | 1): number {
  const size = modules.length;
  const bit = (x: number, y: number, index: number): number => (modules[y][x] ? 1 << index : 0);
  let value = 0;
  if (copy === 0) {
    for (let i = 0; i <= 5; i += 1) value |= bit(8, i, i);
    value |= bit(8, 7, 6);
    value |= bit(8, 8, 7);
    value |= bit(7, 8, 8);
    for (let i = 9; i < 15; i += 1) value |= bit(14 - i, 8, i);
  } else {
    for (let i = 0; i < 8; i += 1) value |= bit(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i += 1) value |= bit(8, size - 15 + i, i);
  }
  return value;
}

/** Reads an 18 bit version string out of one of its two copies. */
function readVersion(modules: readonly boolean[][], copy: 0 | 1): number {
  const size = modules.length;
  let value = 0;
  for (let i = 0; i < 18; i += 1) {
    const far = size - 11 + (i % 3);
    const near = Math.floor(i / 3);
    const dark = copy === 0 ? modules[near][far] : modules[far][near];
    if (dark) value |= 1 << i;
  }
  return value;
}

const STRUCTURAL_VERSIONS = [1, 2, 6, 7, 10, 14, 27, 40];

test('every symbol is structurally what the standard describes', () => {
  for (const version of STRUCTURAL_VERSIONS) {
    for (const ecc of LEVELS) {
      const label = `version ${version} level ${ecc}`;
      const size = sizeOf(version);
      // A payload that fills the symbol, so no test case is quietly a symbol of
      // padding. Digits keep it inside the capacity of every level.
      const digits = '1234567890'.repeat(500).slice(0, estimateCapacity(ecc, version, 'numeric'));
      const detail = detailOf(digits, { ecc, minVersion: version, maxVersion: version });
      const { modules } = detail.qr;

      assert.equal(detail.qr.size, size, label);
      assert.equal(modules.length, size, label);
      for (const row of modules) assert.equal(row.length, size, `${label} row width`);

      // Nothing was left at its initial value: every module had its colour decided,
      // as a function pattern, a data module or a remainder bit.
      assert.equal(countTrue(detail.assigned), size * size, `${label} unassigned modules`);
      // And the classification agrees with the geometry worked out here independently.
      assert.deepEqual(detail.isFunction, functionMap(version), `${label} function modules`);

      assertStamp(modules, FINDER, 0, 0, `${label} top-left finder`);
      assertStamp(modules, FINDER, size - 7, 0, `${label} top-right finder`);
      assertStamp(modules, FINDER, 0, size - 7, `${label} bottom-left finder`);

      // Separators: a light line between each finder and the data.
      for (let i = 0; i <= 7; i += 1) {
        assert.equal(modules[i][7], false, `${label} top-left separator column`);
        assert.equal(modules[7][i], false, `${label} top-left separator row`);
        assert.equal(modules[i][size - 8], false, `${label} top-right separator column`);
        assert.equal(modules[7][size - 1 - i], false, `${label} top-right separator row`);
        assert.equal(modules[size - 1 - i][7], false, `${label} bottom-left separator column`);
        assert.equal(modules[size - 8][i], false, `${label} bottom-left separator row`);
      }

      // Timing patterns: alternating, dark at even coordinates, all the way across.
      for (let i = 8; i <= size - 9; i += 1) {
        assert.equal(modules[6][i], i % 2 === 0, `${label} horizontal timing at ${i}`);
        assert.equal(modules[i][6], i % 2 === 0, `${label} vertical timing at ${i}`);
      }

      // The dark module, which tells a reader it has the symbol the right way up.
      assert.equal(modules[size - 8][8], true, `${label} dark module`);

      // Alignment patterns at every crossing of the centre list bar the three the
      // finders already occupy, and no more than that.
      const centres = ALIGNMENT_CENTRES[version - 1];
      let alignments = 0;
      for (const cy of centres) {
        for (const cx of centres) {
          const atFinder =
            (cx === 6 && cy === 6) ||
            (cx === 6 && cy === size - 7) ||
            (cx === size - 7 && cy === 6);
          if (atFinder) continue;
          assertStamp(modules, ALIGNMENT, cx - 2, cy - 2, `${label} alignment ${cx},${cy}`);
          alignments += 1;
        }
      }
      const expectedAlignments = version === 1 ? 0 : (Math.floor(version / 7) + 2) ** 2 - 3;
      assert.equal(alignments, expectedAlignments, `${label} alignment count`);

      // Both copies of the format information carry the level and the chosen mask.
      assert.equal(readFormat(modules, 0), qrFormatBits(ecc, detail.qr.mask), `${label} format 0`);
      assert.equal(readFormat(modules, 1), qrFormatBits(ecc, detail.qr.mask), `${label} format 1`);

      // And both copies of the version information, from version 7 up.
      if (version >= 7) {
        assert.equal(readVersion(modules, 0), VERSION_STRINGS[version], `${label} version 0`);
        assert.equal(readVersion(modules, 1), VERSION_STRINGS[version], `${label} version 1`);
      }
    }
  }
});

/**
 * GF(256) multiplication for the field the standard uses, by shifting and reducing
 * modulo x^8 + x^4 + x^3 + x^2 + 1. No logarithm tables, so it shares nothing with
 * the encoder's arithmetic beyond the field polynomial itself.
 */
function gfMul(a: number, b: number): number {
  let product = 0;
  for (let i = 0; i < 8; i += 1) {
    if (((b >>> i) & 1) !== 0) product ^= a << i;
  }
  for (let bit = 14; bit >= 8; bit -= 1) {
    if (((product >>> bit) & 1) !== 0) product ^= 0x11d << (bit - 8);
  }
  return product & 0xff;
}

/** α to the given power, by repeated doubling. */
function gfPowAlpha(exponent: number): number {
  let value = 1;
  for (let i = 0; i < exponent; i += 1) value = gfMul(value, 2);
  return value;
}

/**
 * The eight data mask conditions, written in the standard's own terms: i is the row,
 * j is the column, and the module is inverted where the condition holds.
 */
function maskBit(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      throw new Error(`mask ${mask} is out of range`);
  }
}

/**
 * The data modules in the order the standard fills them: two-module columns from the
 * right edge, alternating upwards and downwards, right module of the pair first, with
 * the pair that would straddle the vertical timing pattern shifted one column left.
 */
function placementOrder(version: number): [number, number][] {
  const size = sizeOf(version);
  const map = functionMap(version);
  const order: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (!map[row][column]) order.push([column, row]);
      }
    }
    upward = !upward;
  }
  return order;
}

/** Character count indicator width, from the standard's table. */
function countBits(mode: QrMode, version: number): number {
  const tier = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === 'numeric') return [10, 12, 14][tier];
  if (mode === 'alphanumeric') return [9, 11, 13][tier];
  return [8, 16, 16][tier];
}

/** The alphanumeric code table, in the order the standard defines. */
const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

interface Decoded {
  version: number;
  ecc: EccLevel;
  mask: number;
  mode: QrMode;
  text: string;
}

/**
 * Read a finished symbol back out, the way a scanner does: recover the format
 * information, undo the mask, walk the placement order, split the interleaved stream
 * back into blocks, check every block against its error correction codewords, and
 * decode the bit stream.
 *
 * Nothing here consults the encoder. Every assertion it makes is a property the
 * standard requires of the symbol, so if this disagrees with the encoder, one of the
 * two is wrong about the standard rather than merely inconsistent.
 */
function decodeSymbol(qr: QrMatrix): Decoded {
  const size = qr.modules.length;
  assert.equal((size - 17) % 4, 0, 'the module count must be 21 + 4 x (version - 1)');
  const version = (size - 17) / 4;
  assert.ok(version >= 1 && version <= MAX_VERSION, `version ${version} is out of range`);

  const raw = readFormat(qr.modules, 0);
  assert.equal(readFormat(qr.modules, 1), raw, 'the two format information copies differ');
  const format = raw ^ 0x5412;
  assert.equal(polyMod(format, 0x537), 0, 'the format information is not a valid BCH codeword');
  const mask = (format >>> 10) & 7;
  const levelBits = (format >>> 13) & 3;
  const ecc = LEVELS.find((level) => LEVEL_BITS[level] === levelBits);
  assert.ok(ecc !== undefined, `level bits ${levelBits} are not a level`);

  if (version >= 7) {
    const versionInfo = readVersion(qr.modules, 0);
    assert.equal(readVersion(qr.modules, 1), versionInfo, 'the version information copies differ');
    assert.equal(polyMod(versionInfo, 0x1f25), 0, 'the version information is not a codeword');
    assert.equal(versionInfo >>> 12, version, 'the version information disagrees with the size');
  }

  const bits: boolean[] = [];
  for (const [x, y] of placementOrder(version)) {
    bits.push(qr.modules[y][x] !== maskBit(mask, y, x));
  }

  const total = qrTotalCodewords(version);
  const remainder = qrRemainderBits(version);
  assert.equal(bits.length, total * 8 + remainder, 'wrong number of data modules');
  for (let i = total * 8; i < bits.length; i += 1) {
    assert.equal(bits[i], false, 'the remainder bits must be light');
  }

  const codewords: number[] = [];
  for (let i = 0; i < total; i += 1) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | (bits[i * 8 + b] ? 1 : 0);
    codewords.push(byte);
  }

  const info = qrBlockInfo(version, ecc as EccLevel);
  const lengths: number[] = [];
  for (let b = 0; b < info.numBlocks; b += 1) {
    lengths.push(b < info.group1Blocks ? info.group1DataCodewords : info.group2DataCodewords);
  }
  const data: number[][] = lengths.map(() => []);
  const parity: number[][] = lengths.map(() => []);

  let at = 0;
  for (let round = 0; round < info.group2DataCodewords; round += 1) {
    for (let b = 0; b < info.numBlocks; b += 1) {
      if (round < lengths[b]) data[b].push(codewords[at++]);
    }
  }
  for (let round = 0; round < info.ecPerBlock; round += 1) {
    for (let b = 0; b < info.numBlocks; b += 1) parity[b].push(codewords[at++]);
  }
  assert.equal(at, total, 'the interleaved stream is not exactly the symbol capacity');

  // Every block, data and parity together, is a Reed-Solomon codeword, so it vanishes
  // at α^0 through α^(ecPerBlock - 1). This is what proves the error correction
  // codewords are right, computed here with independent field arithmetic.
  for (let b = 0; b < info.numBlocks; b += 1) {
    const codeword = [...data[b], ...parity[b]];
    assert.equal(codeword.length, lengths[b] + info.ecPerBlock);
    for (let j = 0; j < info.ecPerBlock; j += 1) {
      const alpha = gfPowAlpha(j);
      let sum = 0;
      for (const byte of codeword) sum = gfMul(sum, alpha) ^ byte;
      assert.equal(sum, 0, `block ${b} does not vanish at alpha^${j}`);
    }
  }

  const stream: boolean[] = [];
  for (const block of data) {
    for (const byte of block) {
      for (let b = 7; b >= 0; b -= 1) stream.push(((byte >>> b) & 1) === 1);
    }
  }

  return { version, ecc: ecc as EccLevel, mask, ...decodeStream(stream, version) };
}

/**
 * The data bit stream: an optional ECI header, the mode indicator, the character
 * count, the payload, and then a terminator and padding which are checked rather than
 * ignored - wrong padding is a real defect even though most readers never notice it.
 */
function decodeStream(stream: readonly boolean[], version: number): { mode: QrMode; text: string } {
  let at = 0;
  const take = (count: number): number => {
    assert.ok(at + count <= stream.length, 'the data stream ended early');
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = (value << 1) | (stream[at] ? 1 : 0);
      at += 1;
    }
    return value;
  };

  let indicator = take(4);
  if (indicator === 0b0111) {
    // ECI: assignment numbers below 128 take one byte, and 26 is UTF-8.
    assert.equal(take(8), 26, 'the only ECI assignment this encoder emits is UTF-8');
    indicator = take(4);
  }
  const modes: Record<number, QrMode> = { 0b0001: 'numeric', 0b0010: 'alphanumeric', 0b0100: 'byte' };
  const mode = modes[indicator];
  assert.ok(mode !== undefined, `${indicator.toString(2)} is not a mode indicator`);

  const count = take(countBits(mode, version));
  let text = '';
  if (mode === 'byte') {
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i += 1) bytes[i] = take(8);
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } else if (mode === 'numeric') {
    for (let left = count; left > 0; left -= 3) {
      const digits = Math.min(3, left);
      text += String(take(digits * 3 + 1)).padStart(digits, '0');
    }
  } else {
    for (let left = count; left > 0; left -= 2) {
      if (left === 1) {
        text += ALPHANUMERIC[take(6)];
      } else {
        const pair = take(11);
        assert.ok(pair < 45 * 45, 'an alphanumeric pair is out of range');
        text += ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45];
      }
    }
  }

  const terminator = Math.min(4, stream.length - at);
  for (let i = 0; i < terminator; i += 1) {
    assert.equal(stream[at + i], false, 'the terminator must be zero bits');
  }
  at += terminator;
  while (at % 8 !== 0) {
    assert.equal(stream[at], false, 'the last codeword must be padded with zero bits');
    at += 1;
  }
  let pad = 0xec;
  while (at < stream.length) {
    assert.equal(take(8), pad, 'the pad codewords must alternate between EC and 11');
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  return { mode, text };
}

/** Alphabets that between them exercise all three modes, with and without an ECI. */
const SAMPLE_ALPHABETS = [
  'abcdefghijklmnopqrstuvwxyz -_/?&=#',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789$%*+-./:',
  '0123456789',
  'éàüßñ¿¡ÀÖçø',
  '日本語のテキストと漢字',
  '🙂🎉🚀 mixed ünïcode ünd 漢字',
];

function randomPayload(random: () => number, ecc: EccLevel, version: number): string {
  const chars = [...SAMPLE_ALPHABETS[Math.floor(random() * SAMPLE_ALPHABETS.length)]];
  // Byte mode is the tightest of the three, so a budget in UTF-8 bytes fits whichever
  // mode the encoder picks. Two bytes spare covers the ECI header.
  const budget = Math.max(1, estimateCapacity(ecc, version, 'byte') - 2);
  const target = 1 + Math.floor(random() * budget);
  const encoder = new TextEncoder();
  let text = '';
  let bytes = 0;
  while (bytes < target) {
    const char = chars[Math.floor(random() * chars.length)];
    const width = encoder.encode(char).length;
    if (bytes + width > target) break;
    text += char;
    bytes += width;
  }
  return text.length > 0 ? text : 'A';
}

function assertRoundTrip(text: string, ecc: EccLevel, version: number): void {
  const qr = matrixOf(text, { ecc, minVersion: version, maxVersion: version });
  const decoded = decodeSymbol(qr);
  const label = `version ${version} level ${ecc}, ${text.length} characters`;
  assert.equal(decoded.text, text, label);
  assert.equal(decoded.version, version, label);
  assert.equal(decoded.ecc, ecc, label);
  assert.equal(decoded.mask, qr.mask, `${label} mask`);
  assert.equal(decoded.mode, qr.mode, `${label} mode`);
}

test('30 random payloads decode back to themselves across versions 1 to 15', () => {
  const random = mulberry32(0x5eed);
  for (let index = 0; index < 30; index += 1) {
    const version = 1 + (index % 15);
    const ecc = LEVELS[index % LEVELS.length];
    assertRoundTrip(randomPayload(random, ecc, version), ecc, version);
  }
});

test('the fixed examples decode back to themselves at every level', () => {
  // 11 alphanumeric characters fit version 1 at every level but H, which holds 10.
  assertRoundTrip('HELLO WORLD', 'M', 1);
  for (const ecc of LEVELS) {
    assertRoundTrip('HELLO WORLD', ecc, 2);
    assertRoundTrip('01234567', ecc, 1);
    assertRoundTrip('https://example.com/a/b?c=d#e', ecc, 4);
    // Latin-1 characters, so UTF-8 bytes without an ECI header.
    assertRoundTrip('Grüße aus München', ecc, 4);
    // Outside Latin-1, so an ECI header, and an astral code point as a surrogate pair.
    assertRoundTrip('日本語のテキスト 🙂', ecc, 5);
    // A payload that exactly fills the symbol, so there is no padding at all.
    assertRoundTrip('9'.repeat(estimateCapacity(ecc, 4, 'numeric')), ecc, 4);
  }
});

test('the decoder also reads back symbols with version information and many blocks', () => {
  // Version 7 is where version information appears, 20 and 40 have both block groups,
  // and level H at version 40 splits the data across 81 blocks.
  for (const version of [7, 20, 40]) {
    for (const ecc of LEVELS) {
      const capacity = estimateCapacity(ecc, version, 'byte');
      const text = 'flint tools qr '.repeat(400).slice(0, capacity);
      assert.equal(text.length, capacity);
      assertRoundTrip(text, ecc, version);
    }
  }
});

/** Whole rows of the published capacity table, as [numeric, alphanumeric, byte]. */
const CAPACITY_ROWS: [number, EccLevel, [number, number, number]][] = [
  [1, 'L', [41, 25, 17]],
  [1, 'M', [34, 20, 14]],
  [1, 'Q', [27, 16, 11]],
  [1, 'H', [17, 10, 7]],
  [2, 'L', [77, 47, 32]],
  [2, 'M', [63, 38, 26]],
  [2, 'Q', [48, 29, 20]],
  [2, 'H', [34, 20, 14]],
  [40, 'L', [7089, 4296, 2953]],
  [40, 'M', [5596, 3391, 2331]],
  [40, 'Q', [3993, 2420, 1663]],
  [40, 'H', [3057, 1852, 1273]],
];

/** Published figures from versions in between, one cell at a time. */
const CAPACITY_SPOTS: [number, EccLevel, QrMode, number][] = [
  [3, 'L', 'byte', 53],
  [4, 'L', 'byte', 78],
  [5, 'M', 'numeric', 202],
  [5, 'M', 'alphanumeric', 122],
  [5, 'M', 'byte', 84],
  [6, 'L', 'byte', 134],
  [7, 'L', 'byte', 154],
  [10, 'L', 'byte', 271],
  [10, 'M', 'byte', 213],
  [10, 'Q', 'byte', 151],
  [10, 'H', 'byte', 119],
  [15, 'L', 'byte', 520],
];

const MODES: QrMode[] = ['numeric', 'alphanumeric', 'byte'];

test('estimateCapacity matches the published character capacities', () => {
  // The two figures quoted most often, at the extremes of the range.
  assert.equal(estimateCapacity('L', 40, 'byte'), 2953);
  assert.equal(estimateCapacity('H', 1, 'numeric'), 17);

  for (const [version, ecc, expected] of CAPACITY_ROWS) {
    MODES.forEach((mode, index) => {
      assert.equal(
        estimateCapacity(ecc, version, mode),
        expected[index],
        `version ${version} level ${ecc} ${mode}`,
      );
    });
  }
  for (const [version, ecc, mode, expected] of CAPACITY_SPOTS) {
    assert.equal(estimateCapacity(ecc, version, mode), expected, `version ${version} ${ecc} ${mode}`);
  }

  // Out of range input answers zero rather than throwing, because this feeds a
  // character counter that runs on every keystroke.
  for (const version of [0, 41, 1.5, Number.NaN]) {
    assert.equal(estimateCapacity('L', version, 'byte'), 0, `version ${version}`);
  }
  assert.equal(estimateCapacity('X' as EccLevel, 1, 'byte'), 0);
});

/**
 * The four mask penalty rules, written out from the standard so that the mask the
 * encoder settles on can be compared with an independently computed winner.
 */
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** Rule 1: each run of five or more modules of one colour, in every row and column. */
function penaltyRuns(grid: readonly boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (let i = 0; i < size; i += 1) {
    const readers = [(k: number) => grid[i][k], (k: number) => grid[k][i]];
    for (const read of readers) {
      let run = 1;
      for (let k = 1; k < size; k += 1) {
        if (read(k) === read(k - 1)) {
          run += 1;
          if (run === 5) score += N1;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }
  return score;
}

/** Rule 2: each 2x2 block of one colour, so an m x n block counts (m - 1)(n - 1) times. */
function penaltyBlocks(grid: readonly boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (let row = 0; row + 1 < size; row += 1) {
    for (let col = 0; col + 1 < size; col += 1) {
      const colour = grid[row][col];
      if (
        grid[row][col + 1] === colour &&
        grid[row + 1][col] === colour &&
        grid[row + 1][col + 1] === colour
      ) {
        score += N2;
      }
    }
  }
  return score;
}

/** Rule 3: the finder ratio 1:1:3:1:1 with four light modules on one side of it. */
const FINDER_LIKE = [true, false, true, true, true, false, true];
const LIGHT_RUN = [false, false, false, false];
const N3_PATTERNS = [
  [...LIGHT_RUN, ...FINDER_LIKE],
  [...FINDER_LIKE, ...LIGHT_RUN],
];

function penaltyFinderLike(grid: readonly boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (const pattern of N3_PATTERNS) {
    for (let i = 0; i < size; i += 1) {
      for (let k = 0; k + pattern.length <= size; k += 1) {
        if (pattern.every((want, d) => grid[i][k + d] === want)) score += N3;
        if (pattern.every((want, d) => grid[k + d][i] === want)) score += N3;
      }
    }
  }
  return score;
}

/** Rule 4: every five per cent by which the dark share strays from half. */
function penaltyBalance(grid: readonly boolean[][]): number {
  const size = grid.length;
  const dark = countTrue(grid);
  return N4 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
}

function penaltyScore(grid: readonly boolean[][]): number {
  return penaltyRuns(grid) + penaltyBlocks(grid) + penaltyFinderLike(grid) + penaltyBalance(grid);
}

test('the mask is chosen deterministically and can be forced', () => {
  const samples: [string, EccLevel][] = [
    ['https://example.com/mask-selection-check', 'Q'],
    ['HELLO WORLD', 'M'],
    ['8675309', 'H'],
    ['Ein etwas laengerer Text, damit mehrere Bloecke entstehen.', 'L'],
  ];

  for (const [text, ecc] of samples) {
    const first = matrixOf(text, { ecc });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const again = matrixOf(text, { ecc });
      assert.equal(again.mask, first.mask, `${text} is not deterministic`);
      assert.deepEqual(again.modules, first.modules, `${text} modules are not deterministic`);
    }

    // Score the eight candidates independently. A forced encode draws the format
    // information for the mask it was given, so each candidate here is the very
    // grid the encoder scored while choosing.
    const scores: number[] = [];
    for (let mask = 0; mask < 8; mask += 1) {
      const forced = matrixOf(text, { ecc, mask });
      assert.equal(forced.mask, mask, `mask ${mask} was not honoured`);
      assert.equal(forced.version, first.version, `mask ${mask} changed the version`);
      assert.equal(readFormat(forced.modules, 0), qrFormatBits(ecc, mask), `mask ${mask} format`);
      assert.equal(decodeSymbol(forced).text, text, `mask ${mask} does not read back`);
      if (mask === first.mask) assert.deepEqual(forced.modules, first.modules);
      scores.push(penaltyScore(forced.modules));
    }

    const lowest = Math.min(...scores);
    assert.equal(
      first.mask,
      scores.indexOf(lowest),
      `${text}: penalties were ${scores.join(', ')} but mask ${first.mask} was chosen`,
    );
    // The eight really are different grids, so the choice is doing something.
    assert.ok(new Set(scores).size > 1, `${text}: every mask scored the same`);
  }

  assert.equal(errorOf('anything', { mask: 8 }), 'The mask pattern must be a whole number from 0 to 7.');
  assert.equal(errorOf('anything', { mask: -1 }), 'The mask pattern must be a whole number from 0 to 7.');
  assert.equal(errorOf('anything', { mask: 1.5 }), 'The mask pattern must be a whole number from 0 to 7.');
});

/** One merged rectangle of a path: move, right, down, back, close. */
const SUBPATH_RE = /M(-?\d+) (-?\d+)h(-?\d+)v(-?\d+)h(-?\d+)z/g;

/** Every rectangle in the path data, as [x, y, width, height] in user units. */
function parseSubPaths(path: string): [number, number, number, number][] {
  const rects: [number, number, number, number][] = [];
  let consumed = 0;
  SUBPATH_RE.lastIndex = 0;
  for (let match = SUBPATH_RE.exec(path); match !== null; match = SUBPATH_RE.exec(path)) {
    assert.equal(match.index, consumed, 'the path holds something other than merged rectangles');
    consumed += match[0].length;
    const width = Number(match[3]);
    const height = Number(match[4]);
    assert.equal(Number(match[5]), -width, 'the closing run must undo the opening one');
    assert.ok(width > 0 && height > 0, 'a rectangle must have a positive size');
    rects.push([Number(match[1]), Number(match[2]), width, height]);
  }
  assert.equal(consumed, path.length, 'the path has trailing junk');
  return rects;
}

/** Dark modules, and the maximal horizontal runs they fall into. */
function darkRuns(qr: QrMatrix): { runs: number; dark: number } {
  let runs = 0;
  let dark = 0;
  for (const row of qr.modules) {
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) continue;
      dark += 1;
      if (x === 0 || !row[x - 1]) runs += 1;
    }
  }
  return { runs, dark };
}

function emptyGrid(side: number): boolean[][] {
  return Array.from({ length: side }, () => new Array<boolean>(side).fill(false));
}

test('the path data is one merged path that repaints the symbol exactly', () => {
  const qr = matrixOf('https://example.com/path-data-check', { ecc: 'M' });
  const { runs, dark } = darkRuns(qr);
  const cases: { moduleSize?: number; margin?: number }[] = [
    {},
    { moduleSize: 3, margin: 0 },
    { moduleSize: 10, margin: 2 },
  ];

  for (const opts of cases) {
    const moduleSize = opts.moduleSize ?? 8;
    const margin = opts.margin ?? 4;
    const label = `moduleSize ${moduleSize} margin ${margin}`;
    const rects = parseSubPaths(qrToPathData(qr, opts));

    // One sub-path per maximal run: consecutive dark modules are genuinely merged.
    assert.equal(rects.length, runs, `${label}: sub-path count`);

    const grid = emptyGrid(qr.size + margin * 2);
    let painted = 0;
    for (const [x, y, width, height] of rects) {
      assert.equal(height, moduleSize, `${label}: row height`);
      assert.equal(width % moduleSize, 0, `${label}: run width`);
      assert.equal(x % moduleSize, 0, `${label}: x alignment`);
      assert.equal(y % moduleSize, 0, `${label}: y alignment`);
      const row = y / moduleSize;
      for (let k = 0; k < width / moduleSize; k += 1) {
        const col = x / moduleSize + k;
        assert.equal(grid[row][col], false, `${label}: module ${col},${row} painted twice`);
        grid[row][col] = true;
        painted += 1;
      }
    }
    assert.equal(painted, dark, `${label}: painted module count`);

    // And the painted grid is the symbol itself, shifted by the quiet zone.
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid.length; x += 1) {
        const inside = x >= margin && y >= margin && x < margin + qr.size && y < margin + qr.size;
        const want = inside ? qr.modules[y - margin][x - margin] : false;
        assert.equal(grid[y][x], want, `${label}: module ${x},${y}`);
      }
    }
  }

  // Merging matters most on the largest symbol, where a rect per module would be
  // tens of thousands of elements.
  const big = matrixOf('9'.repeat(7089), { ecc: 'L' });
  assert.equal(big.version, 40);
  assert.ok(parseSubPaths(qrToPathData(big)).length < darkRuns(big).dark);
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('the SVG is a single-path, scalable, labelled document', () => {
  const qr = matrixOf('https://example.com/svg-check', { ecc: 'Q' });
  const { dark } = darkRuns(qr);
  const side = (qr.size + 8) * 8;
  const svg = qrToSvg(qr);

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), svg.slice(0, 80));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes(`viewBox="0 0 ${side} ${side}"`), 'viewBox');
  assert.ok(svg.includes(`width="${side}" height="${side}"`), 'intrinsic size');
  assert.ok(svg.includes('shape-rendering="crispEdges"'), 'crisp edges');
  assert.ok(svg.includes('role="img"'), 'role');
  assert.equal(countOccurrences(svg, '<title>'), 1);
  assert.ok(
    svg.includes(`<title>QR code, version ${qr.version}, error correction level Q</title>`),
    'default title',
  );

  // Requirement: exactly one path element, and it is the merged one.
  assert.equal(countOccurrences(svg, '<path'), 1);
  assert.equal(countOccurrences(svg, '<circle'), 0);
  const d = svg.match(/<path fill="#000000" d="([^"]*)"\/>/);
  assert.ok(d !== null, 'the path is there with its fill');
  assert.equal(d[1], qrToPathData(qr));
  assert.equal(countOccurrences(svg, '<rect'), 1, 'the background');

  const transparent = qrToSvg(qr, { transparent: true });
  assert.equal(countOccurrences(transparent, '<rect'), 0, 'no background when transparent');
  assert.equal(countOccurrences(transparent, '<path'), 1);

  const rounded = qrToSvg(qr, { rounded: true });
  assert.equal(countOccurrences(rounded, '<path'), 0, 'rounded draws no path');
  assert.equal(countOccurrences(rounded, '<circle'), dark, 'one circle per dark module');
  assert.ok(rounded.includes('r="4"'), 'half a module of radius at the default size');
  assert.ok(rounded.includes('<circle cx="36" cy="36" r="4"/>'), 'the first module of the finder');

  const styled = qrToSvg(qr, { moduleSize: 2, margin: 1, dark: '#123456', light: 'none' });
  const styledSide = (qr.size + 2) * 2;
  assert.ok(styled.includes(`viewBox="0 0 ${styledSide} ${styledSide}"`));
  assert.ok(styled.includes('fill="#123456"'), 'dark colour');
  assert.ok(
    styled.includes(`<rect width="${styledSide}" height="${styledSide}" fill="none"/>`),
    'light colour',
  );

  // Anything that reaches an attribute or a text node is escaped.
  const escaped = qrToSvg(qr, { title: 'Tom & "Jerry" <b>', dark: '"><script>' });
  assert.ok(escaped.includes('<title>Tom &amp; &quot;Jerry&quot; &lt;b&gt;</title>'));
  assert.ok(!escaped.includes('<script>'), 'no raw markup from a colour');
  assert.equal(countOccurrences(escaped, '<path'), 1);
});

/** vCard and iCalendar line ends, spelled out so the tests below cannot fudge them. */
const CRLF = '\r\n';

/** Unwrap a builder that can refuse its input. */
function payloadOf(result: { ok: true; payload: string } | { ok: false; error: string }): string {
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.payload;
}

function refusalOf(result: { ok: true; payload: string } | { ok: false; error: string }): string {
  assert.equal(result.ok, false, 'expected this payload to be refused');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

test('the WiFi payload escapes everything a reader treats as structure', () => {
  assert.equal(
    buildWifiPayload({ ssid: 'Cafe Wifi', password: 'latte123' }),
    'WIFI:T:WPA;S:Cafe Wifi;P:latte123;;',
  );

  // The point of the escaping: a semicolon or a backslash must not end the field.
  assert.equal(
    buildWifiPayload({ ssid: 'Bar;Grill\\Cafe', password: 'a;b\\c' }),
    'WIFI:T:WPA;S:Bar\\;Grill\\\\Cafe;P:a\\;b\\\\c;;',
  );
  assert.equal(
    buildWifiPayload({ ssid: 'a,b:c"d', password: 'x,y:z"' }),
    'WIFI:T:WPA;S:a\\,b\\:c\\"d;P:x\\,y\\:z\\";;',
  );

  // An open network carries no password field at all, and says so in the type.
  assert.equal(buildWifiPayload({ ssid: 'Airport Free' }), 'WIFI:T:nopass;S:Airport Free;;');
  assert.equal(
    buildWifiPayload({ ssid: 'Open', security: 'nopass', password: 'ignored' }),
    'WIFI:T:nopass;S:Open;;',
  );
  assert.equal(
    buildWifiPayload({ ssid: 'Old Router', password: 'wep-key', security: 'WEP' }),
    'WIFI:T:WEP;S:Old Router;P:wep-key;;',
  );
  assert.equal(
    buildWifiPayload({ ssid: 'Hidden', password: 'p', hidden: true }),
    'WIFI:T:WPA;S:Hidden;P:p;H:true;;',
  );
  assert.equal(buildWifiPayload({ ssid: 'Hidden', hidden: false }), 'WIFI:T:nopass;S:Hidden;;');

  const payload = buildWifiPayload({ ssid: 'Bar;Grill', password: 'a\\b' });
  assert.equal(decodeSymbol(matrixOf(payload, { ecc: 'M' })).text, payload);
});

test('the vCard is 3.0, CRLF terminated, with reserved characters escaped', () => {
  const card = buildVCardPayload({
    firstName: '  Ada  ',
    lastName: 'Lovelace',
    org: 'Analytical Engine, Ltd',
    title: 'Mathematician; Writer',
    phone: '+44 20 7946 0958',
    email: 'ada@example.com',
    url: 'https://example.com/ada',
    address: '12 Bond Street, London, W1S 1AA',
    note: 'Met at the\nexhibition',
  });

  assert.deepEqual(card.split(CRLF), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Lovelace;Ada;;;',
    'FN:Ada Lovelace',
    'ORG:Analytical Engine\\, Ltd',
    'TITLE:Mathematician\\; Writer',
    'TEL:+44 20 7946 0958',
    'EMAIL:ada@example.com',
    'URL:https://example.com/ada',
    'NOTE:Met at the\\nexhibition',
    'ADR:;;12 Bond Street\\, London\\, W1S 1AA;;;;',
    'END:VCARD',
    '',
  ]);

  // Every line end is a full CRLF, including the last one, and no bare LF slips in.
  assert.ok(card.endsWith(`END:VCARD${CRLF}`), 'the final line is terminated');
  assert.equal((card.match(/\r\n/g) ?? []).length, card.split('\n').length - 1);
  assert.equal(card.match(/\r(?!\n)/), null, 'no bare carriage return');

  // Empty fields are left out rather than emitted blank, but N and FN are mandatory.
  assert.deepEqual(buildVCardPayload({ firstName: 'Ada' }).split(CRLF), [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:;Ada;;;', 'FN:Ada', 'END:VCARD', '',
  ]);
  assert.deepEqual(buildVCardPayload({ lastName: 'Lovelace', org: '   ' }).split(CRLF), [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;;;;', 'FN:Lovelace', 'END:VCARD', '',
  ]);
  assert.deepEqual(buildVCardPayload({}).split(CRLF), [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:', 'END:VCARD', '',
  ]);

  assert.equal(decodeSymbol(matrixOf(card, { ecc: 'L' })).text, card);
});

test('the mailto, SMS and geo payloads follow their schemes', () => {
  assert.equal(buildEmailPayload({ to: ' ada@example.com ' }), 'mailto:ada@example.com');
  assert.equal(
    buildEmailPayload({ to: 'ada@example.com', subject: 'Hello there & welcome' }),
    'mailto:ada@example.com?subject=Hello%20there%20%26%20welcome',
  );
  assert.equal(
    buildEmailPayload({ to: 'ada@example.com', body: 'Line one\nLine two' }),
    'mailto:ada@example.com?body=Line%20one%0ALine%20two',
  );
  assert.equal(
    buildEmailPayload({ to: 'ada@example.com', subject: 'Re: notes', body: 'a=b&c' }),
    'mailto:ada@example.com?subject=Re%3A%20notes&body=a%3Db%26c',
  );

  assert.equal(
    buildSmsPayload({ phone: '+44 20 7946 0958', message: 'Running late' }),
    'SMSTO:+442079460958:Running late',
  );
  assert.equal(buildSmsPayload({ phone: '(020) 7946-0958' }), 'SMSTO:02079460958');
  assert.equal(buildSmsPayload({ phone: '020 7946 0958', message: '' }), 'SMSTO:02079460958');
  assert.equal(buildSmsPayload({ phone: '+1 555 0100', message: 'Time: 5pm' }), 'SMSTO:+15550100:Time: 5pm');

  assert.equal(payloadOf(buildGeoPayload({ lat: 51.5007, lon: -0.1246 })), 'geo:51.5007,-0.1246');
  assert.equal(payloadOf(buildGeoPayload({ lat: 0, lon: 0 })), 'geo:0,0');
  assert.equal(payloadOf(buildGeoPayload({ lat: 51.50073456789, lon: -0.1 })), 'geo:51.500735,-0.1');
  // The edges of the world are inside it.
  for (const [lat, lon] of [[90, 180], [-90, -180]]) {
    assert.equal(payloadOf(buildGeoPayload({ lat, lon })), `geo:${lat},${lon}`);
  }

  // A latitude of 91 is the classic swapped-coordinates mistake, and it is refused
  // with the offending number in the message rather than silently pinned at sea.
  const refusal = refusalOf(buildGeoPayload({ lat: 91, lon: 0 }));
  assert.match(refusal, /Latitude runs from -90 to 90 degrees/);
  assert.match(refusal, /91/);
  assert.match(refusal, /wrong way round/);
  assert.match(refusalOf(buildGeoPayload({ lat: -90.5, lon: 0 })), /-90\.5 is outside the world/);
  assert.match(refusalOf(buildGeoPayload({ lat: 0, lon: 181 })), /Longitude runs from -180 to 180/);
  assert.match(refusalOf(buildGeoPayload({ lat: Number.NaN, lon: 0 })), /latitude as a number/);
  assert.match(
    refusalOf(buildGeoPayload({ lat: 0, lon: Number.POSITIVE_INFINITY })),
    /longitude as a number/,
  );
});

test('the calendar event is a VEVENT in UTC that refuses impossible times', () => {
  const event = payloadOf(
    buildEventPayload({
      title: 'Launch',
      start: '2026-09-03T14:00Z',
      end: '2026-09-03T15:30Z',
      location: 'Room 1, Floor 2',
      description: 'Bring; notes',
    }),
  );
  assert.deepEqual(event.split(CRLF), [
    'BEGIN:VEVENT',
    'SUMMARY:Launch',
    'DTSTART:20260903T140000Z',
    'DTEND:20260903T153000Z',
    'LOCATION:Room 1\\, Floor 2',
    'DESCRIPTION:Bring\\; notes',
    'END:VEVENT',
    '',
  ]);
  assert.equal(decodeSymbol(matrixOf(event, { ecc: 'M' })).text, event);

  // No end time means an hour, and an offset is converted rather than dropped.
  const defaulted = payloadOf(buildEventPayload({ title: 'Standup', start: '2026-09-03T14:00Z' }));
  assert.ok(defaulted.includes(`DTSTART:20260903T140000Z${CRLF}DTEND:20260903T150000Z`), defaulted);
  const shifted = payloadOf(buildEventPayload({ title: 'Call', start: '2026-09-03T14:00+02:00' }));
  assert.ok(shifted.includes('DTSTART:20260903T120000Z'), shifted);
  const seconds = payloadOf(buildEventPayload({ title: 'Exact', start: '2026-01-05 08:07:06Z' }));
  assert.ok(seconds.includes('DTSTART:20260105T080706Z'), seconds);
  // Without an offset the local zone applies, so only the shape is fixed.
  const local = payloadOf(buildEventPayload({ title: 'Local', start: '2026-09-03T14:00' }));
  assert.match(local, /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z\r\n/);

  // An end before, or exactly at, the start is refused.
  const backwards = refusalOf(
    buildEventPayload({ title: 'Time travel', start: '2026-09-03T15:00Z', end: '2026-09-03T14:00Z' }),
  );
  assert.equal(backwards, 'The event has to end after it starts. Check the end date and time.');
  assert.equal(
    refusalOf(buildEventPayload({ title: 'Zero', start: '2026-09-03T14:00Z', end: '2026-09-03T14:00Z' })),
    backwards,
  );

  assert.match(refusalOf(buildEventPayload({ title: '', start: '2026-09-03T14:00Z' })), /title/);
  assert.match(refusalOf(buildEventPayload({ title: 'x', start: 'tomorrow' })), /start time/);
  assert.match(
    refusalOf(buildEventPayload({ title: 'x', start: '2026-09-03T14:00Z', end: 'later' })),
    /end time/,
  );
  // `new Date` would read 30 February as 2 March, which is not the day anyone typed.
  for (const impossible of ['2026-02-30T14:00Z', '2026-04-31T09:00', '2026-13-01T14:00Z', '2026-00-10T14:00Z']) {
    assert.match(
      refusalOf(buildEventPayload({ title: 'x', start: impossible })),
      /not a real date and time/,
      impossible,
    );
  }
  // But a real leap day is fine.
  assert.ok(
    payloadOf(buildEventPayload({ title: 'Leap', start: '2028-02-29T14:00Z' })).includes('DTSTART:20280229T140000Z'),
  );
});

test('too much text is refused with the size of the overflow', () => {
  // Byte mode, at the level the caller asked for and at the default level.
  assert.equal(
    errorOf('a'.repeat(3000), { ecc: 'L' }),
    'That is 47 bytes too long. The largest QR code holds 2953 bytes at error correction level L.',
  );
  assert.equal(
    errorOf('a'.repeat(3000)),
    'That is 669 bytes too long. The largest QR code holds 2331 bytes at error ' +
      'correction level M, and more at level L.',
  );

  // One unit over, in each mode, so the singular reads properly too.
  assert.equal(
    errorOf('1'.repeat(7090), { ecc: 'L' }),
    'That is 1 digit too long. The largest QR code holds 7089 digits at error correction level L.',
  );
  assert.equal(
    errorOf('A'.repeat(4297), { ecc: 'L' }),
    'That is 1 character too long. The largest QR code holds 4296 characters at error ' +
      'correction level L.',
  );

  // Text that needs an ECI header pays for it, so the ceiling is one byte lower.
  assert.equal(
    errorOf('日'.repeat(1000), { ecc: 'L' }),
    'That is 48 bytes too long. The largest QR code holds 2952 bytes at error correction level L.',
  );

  // Inside the version range the message points at the version that would work.
  assert.equal(
    errorOf('HELLO WORLD', { ecc: 'H', maxVersion: 1 }),
    'This text needs a version 2 QR code at error correction level H, but version 1 is the ' +
      'largest allowed. Raise the maximum version or shorten the text.',
  );

  // The boundary itself: exactly full encodes, one more does not.
  const boundaries: [number, EccLevel, QrMode][] = [
    [1, 'M', 'byte'],
    [5, 'M', 'byte'],
    [10, 'Q', 'numeric'],
    [15, 'L', 'alphanumeric'],
  ];
  for (const [version, ecc, mode] of boundaries) {
    const capacity = estimateCapacity(ecc, version, mode);
    const unit = mode === 'numeric' ? '7' : mode === 'alphanumeric' ? 'A' : 'a';
    const label = `version ${version} level ${ecc} ${mode}`;
    const full = matrixOf(unit.repeat(capacity), { ecc, maxVersion: version });
    assert.equal(full.version, version, label);
    assert.equal(full.mode, mode, label);
    assert.match(errorOf(unit.repeat(capacity + 1), { ecc, maxVersion: version }), /needs a version/, label);
  }
});

test('empty and invalid input is refused in words a person can act on', () => {
  const nothing = 'Enter some text, a link or a phone number to turn into a QR code.';
  assert.equal(errorOf(''), nothing);
  assert.equal(errorOf('', { ecc: 'H' }), nothing);
  for (const value of [undefined, null, 0, 42, {}, []]) {
    assert.equal(errorOf(value as unknown as string), nothing, String(value));
  }

  // A single space is content, not emptiness - it is in the alphanumeric charset.
  const space = matrixOf(' ');
  assert.equal(space.mode, 'alphanumeric');
  assert.equal(decodeSymbol(space).text, ' ');

  assert.equal(errorOf('x', { ecc: 'A' as EccLevel }), 'Choose an error correction level of L, M, Q or H.');
  assert.equal(errorOf('x', { minVersion: 0 }), 'minVersion must be a whole number from 1 to 40.');
  assert.equal(errorOf('x', { maxVersion: 41 }), 'maxVersion must be a whole number from 1 to 40.');
  assert.equal(errorOf('x', { maxVersion: 2.5 }), 'maxVersion must be a whole number from 1 to 40.');
  assert.equal(errorOf('x', { minVersion: 5, maxVersion: 4 }), 'minVersion cannot be larger than maxVersion.');

  // minVersion raises the symbol without changing what it says.
  const forced = matrixOf('x', { minVersion: 5, maxVersion: 5 });
  assert.equal(forced.version, 5);
  assert.equal(forced.size, 37);
  assert.equal(decodeSymbol(forced).text, 'x');

  // Every refusal is a sentence, so a form can show it verbatim.
  const messages = [
    nothing,
    errorOf('a'.repeat(3000), { ecc: 'L' }),
    errorOf('HELLO WORLD', { ecc: 'H', maxVersion: 1 }),
    errorOf('x', { mask: 9 }),
    refusalOf(buildGeoPayload({ lat: 91, lon: 0 })),
    refusalOf(buildEventPayload({ title: '', start: '2026-09-03T14:00Z' })),
  ];
  for (const message of messages) {
    assert.match(message, /^[A-Z0-9]/, message);
    assert.match(message, /\.$/, message);
    assert.ok(message.length < 200, message);
  }
});

test('the finished symbol reports whether a UTF-8 header was emitted', () => {
  // Latin-1 is byte mode's assumed charset, so nothing up to U+00FF needs the
  // header - not even the accents that look like they would.
  for (const text of ['12345', 'HELLO WORLD', 'hello world', 'café', 'ÿ']) {
    assert.equal(matrixOf(text).eci, false, text);
  }
  // Anything above it does. A reader that ignores the header shows mojibake, so an
  // interface has to be able to see this to be able to warn about it.
  for (const text of ['你好', 'naı̈ve — dash', '😀']) {
    assert.equal(matrixOf(text).eci, true, text);
    assert.equal(matrixOf(text).mode, 'byte', text);
  }

  // The header costs 12 bits, which is a real charge against capacity rather than
  // a label. Version 1 at level L holds 17 bytes of byte-mode data; the same 17
  // bytes no longer fit once 12 of the available bits have gone on the header.
  const plain = matrixOf('a'.repeat(17), { ecc: 'L', maxVersion: 1 });
  assert.equal(plain.version, 1);
  assert.equal(plain.eci, false);

  const wide = '你'.repeat(5) + 'aa';
  assert.equal(new TextEncoder().encode(wide).length, 17);
  assert.equal(
    errorOf(wide, { ecc: 'L', maxVersion: 1 }),
    'This text needs a version 2 QR code at error correction level L, ' +
      'but version 1 is the largest allowed. Raise the maximum version or shorten the text.',
  );
  assert.equal(matrixOf(wide).eci, true);
  assert.equal(decodeSymbol(matrixOf(wide)).text, wide);
});
