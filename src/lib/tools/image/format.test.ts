/**
 * These tests run against real files, not hand-typed byte arrays.
 *
 * A sniffer that passes on fixtures written by the person who wrote the sniffer
 * proves nothing: the same misunderstanding goes into both. So a Python script
 * drives Pillow — a different implementation, by other people — to write every
 * format into /tmp/img-fixtures, and the assertions check the dimensions Pillow
 * itself reads back. The few files Pillow cannot produce (big-endian TIFF, the
 * 1990 BMP header, an interlaced PNG) are packed by hand from the specification
 * and then handed to Pillow to confirm they are what they claim to be.
 *
 * `node:fs`, `node:child_process` and `Buffer` appear here and nowhere in the
 * module under test, which must stay pure and isomorphic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BROWSER_ENCODABLE,
  canEncodeTo,
  extensionForFormat,
  formatFromMime,
  humanBytes,
  isFormatMismatch,
  mimeForFormat,
  outputFileName,
  savingsSummary,
  sniffImage,
} from './format.ts';
import type { ImageFormat, Sniffed } from './format.ts';

const FIXTURES = '/tmp/img-fixtures';
const MANIFEST = join(FIXTURES, 'manifest.json');
/** Deliberately not square, and not a round number: a transposed width shows up. */
const W = 37;
const H = 91;

/**
 * The fixture generator. String.raw so that Python's own backslashes survive.
 *
 * Every save is wrapped: a format Pillow was built without must record why and
 * carry on, so the test that wanted it can skip with a real reason instead of the
 * whole file failing to load.
 */
const GENERATOR = String.raw`
import json
import os
import struct
import zlib

import PIL
from PIL import Image, ImageDraw

OUT = '/tmp/img-fixtures'
W = 37
H = 91
os.makedirs(OUT, exist_ok=True)
skipped = {}

def at(name):
    return os.path.join(OUT, name)

def attempt(name, fn):
    try:
        fn()
    except Exception as exc:
        skipped[name] = type(exc).__name__ + ': ' + str(exc).replace(chr(10), ' ')[:200]
        if os.path.exists(at(name)):
            os.remove(at(name))

def rgb():
    im = Image.new('RGB', (W, H), (198, 40, 66))
    d = ImageDraw.Draw(im)
    for y in range(0, H, 6):
        d.line((0, y, W, y), fill=(24, 96, 200))
    d.ellipse((4, 10, 30, 60), fill=(250, 220, 30))
    return im

def rgba():
    im = rgb().convert('RGBA')
    px = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if y > H // 2 else 90)
    return im

def frames():
    out = []
    for i in range(4):
        im = Image.new('RGB', (W, H), (20 * i, 60, 200 - 20 * i))
        d = ImageDraw.Draw(im)
        d.rectangle((i, i, i + 8, i + 8), fill=(255, 255, 0))
        out.append(im)
    return out

def save_all(name, options):
    def run():
        parts = frames()
        parts[0].save(at(name), save_all=True, append_images=parts[1:], duration=120, loop=0, **options)
    return run

attempt('jpeg-baseline.jpg', lambda: rgb().save(at('jpeg-baseline.jpg'), 'JPEG', quality=85, progressive=False))
attempt('jpeg-progressive.jpg', lambda: rgb().save(at('jpeg-progressive.jpg'), 'JPEG', quality=85, progressive=True))
attempt('jpeg-grey.jpg', lambda: rgb().convert('L').save(at('jpeg-grey.jpg'), 'JPEG', quality=80))
attempt('png-rgb.png', lambda: rgb().save(at('png-rgb.png'), 'PNG'))
attempt('png-rgba.png', lambda: rgba().save(at('png-rgba.png'), 'PNG'))
attempt('png-palette-trns.png', lambda: rgb().convert('P', palette=Image.ADAPTIVE, colors=16).save(at('png-palette-trns.png'), 'PNG', transparency=0))
attempt('apng.png', save_all('apng.png', {'format': 'PNG'}))
attempt('gif-static.gif', lambda: rgb().save(at('gif-static.gif'), 'GIF'))
attempt('gif-animated.gif', save_all('gif-animated.gif', {'format': 'GIF'}))
attempt('gif-transparent.gif', lambda: rgb().convert('P', palette=Image.ADAPTIVE, colors=8).save(at('gif-transparent.gif'), 'GIF', transparency=0))
attempt('webp-lossy.webp', lambda: rgb().save(at('webp-lossy.webp'), 'WEBP', lossless=False, quality=80))
attempt('webp-lossless.webp', lambda: rgb().save(at('webp-lossless.webp'), 'WEBP', lossless=True))
attempt('webp-lossy-alpha.webp', lambda: rgba().save(at('webp-lossy-alpha.webp'), 'WEBP', lossless=False, quality=80))
attempt('webp-lossless-alpha.webp', lambda: rgba().save(at('webp-lossless-alpha.webp'), 'WEBP', lossless=True))
attempt('webp-animated.webp', save_all('webp-animated.webp', {'format': 'WEBP'}))
attempt('bmp.bmp', lambda: rgb().save(at('bmp.bmp'), 'BMP'))
attempt('tiff-le.tif', lambda: rgb().save(at('tiff-le.tif'), 'TIFF'))
attempt('tiff-rgba.tif', lambda: rgba().save(at('tiff-rgba.tif'), 'TIFF'))
attempt('ico.ico', lambda: rgb().save(at('ico.ico'), 'ICO', sizes=[(W, H)]))
attempt('ico-multi.ico', lambda: rgb().save(at('ico-multi.ico'), 'ICO', sizes=[(16, 16), (32, 32), (W, H)]))
attempt('avif.avif', lambda: rgb().save(at('avif.avif'), 'AVIF'))
attempt('avif-alpha.avif', lambda: rgba().save(at('avif-alpha.avif'), 'AVIF'))
# Pillow reads HEIF through a plugin but has no encoder for it, so this is
# expected to fail. The test that wants it skips with whatever it says here.
attempt('heic-real.heic', lambda: rgb().save(at('heic-real.heic'), 'HEIF'))

def bgr_rows():
    im = rgb()
    px = im.load()
    stride = (W * 3 + 3) // 4 * 4
    out = []
    for y in range(H):
        line = bytearray()
        for x in range(W):
            r, g, b = px[x, y]
            line += bytes((b, g, r))
        line += bytes(stride - len(line))
        out.append(bytes(line))
    return out

def bmp_core():
    body = b''.join(reversed(bgr_rows()))
    head = struct.pack('<IHHHH', 12, W, H, 1, 24)
    open(at('bmp-core.bmp'), 'wb').write(
        b'BM' + struct.pack('<IHHI', 14 + len(head) + len(body), 0, 0, 14 + len(head)) + head + body)

def bmp_topdown():
    body = b''.join(bgr_rows())
    head = struct.pack('<IiiHHIIiiII', 40, W, -H, 1, 24, 0, len(body), 2835, 2835, 0, 0)
    open(at('bmp-topdown.bmp'), 'wb').write(
        b'BM' + struct.pack('<IHHI', 14 + len(head) + len(body), 0, 0, 14 + len(head)) + head + body)

def tiff_be():
    strip = rgb().tobytes()
    bits_at = 8 + 2 + 12 * 9 + 4
    entries = [
        (256, 4, 1, struct.pack('>I', W)),
        (257, 3, 1, struct.pack('>HH', H, 0)),
        (258, 3, 3, struct.pack('>I', bits_at)),
        (259, 3, 1, struct.pack('>HH', 1, 0)),
        (262, 3, 1, struct.pack('>HH', 2, 0)),
        (273, 4, 1, struct.pack('>I', bits_at + 6)),
        (277, 3, 1, struct.pack('>HH', 3, 0)),
        (278, 4, 1, struct.pack('>I', H)),
        (279, 4, 1, struct.pack('>I', len(strip))),
    ]
    ifd = struct.pack('>H', len(entries))
    for tag, typ, count, value in entries:
        ifd += struct.pack('>HHI', tag, typ, count) + value
    ifd += struct.pack('>I', 0)
    open(at('tiff-be.tif'), 'wb').write(
        b'MM\x00\x2a' + struct.pack('>I', 8) + ifd + struct.pack('>HHH', 8, 8, 8) + strip)

def heic_brand():
    # Pillow has no HEIF encoder, so a genuine HEIC cannot be made here. Rewriting
    # the AVIF's ftyp brands to heic is a four-for-four-byte swap, so every offset
    # in the file still lines up: the container is real, only the brand is staged.
    raw = open(at('avif.avif'), 'rb').read()
    end = struct.unpack_from('>I', raw, 0)[0]
    if end < 12 or end > len(raw):
        raise ValueError('unexpected ftyp size ' + str(end))
    open(at('heic-brand.heic'), 'wb').write(raw[:end].replace(b'avif', b'heic') + raw[end:])

def png_interlaced():
    # Pillow cannot write Adam7, and the interlace flag is a single header byte, so
    # set it and repair the IHDR CRC. The reader only ever looks at the header.
    raw = bytearray(open(at('png-rgb.png'), 'rb').read())
    raw[28] = 1
    raw[29:33] = struct.pack('>I', zlib.crc32(bytes(raw[12:29])))
    open(at('png-interlaced.png'), 'wb').write(bytes(raw))

attempt('bmp-core.bmp', bmp_core)
attempt('bmp-topdown.bmp', bmp_topdown)
attempt('tiff-be.tif', tiff_be)
attempt('heic-brand.heic', heic_brand)
attempt('png-interlaced.png', png_interlaced)

# Every fixture is opened again through Pillow, so the dimensions the tests assert
# come from another implementation and not from this script's intentions. Pillow
# has no HEIF decoder either, so the staged HEIC is excluded by name.
sizes = {}
unreadable = {}
for name in sorted(os.listdir(OUT)):
    if name == 'manifest.json' or name == 'heic-brand.heic':
        continue
    try:
        with Image.open(at(name)) as im:
            sizes[name] = [im.width, im.height, im.format]
    except Exception as exc:
        unreadable[name] = type(exc).__name__ + ': ' + str(exc)[:120]

# Written last, and used as the "already generated" marker: a run killed halfway
# leaves no manifest, so the next one starts again rather than testing rubble.
with open(at('manifest.json'), 'w') as handle:
    json.dump({'pillow': PIL.__version__, 'skipped': skipped, 'sizes': sizes, 'unreadable': unreadable}, handle, indent=1)
`;

interface Manifest {
  pillow: string;
  /** Fixture name to the reason Pillow could not write it. */
  skipped: Record<string, string>;
  /** Fixture name to [width, height, format] as Pillow reads it back. */
  sizes: Record<string, [number, number, string]>;
  unreadable: Record<string, string>;
}

/**
 * Generate the fixtures once. A second run reuses them, which keeps the test
 * quick — but the marker is the manifest rather than the directory, so an
 * interrupted generation is redone instead of half-tested.
 */
function loadFixtures(): Manifest {
  if (!existsSync(MANIFEST)) {
    execFileSync('python3', ['-'], { input: GENERATOR, stdio: ['pipe', 'inherit', 'inherit'] });
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
}

const manifest = loadFixtures();
const fixtureNames = readdirSync(FIXTURES).filter((name) => name !== 'manifest.json').sort();

function bytesOf(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

interface Expected {
  format: ImageFormat;
  /** Left out where the header honestly cannot say — the first ICO entry, mainly. */
  width?: number;
  height?: number;
  hasAlpha?: boolean | null;
  animated?: boolean | null;
  note?: RegExp;
}

const EXPECTED: Record<string, Expected> = {
  'jpeg-baseline.jpg': { format: 'jpeg', width: W, height: H, hasAlpha: false, animated: false, note: /baseline/i },
  'jpeg-progressive.jpg': { format: 'jpeg', width: W, height: H, hasAlpha: false, note: /progressive/i },
  'jpeg-grey.jpg': { format: 'jpeg', width: W, height: H, note: /greyscale/i },
  'png-rgb.png': { format: 'png', width: W, height: H, hasAlpha: false, animated: false, note: /8-bit/ },
  'png-rgba.png': { format: 'png', width: W, height: H, hasAlpha: true, animated: false },
  'png-palette-trns.png': { format: 'png', width: W, height: H, hasAlpha: true, note: /palette/ },
  'png-interlaced.png': { format: 'png', width: W, height: H, note: /interlaced/i },
  'apng.png': { format: 'png', width: W, height: H, animated: true, note: /APNG with 4 frames/ },
  'gif-static.gif': { format: 'gif', width: W, height: H, hasAlpha: false, animated: false },
  'gif-animated.gif': { format: 'gif', width: W, height: H, animated: true, note: /4 frames/ },
  'gif-transparent.gif': { format: 'gif', width: W, height: H, hasAlpha: true, animated: false },
  'webp-lossy.webp': { format: 'webp', width: W, height: H, hasAlpha: false, animated: false, note: /lossy/ },
  'webp-lossless.webp': { format: 'webp', width: W, height: H, hasAlpha: false, animated: false, note: /lossless/ },
  'webp-lossy-alpha.webp': { format: 'webp', width: W, height: H, hasAlpha: true, animated: false },
  'webp-lossless-alpha.webp': { format: 'webp', width: W, height: H, hasAlpha: true, animated: false },
  'webp-animated.webp': { format: 'webp', width: W, height: H, animated: true, note: /animated WebP with 4 frames/ },
  'bmp.bmp': { format: 'bmp', width: W, height: H, hasAlpha: false, animated: false, note: /24-bit/ },
  'bmp-core.bmp': { format: 'bmp', width: W, height: H, hasAlpha: false, note: /1990 header/ },
  'bmp-topdown.bmp': { format: 'bmp', width: W, height: H, note: /top-down/ },
  'tiff-le.tif': { format: 'tiff', width: W, height: H, hasAlpha: false, animated: false, note: /little-endian/ },
  'tiff-be.tif': { format: 'tiff', width: W, height: H, hasAlpha: false, note: /big-endian/ },
  'tiff-rgba.tif': { format: 'tiff', width: W, height: H, hasAlpha: true },
  'ico.ico': { format: 'ico', width: W, height: H, animated: false, note: /one image/ },
  // The directory's first entry is the 7x16 thumbnail Pillow put first, not the
  // largest image, so the exact size is asserted in its own test instead.
  'ico-multi.ico': { format: 'ico', animated: false, note: /3 images/ },
  'avif.avif': { format: 'avif', width: W, height: H, hasAlpha: false, animated: false, note: /AVIF/ },
  'avif-alpha.avif': { format: 'avif', width: W, height: H, hasAlpha: true, animated: false },
  'heic-brand.heic': { format: 'heic', width: W, height: H, animated: false, note: /HEIC/ },
};

test('every fixture is identified, and its size read exactly', async (t) => {
  const missing = fixtureNames.filter((name) => !(name in EXPECTED));
  assert.deepEqual(missing, [], 'a fixture with no expectation is an untested fixture');

  for (const [name, want] of Object.entries(EXPECTED)) {
    await t.test(name, (subtest) => {
      if (manifest.skipped[name]) {
        subtest.skip(`Pillow could not write ${name}: ${manifest.skipped[name]}`);
        return;
      }
      const sniffed = sniffImage(bytesOf(name));
      assert.equal(sniffed.format, want.format, `format of ${name}`);
      assert.equal(sniffed.mime, mimeForFormat(want.format));
      assert.equal(sniffed.extension, extensionForFormat(want.format));
      if (want.width !== undefined) assert.equal(sniffed.width, want.width, `width of ${name}`);
      if (want.height !== undefined) assert.equal(sniffed.height, want.height, `height of ${name}`);
      if (want.hasAlpha !== undefined) assert.equal(sniffed.hasAlpha, want.hasAlpha, `hasAlpha of ${name}`);
      if (want.animated !== undefined) assert.equal(sniffed.animated, want.animated, `animated of ${name}`);
      if (want.note) assert.match(sniffed.note, want.note, `note of ${name}`);
      assert.ok(sniffed.note.length > 20, 'every note has to be a sentence a person can read');
    });
  }
});

test('the dimensions agree with what Pillow reads back out of the same file', () => {
  const checked: string[] = [];
  for (const [name, [width, height]] of Object.entries(manifest.sizes)) {
    const sniffed = sniffImage(bytesOf(name));
    if (name === 'ico-multi.ico') continue; // its first entry is not its largest
    assert.equal(sniffed.width, width, `width of ${name} against Pillow`);
    assert.equal(sniffed.height, height, `height of ${name} against Pillow`);
    checked.push(name);
  }
  assert.deepEqual(manifest.unreadable, {}, 'a fixture Pillow cannot reopen is not a fixture');
  assert.ok(checked.length >= 20, `only ${checked.length} files were cross-checked`);
});

test('a real HEIC from a phone', (t) => {
  const reason = manifest.skipped['heic-real.heic'];
  if (reason) {
    // Not a weakened assertion: Pillow reads HEIF through libheif but ships no
    // encoder, so there is no genuine HEIC to be had here. heic-brand.heic covers
    // the brand mapping and the ispe walk on a real ISO container.
    t.skip(`Pillow ${manifest.pillow} cannot write HEIF, so no genuine HEIC exists to test (${reason})`);
    return;
  }
  const sniffed = sniffImage(bytesOf('heic-real.heic'));
  assert.equal(sniffed.format, 'heic');
  assert.equal(sniffed.width, W);
  assert.equal(sniffed.height, H);
  assert.match(sniffed.note, /HEIC/);
});

test('a multi-size icon reports its first entry and names its largest', () => {
  const sniffed = sniffImage(bytesOf('ico-multi.ico'));
  assert.equal(sniffed.format, 'ico');
  // Pillow writes the sizes in ascending order and thumbnails them to fit, so the
  // first directory entry is 16 tall and 37/91 * 16 wide.
  assert.equal(sniffed.width, 7);
  assert.equal(sniffed.height, 16);
  assert.match(sniffed.note, /3 images/);
  assert.match(sniffed.note, /largest in the file is 37x91/);
});

const KNOWN_FORMATS: readonly ImageFormat[] = [
  'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'tiff', 'ico', 'svg', 'unknown',
];

/**
 * Everything that must hold for any bytes at all, valid or not: no throw, a real
 * format, mime and extension that follow it, dimensions that are either a positive
 * integer or an honest null, and a note somebody could read.
 */
function assertShape(sniffed: Sniffed, label: string): void {
  assert.ok(KNOWN_FORMATS.includes(sniffed.format), `${label} invented the format ${sniffed.format}`);
  assert.equal(sniffed.mime, mimeForFormat(sniffed.format), `${label} mime`);
  assert.equal(sniffed.extension, extensionForFormat(sniffed.format), `${label} extension`);
  for (const value of [sniffed.width, sniffed.height]) {
    assert.ok(value === null || (Number.isInteger(value) && value > 0), `${label} gave the dimension ${value}`);
  }
  assert.ok(sniffed.hasAlpha === null || typeof sniffed.hasAlpha === 'boolean', `${label} hasAlpha`);
  assert.ok(sniffed.animated === null || typeof sniffed.animated === 'boolean', `${label} animated`);
  assert.ok(typeof sniffed.note === 'string' && sniffed.note.length > 0, `${label} said nothing`);
}

test('every fixture truncated to 4, 11 and 20 bytes comes back quietly', () => {
  for (const name of fixtureNames) {
    const bytes = bytesOf(name);
    for (const cut of [0, 1, 2, 3, 4, 11, 20]) {
      const label = `${name} cut to ${cut}`;
      const sniffed = sniffImage(bytes.subarray(0, cut));
      assertShape(sniffed, label);
      if (cut === 0) assert.equal(sniffed.format, 'unknown', label);
    }
  }
  assert.ok(fixtureNames.length >= 25, `only ${fixtureNames.length} fixtures were truncated`);
});

test('no prefix of any fixture, of any length, can make it throw', () => {
  let calls = 0;
  for (const name of fixtureNames) {
    const bytes = bytesOf(name);
    // Every length up to 2 kB, then in steps: a header parser that walks off the
    // end does it near the start, and the tail of a 10 kB BMP is only pixels.
    for (let cut = 0; cut <= bytes.length; cut += cut < 2048 ? 1 : 97) {
      assertShape(sniffImage(bytes.subarray(0, cut)), `${name} cut to ${cut}`);
      calls += 1;
    }
  }
  assert.ok(calls > 20000, `only ${calls} prefixes were tried`);
});

/** A tiny deterministic PRNG, so a failure can be reproduced from the seed alone. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('a header with bytes flipped in it still cannot make the reader throw', () => {
  const next = random(20260903);
  for (const name of fixtureNames) {
    const original = bytesOf(name);
    for (let round = 0; round < 40; round += 1) {
      const bytes = original.slice(0, Math.min(original.length, 512));
      // Corruption is concentrated in the header, where every length, offset and
      // count this file trusts is read from.
      for (let hit = 0; hit < 6; hit += 1) {
        bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256);
      }
      assertShape(sniffImage(bytes), `${name} round ${round}`);
    }
  }
});

test('bytes that are not an image say so, and say something useful', () => {
  const next = random(7);
  for (let round = 0; round < 200; round += 1) {
    const bytes = new Uint8Array(1 + Math.floor(next() * 400));
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(next() * 256);
    const sniffed = sniffImage(bytes);
    assertShape(sniffed, `garbage round ${round}`);
    // A random buffer can start '<svg' or 'BM' by chance; nothing else here can be
    // hit by accident, and those two are the only formats without a real signature.
    assert.ok(['unknown', 'bmp', 'svg'].includes(sniffed.format), `random bytes read as ${sniffed.format}`);
  }
  assert.equal(sniffImage(new Uint8Array(0)).format, 'unknown');
  assert.match(sniffImage(new Uint8Array(0)).note, /empty/i);
  assert.match(sniffImage(new Uint8Array([1, 2, 3])).note, /3 bytes/);
  assert.match(sniffImage(new TextEncoder().encode('%PDF-1.7 and so on, at length')).note, /PDF/);
  assert.match(sniffImage(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).note, /zip/i);
  assert.match(sniffImage(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).note, /svgz|gzip/i);
});

test('transparency is read from the header, not guessed from the format', () => {
  // PNG says it three different ways, and all three have to be understood.
  assert.equal(sniffImage(bytesOf('png-rgb.png')).hasAlpha, false, 'colour type 2 has no alpha channel');
  assert.equal(sniffImage(bytesOf('png-rgba.png')).hasAlpha, true, 'colour type 6 does');
  assert.equal(sniffImage(bytesOf('png-palette-trns.png')).hasAlpha, true, 'a palette with tRNS does too');
  assert.equal(sniffImage(bytesOf('png-palette-trns.png')).format, 'png');

  assert.equal(sniffImage(bytesOf('jpeg-baseline.jpg')).hasAlpha, false, 'JPEG cannot store transparency at all');
  assert.equal(sniffImage(bytesOf('gif-transparent.gif')).hasAlpha, true);
  assert.equal(sniffImage(bytesOf('gif-static.gif')).hasAlpha, false);
  assert.equal(sniffImage(bytesOf('webp-lossless-alpha.webp')).hasAlpha, true, 'the VP8L alpha bit');
  assert.equal(sniffImage(bytesOf('webp-lossy-alpha.webp')).hasAlpha, true, 'an ALPH chunk beside VP8');
  assert.equal(sniffImage(bytesOf('webp-lossless.webp')).hasAlpha, false);
  assert.equal(sniffImage(bytesOf('tiff-rgba.tif')).hasAlpha, true, 'ExtraSamples');
  assert.equal(sniffImage(bytesOf('tiff-le.tif')).hasAlpha, false);
  assert.equal(sniffImage(bytesOf('avif-alpha.avif')).hasAlpha, true, 'an auxiliary alpha item');
  assert.equal(sniffImage(bytesOf('avif.avif')).hasAlpha, false, 'three channels in pixi');
  // An SVG paints onto nothing, so whatever it does not cover is transparent.
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="x"></svg>')).hasAlpha, true);
});

test('animation is only claimed when the structure proves it', () => {
  for (const name of ['apng.png', 'gif-animated.gif', 'webp-animated.webp']) {
    const sniffed = sniffImage(bytesOf(name));
    assert.equal(sniffed.animated, true, `${name} is animated`);
  }
  for (const name of ['png-rgb.png', 'png-rgba.png', 'gif-static.gif', 'gif-transparent.gif',
    'webp-lossy.webp', 'webp-lossless.webp', 'jpeg-baseline.jpg', 'bmp.bmp', 'tiff-le.tif', 'ico.ico']) {
    assert.equal(sniffImage(bytesOf(name)).animated, false, `${name} is a still image`);
  }
  // A multi-page TIFF is several pictures, not a moving one, and nothing plays it.
  assert.equal(sniffImage(bytesOf('tiff-rgba.tif')).animated, false);
  assert.match(sniffImage(bytesOf('gif-animated.gif')).note, /animated GIF with 4 frames/);
  assert.match(sniffImage(bytesOf('apng.png')).note, /4 frames/);
});

test('a progressive JPEG is called one, and a baseline one is not', () => {
  const progressive = sniffImage(bytesOf('jpeg-progressive.jpg'));
  assert.match(progressive.note, /progressive/i);
  assert.match(progressive.note, /sharpens/, 'the note has to say what that means for the person waiting');
  assert.equal(progressive.width, W);
  assert.equal(progressive.height, H);
  const baseline = sniffImage(bytesOf('jpeg-baseline.jpg'));
  assert.doesNotMatch(baseline.note, /progressive/i);
  assert.match(baseline.note, /baseline/i);
});

test('an MP4 in an image tool is refused, gently and by name', () => {
  // ftyp/isom: the same container family as AVIF and HEIC, holding video.
  const bytes = new Uint8Array([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
  ]);
  const sniffed = sniffImage(bytes);
  assert.equal(sniffed.format, 'unknown');
  assert.match(sniffed.note, /MP4/);
  assert.match(sniffed.note, /not a still image/);
});

test('a renamed file is explained, not scolded', () => {
  const png = sniffImage(bytesOf('png-rgb.png'));
  const renamed = isFormatMismatch('photo.jpg', 'image/jpeg', png);
  assert.equal(renamed.mismatch, true);
  assert.ok(renamed.message);
  assert.match(renamed.message, /"photo\.jpg"/, 'the name is quoted back');
  assert.match(renamed.message, /PNG/);
  assert.match(renamed.message, /work normally/, 'it has to say the file is fine');
  for (const word of ['wrong file', 'invalid', 'error', 'corrupt', 'failed', 'must']) {
    assert.ok(!renamed.message.toLowerCase().includes(word), `the message should not say "${word}"`);
  }

  // .jpg and .jpeg are one format spelled two ways. Flagging that would be noise.
  const jpeg = sniffImage(bytesOf('jpeg-baseline.jpg'));
  assert.equal(isFormatMismatch('photo.jpg', 'image/jpeg', jpeg).mismatch, false);
  assert.equal(isFormatMismatch('photo.jpeg', 'image/jpeg', jpeg).mismatch, false);
  assert.equal(isFormatMismatch('photo.JPG', 'image/jpg', jpeg).mismatch, false, 'case is not a mismatch');
  assert.equal(isFormatMismatch('photo.jfif', '', jpeg).mismatch, false);
  assert.equal(isFormatMismatch('scan.tif', 'image/tiff', sniffImage(bytesOf('tiff-le.tif'))).mismatch, false);
  assert.equal(isFormatMismatch('scan.tiff', '', sniffImage(bytesOf('tiff-le.tif'))).mismatch, false);
  const svg = sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  assert.equal(isFormatMismatch('logo.svg', 'image/svg+xml', svg).mismatch, false);
  assert.equal(isFormatMismatch('logo.svg', 'image/svg+xml; charset=utf-8', svg).mismatch, false);
  assert.equal(isFormatMismatch('icon.png', 'image/png', sniffImage(bytesOf('png-rgba.png'))).mismatch, false);
  assert.equal(isFormatMismatch('', '', png).mismatch, false, 'no name, nothing to disagree with');
  assert.equal(isFormatMismatch('photo', '', png).mismatch, false, 'no extension either');

  // Bytes we could not identify put us in no position to accuse anyone.
  const unknown = sniffImage(new Uint8Array(64));
  assert.equal(isFormatMismatch('photo.jpg', 'image/jpeg', unknown).mismatch, false);
  assert.equal(isFormatMismatch('photo.jpg', 'image/jpeg', unknown).message, null);
});

test('a wrong browser label is mentioned only when the name cannot speak for itself', () => {
  const png = sniffImage(bytesOf('png-rgb.png'));
  // No extension, and a claimed type that disagrees: the label is all there is.
  const labelled = isFormatMismatch('screenshot', 'image/webp', png);
  assert.equal(labelled.mismatch, true);
  assert.ok(labelled.message);
  assert.match(labelled.message, /labelled as a WebP/);
  assert.match(labelled.message, /work normally/);

  // The name is right and the operating system's type is wrong. Nothing the person
  // can act on, so nothing is said.
  assert.equal(isFormatMismatch('shot.png', 'application/octet-stream', png).mismatch, false);
  assert.equal(isFormatMismatch('shot.png', 'image/webp', png).mismatch, false);
  assert.equal(isFormatMismatch('shot.png', '', png).mismatch, false);
});

test('mime types and extensions map both ways, including the wrong ones people send', () => {
  const formats: ImageFormat[] = ['jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'tiff', 'ico', 'svg'];
  for (const format of formats) {
    assert.equal(formatFromMime(mimeForFormat(format)), format, `${format} survives a round trip`);
    assert.ok(/^[a-z]{3,4}$/.test(extensionForFormat(format)), `${format} extension`);
  }
  assert.equal(extensionForFormat('jpeg'), 'jpg', 'people write jpg');
  assert.equal(mimeForFormat('ico'), 'image/x-icon', 'the type browsers actually use');
  assert.equal(mimeForFormat('unknown'), 'application/octet-stream');
  assert.equal(extensionForFormat('unknown'), 'bin');

  // Types that are not real, but arrive anyway.
  assert.equal(formatFromMime('image/jpg'), 'jpeg', 'never a registered type, sent constantly');
  assert.equal(formatFromMime('image/pjpeg'), 'jpeg', 'old Internet Explorer');
  assert.equal(formatFromMime('IMAGE/PNG'), 'png');
  assert.equal(formatFromMime('image/x-ms-bmp'), 'bmp', 'what Windows sends');
  assert.equal(formatFromMime('image/heif'), 'heic');
  assert.equal(formatFromMime('image/svg+xml; charset=utf-8'), 'svg');
  assert.equal(formatFromMime('image/vnd.microsoft.icon'), 'ico');
  assert.equal(formatFromMime('image/apng'), 'png');
  assert.equal(formatFromMime('video/mp4'), 'unknown');
  assert.equal(formatFromMime(''), 'unknown');
  assert.equal(formatFromMime('nonsense'), 'unknown');
});

test('only the three formats a browser can write are offered as outputs', () => {
  assert.deepEqual([...BROWSER_ENCODABLE], ['jpeg', 'png', 'webp']);
  for (const format of BROWSER_ENCODABLE) assert.equal(canEncodeTo(format), true);
  // Readable, but nothing in a browser will encode them, so no tool may promise to.
  for (const format of ['avif', 'heic', 'tiff', 'ico', 'gif', 'bmp', 'svg', 'unknown'] as ImageFormat[]) {
    assert.equal(canEncodeTo(format), false, `${format} cannot be written by canvas.toBlob`);
  }
});

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

test('an SVG is recognised by structure, since it has no magic number', () => {
  const plain = sniffImage(utf8('<svg xmlns="http://www.w3.org/2000/svg" width="37" height="91"><rect/></svg>'));
  assert.equal(plain.format, 'svg');
  assert.equal(plain.mime, 'image/svg+xml');
  assert.equal(plain.extension, 'svg');
  assert.equal(plain.width, W);
  assert.equal(plain.height, H);
  assert.equal(plain.hasAlpha, true);
  assert.equal(plain.animated, null, 'SMIL or CSS anywhere in the document could animate it');
  assert.match(plain.note, /vector/i);

  assert.equal(sniffImage(utf8('<svg width="37px" height="91px"/>')).width, W, 'px is still pixels');
  assert.equal(sniffImage(utf8('<svg width="37.4" height="91.2"/>')).width, W, 'a decimal rounds');
  assert.equal(sniffImage(utf8("<svg width='37' height='91'/>")).height, H, 'single quotes');
  assert.equal(sniffImage(utf8('<svg width=37 height=91/>')).height, H, 'unquoted, as HTML allows');
  assert.equal(sniffImage(utf8('<svg:svg width="37" height="91"/>')).format, 'svg', 'a namespaced root');

  // A stroke width is not a width. The attribute reader requires the boundary.
  const stroke = sniffImage(utf8('<svg stroke-width="4" viewBox="0 0 10 20"><path/></svg>'));
  assert.equal(stroke.width, null);
  assert.match(stroke.note, /viewBox/);
});

test('an SVG that gives no pixel size says so instead of inventing one', () => {
  const viewBox = sniffImage(utf8('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 91"><rect/></svg>'));
  assert.equal(viewBox.format, 'svg');
  assert.equal(viewBox.width, null, 'a viewBox is a coordinate system, not a size');
  assert.equal(viewBox.height, null);
  assert.match(viewBox.note, /viewBox/);
  assert.match(viewBox.note, /scales/);

  // Relative units depend on a container this reader cannot see.
  for (const units of ['100%', '50%', '10em', '12pt', '3cm']) {
    const relative = sniffImage(utf8(`<svg width="${units}" height="${units}"/>`));
    assert.equal(relative.width, null, `${units} is not a pixel count`);
    assert.match(relative.note, /proportion|no fixed pixel size/);
  }
  assert.match(sniffImage(utf8('<svg xmlns="x"><g/></svg>')).note, /no size at all/);
  assert.equal(sniffImage(utf8('<svg width="0" height="0"/>')).width, null, 'zero is not a size');
});

test('an SVG is still an SVG behind a byte-order mark, a comment and a doctype', () => {
  const prologue =
    '\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    '<!-- Generated by a drawing program.\n     Two lines of it. -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="37" height="91"><rect/></svg>\n';
  const sniffed = sniffImage(utf8(prologue));
  assert.equal(sniffed.format, 'svg');
  assert.equal(sniffed.width, W);
  assert.equal(sniffed.height, H);

  // An internal subset is allowed to contain '>' characters, so the first one is
  // not necessarily the end of the doctype.
  const subset = '<!DOCTYPE svg [<!ENTITY gt "a>b">]>\n<svg width="37" height="91"/>';
  assert.equal(sniffImage(utf8(subset)).format, 'svg');
  assert.equal(sniffImage(utf8(subset)).width, W);

  // UTF-16 with a byte-order mark: TextDecoder strips the mark for us.
  const utf16 = new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('<svg xmlns="x" width="37" height="91"/>', 'utf16le'),
  ]));
  assert.equal(sniffImage(utf16).format, 'svg', 'UTF-16LE');
  assert.equal(sniffImage(utf16).width, W);
});

test('things that merely contain an svg tag are not images', () => {
  const cases = [
    '<!DOCTYPE html><html><body><p>Hi</p><svg width="10" height="10"/></body></html>',
    '<html><svg/></html>',
    '<svgfoo width="10" height="10"/>',
    '<?xml version="1.0"?><rss><channel><title>svg</title></channel></rss>',
    'This document mentions <svg> in passing but is plain text.',
    '<?xml version="1.0"?>',
    '<!-- an unclosed comment <svg/>',
  ];
  for (const text of cases) {
    const sniffed = sniffImage(utf8(text));
    assert.equal(sniffed.format, 'unknown', `should not be an SVG: ${text.slice(0, 40)}`);
    assert.ok(sniffed.note.length > 0);
  }
  // A binary file cannot become an SVG by accident either: the decoder produces
  // replacement characters rather than throwing, and the root test then fails.
  assert.equal(sniffImage(new Uint8Array([0xc3, 0x28, 0xa0, 0xa1, 0xf8, 0x88, 0x80, 0x80, 0x80, 0, 1, 2, 3, 4, 5, 6])).format, 'unknown');
});

test('the download name is safe, and still the name the person chose', () => {
  assert.equal(outputFileName('photo.png', 'webp'), 'photo.webp');
  assert.equal(outputFileName('photo.png', 'webp', { suffix: '-compressed' }), 'photo-compressed.webp');
  assert.equal(outputFileName('photo.JPEG', 'png'), 'photo.png', 'a shouted extension still goes');

  // A name is never a path. Only the last segment survives, so nothing can be
  // aimed anywhere by naming a file.
  assert.equal(outputFileName('../../etc/passwd.png', 'jpeg'), 'passwd.jpg');
  assert.equal(outputFileName('/etc/shadow.png', 'png'), 'shadow.png');
  assert.equal(outputFileName('C:\\Windows\\System32\\evil.png', 'webp'), 'evil.webp');
  assert.equal(outputFileName('....//....//x.png', 'png'), 'x.png');
  for (const name of ['../../etc/passwd.png', 'a/b/c.png', 'a\\b\\c.png']) {
    const out = outputFileName(name, 'png');
    assert.ok(!out.includes('/') && !out.includes('\\'), `${out} must not be a path`);
    assert.ok(!out.startsWith('.'), `${out} must not be hidden`);
  }

  // Only one extension goes, and only if it looks like one.
  assert.equal(outputFileName('photo.tar.png', 'webp'), 'photo.tar.webp');
  assert.equal(outputFileName('my.holiday.2024.jpg', 'png'), 'my.holiday.2024.png');
  assert.equal(outputFileName('version.1.2.3', 'png'), 'version.1.2.3.png', 'a version is not an extension');
  assert.equal(outputFileName('archive.tar.gz', 'png'), 'archive.tar.png');
  assert.equal(outputFileName('.hidden.png', 'jpeg'), 'hidden.jpg', 'a leading dot goes');
  assert.equal(outputFileName('', 'png'), 'image.png');
  assert.equal(outputFileName('   ', 'png'), 'image.png');
  assert.equal(outputFileName('.png', 'webp'), 'png.webp', 'a dotfile is a name, not an extension');

  // Windows still refuses these, extension or not.
  for (const reserved of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    const out = outputFileName(`${reserved}.png`, 'jpeg');
    assert.equal(out, `${reserved}-image.jpg`, `${reserved} has to be altered`);
  }
  assert.equal(outputFileName('console.png', 'jpeg'), 'console.jpg', 'only the exact names');

  // Characters no filesystem will take, and characters that would hide a name.
  assert.equal(outputFileName('a<b>c:d"e|f?g*h.png', 'png'), 'abcdefgh.png');
  assert.equal(outputFileName('two   spaces\tand\na newline.png', 'png'), 'two spaces and a newline.png');
  assert.equal(outputFileName('trailing dots... .png', 'png'), 'trailing dots.png');
  assert.equal(outputFileName('photo.png', 'png', { suffix: '/../x' }), 'photox.png');
});

test('a long name is capped, and a name in another script is left alone', () => {
  const long = `${'a'.repeat(300)}.png`;
  const capped = outputFileName(long, 'webp');
  assert.equal(capped, `${'a'.repeat(200)}.webp`);
  assert.equal(capped.length, 205);
  // The cap counts code points, so it can never slice a character in half.
  const emoji = outputFileName(`${'🏖'.repeat(300)}.png`, 'jpeg');
  assert.equal(Array.from(emoji).length, 204, '200 code points plus ".jpg"');
  assert.ok(!emoji.includes('�'), 'no half-eaten character');

  assert.equal(outputFileName('vacaciones 🏖.png', 'webp'), 'vacaciones 🏖.webp');
  assert.equal(outputFileName('写真.png', 'jpeg'), '写真.jpg', 'nobody wants their name transliterated');
  assert.equal(outputFileName('Grüße aus Köln.png', 'webp'), 'Grüße aus Köln.webp');
  assert.equal(outputFileName('файл.png', 'png'), 'файл.png');
  assert.equal(outputFileName('عکس.png', 'webp'), 'عکس.webp');

  // Bytes we could not identify keep the extension they arrived with: renaming a
  // perfectly good file to .bin helps nobody.
  assert.equal(outputFileName('mystery.dat', 'unknown'), 'mystery.dat');
  assert.equal(outputFileName('mystery', 'unknown'), 'mystery.bin');
  // Nothing that comes out of here is a path, whatever went in.
  const next = random(11);
  for (let round = 0; round < 300; round += 1) {
    const length = 1 + Math.floor(next() * 20);
    let name = '';
    for (let i = 0; i < length; i += 1) name += String.fromCharCode(Math.floor(next() * 0x2f00));
    const out = outputFileName(name, 'png', { suffix: '-x' });
    assert.ok(!/[/\\]/.test(out), `${JSON.stringify(out)} contains a separator`);
    assert.ok(!out.startsWith('.'), `${JSON.stringify(out)} is hidden`);
    assert.ok(out.endsWith('.png'), `${JSON.stringify(out)} lost its extension`);
    assert.ok(!/[\u0000-\u001f\u007f]/.test(out), `${JSON.stringify(out)} has a control character`);
    assert.ok(Array.from(out).length <= 204, `${JSON.stringify(out)} is too long`);
  }
});

test('a byte count reads the way an operating system writes it', () => {
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(1), '1 B');
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(1023), '1023 B');
  assert.equal(humanBytes(1024), '1.0 KB', '1024-based, like every file properties dialogue');
  assert.equal(humanBytes(1536), '1.5 KB');
  assert.equal(humanBytes(1048576), '1.0 MB');
  assert.equal(humanBytes(2516582), '2.4 MB');
  assert.equal(humanBytes(1073741824), '1.0 GB');
  assert.equal(humanBytes(1099511627776), '1.0 TB');

  // Rounding must not print a value that has outgrown its unit.
  assert.equal(humanBytes(1048575), '1.0 MB', 'not 1024.0 KB');
  assert.equal(humanBytes(1023.6), '1.0 KB', 'not 1024 B');
  assert.equal(humanBytes(1073741823), '1.0 GB');

  assert.equal(humanBytes(-2048), '-2.0 KB', 'a size that shrank');
  assert.equal(humanBytes(Number.NaN), '0 B', 'never the word NaN in front of a person');
  assert.equal(humanBytes(Number.POSITIVE_INFINITY), '0 B');
  // Whatever the number, the shape is a figure, a space and a known unit.
  const next = random(3);
  for (let round = 0; round < 500; round += 1) {
    const value = Math.floor(next() * 4e12);
    assert.match(humanBytes(value), /^\d+(\.\d)? (B|KB|MB|GB|TB|PB)$/, `humanBytes(${value})`);
  }
});

test('the savings line says something true, and something kind when it grew', () => {
  const saved = savingsSummary(2_000_000, 1_140_000);
  assert.equal(saved.direction, 'smaller');
  assert.equal(saved.percent, 43);
  assert.equal(saved.deltaBytes, 860_000);
  assert.equal(saved.sentence, '43% smaller — saved 839.8 KB');

  const grew = savingsSummary(1_000_000, 1_020_000);
  assert.equal(grew.direction, 'larger');
  assert.equal(grew.percent, 2);
  assert.equal(grew.deltaBytes, -20_000);
  assert.equal(grew.sentence, '2% larger — this image was already well compressed');
  assert.doesNotMatch(grew.sentence, /sorry|failed|error/i, 'growing is usually the correct answer');

  const same = savingsSummary(4096, 4096);
  assert.equal(same.direction, 'same');
  assert.equal(same.percent, 0);
  assert.equal(same.deltaBytes, 0);
  assert.match(same.sentence, /Same size/);
});

test('the module under test stays pure, isomorphic and erasable', () => {
  const source = readFileSync(new URL('./format.ts', import.meta.url), 'utf8');
  // Not style policing: this file is imported by server rendering, by a web worker
  // and by Node tests, and one `document.createElement` would break two of the
  // three. Canvas work belongs in a browser-only module.
  // The property access is part of each pattern: this file's prose talks about a
  // scanned document and about the whole document, and neither is a DOM call.
  const banned: [RegExp, string][] = [
    [/\bdocument\.[A-Za-z_$]/, 'document'],
    [/\bwindow\.[A-Za-z_$]/, 'window'],
    [/\bnavigator\.[A-Za-z_$]/, 'navigator'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bnew\s+Image\s*\(/, 'new Image'],
    [/\bgetContext\s*\(/, 'getContext'],
    [/\bBuffer\s*\.\s*(from|alloc|concat)/, 'Buffer'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\brequire\s*\(/, 'require'],
    [/from\s+['"]node:/, 'a Node builtin'],
  ];
  for (const [pattern, name] of banned) {
    assert.doesNotMatch(source, pattern, `format.ts must not use ${name}`);
  }
  // Erasable syntax only: this file is run through node --experimental-strip-types,
  // which deletes types without evaluating them and cannot compile an enum.
  assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s/m, 'no enum');
  assert.doesNotMatch(source, /^\s*(?:export\s+)?namespace\s/m, 'no namespace');
  assert.doesNotMatch(source, /^\s*@[A-Za-z]/m, 'no decorators');
  // Every import has to be relative, carry the .ts extension the repository's
  // TypeScript configuration requires, and stay inside src/lib.
  //
  // This used to insist that every import be type-only, which was a proxy for
  // "this module has no runtime dependencies". The proxy became wrong when
  // `humanBytes` and the filename sanitiser moved to `src/lib/files/` so the PDF
  // and text tools could use them without dragging every signature table below
  // into their bundles. What actually matters is asserted directly instead: no
  // bare specifier, so no third-party package and no Node builtin can appear
  // here, and the module stays runnable under `node --experimental-strip-types`.
  for (const line of source.match(/^import .*$/gm) ?? []) {
    assert.match(line, /from '\.{1,2}\//, `${line} has to be a relative import`);
    assert.match(line, /\.ts'/, `${line} needs its .ts extension`);
  }
});

test('reading the same file twice gives the same answer', () => {
  // No caching, no shared mutable state, no dependence on call order: two reads of
  // the same bytes have to agree, or a result shown on a page could drift.
  for (const name of fixtureNames) {
    const bytes = bytesOf(name);
    const first = sniffImage(bytes);
    assert.deepEqual(sniffImage(bytesOf(name)), first, name);
    // A view into a larger buffer is the shape a file reader hands over, and must
    // not be read outside its own window.
    const padded = new Uint8Array(bytes.length + 16).fill(0x5a);
    padded.set(bytes, 8);
    assert.deepEqual(sniffImage(padded.subarray(8, padded.length - 8)), first, `${name} as a subarray`);
  }
});
