import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  EMU_PER_INCH,
  placeOnSlide,
  SLIDE_SIZES,
  slideSizeForImage,
  writePptx,
  type PptxImage,
} from './pptx.ts';

/**
 * The point of this file is that a .pptx is only correct if *other software*
 * will open it. Every structural assertion below is a proxy; the two tests at
 * the bottom are the real ones, and they hand the bytes to python-pptx and to
 * LibreOffice — two readers with nothing in common but the specification.
 *
 * Both are skipped rather than failed when absent, for the same reason as the
 * PDF suite: a missing developer tool is not a defect in the writer.
 */
const OUT = mkdtempSync(join(tmpdir(), 'pptx-'));

const commandCache = new Map<string, boolean>();
function hasCommand(command: string): boolean {
  const cached = commandCache.get(command);
  if (cached !== undefined) return cached;
  const found = spawnSync('which', [command], { encoding: 'utf8' }).status === 0;
  commandCache.set(command, found);
  return found;
}

function hasPythonPptx(): boolean {
  const cached = commandCache.get('python-pptx');
  if (cached !== undefined) return cached;
  const found =
    spawnSync('python3', ['-c', 'import pptx'], { encoding: 'utf8' }).status === 0;
  commandCache.set('python-pptx', found);
  return found;
}

function needs(check: () => boolean, what: string): { skip?: string } {
  return check() ? {} : { skip: `${what} is not installed on this machine` };
}

/** A real JPEG, so the readers below have something they can actually decode. */
function jpeg(width: number, height: number): PptxImage {
  const result = spawnSync(
    'python3',
    [
      '-c',
      'import sys;from PIL import Image;Image.new("RGB",(int(sys.argv[1]),int(sys.argv[2])),(15,118,110)).save(sys.stdout.buffer,"JPEG")',
      String(width),
      String(height),
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `could not build a fixture: ${result.stderr}`);
  return { kind: 'jpeg', bytes: new Uint8Array(result.stdout), width, height };
}

function build(images: PptxImage[], opts?: Parameters<typeof writePptx>[1]): Uint8Array {
  const result = writePptx(images, opts);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.bytes : new Uint8Array();
}

function save(name: string, bytes: Uint8Array): string {
  const path = join(OUT, name);
  writeFileSync(path, bytes);
  return path;
}

/** Every entry path in the archive, read back with `unzip -Z1`. */
function names(path: string): string[] {
  const result = spawnSync('unzip', ['-Z1', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, `unzip failed: ${result.stderr}`);
  return result.stdout.trim().split('\n');
}

/**
 * `unzip -p` treats its member argument as a glob, so `[Content_Types].xml` —
 * the one part whose name is fixed by the specification — reads as a character
 * class and matches nothing. Escaping the metacharacters is the fix.
 */
function unglob(member: string): string {
  return member.replace(/[[\]*?]/g, (c) => `\\${c}`);
}

function partText(path: string, part: string): string {
  const result = spawnSync('unzip', ['-p', path, unglob(part)], { encoding: 'utf8', maxBuffer: 32e6 });
  assert.equal(result.status, 0, `unzip -p ${part} failed: ${result.stderr}`);
  return result.stdout;
}

/* ───────────────────────────── geometry ─────────────────────────────────── */

test('EMU_PER_INCH is the value every Office measurement is built on', () => {
  assert.equal(EMU_PER_INCH, 914_400);
  // The reason for that number: it divides evenly by both points and mm.
  assert.equal(EMU_PER_INCH % 72, 0);
  assert.equal(EMU_PER_INCH % 254, 0);
});

test('the named slide sizes are the real PowerPoint defaults', () => {
  // 13.333 x 7.5 inches, and 10 x 7.5.
  assert.equal(SLIDE_SIZES['16:9'].height, 7.5 * EMU_PER_INCH);
  assert.equal(SLIDE_SIZES['4:3'].width, 10 * EMU_PER_INCH);
  assert.equal(SLIDE_SIZES['4:3'].height, 7.5 * EMU_PER_INCH);
});

test('contain fits the whole picture inside the slide and centres it', () => {
  const slide = { width: 12_192_000, height: 6_858_000 };
  const place = placeOnSlide({ width: 1000, height: 1000 }, slide, 'contain');
  assert.equal(place.cy, slide.height, 'the square is limited by the shorter axis');
  assert.equal(place.cx, slide.height, 'and stays square');
  assert.ok(place.x > 0 && place.y === 0, 'letterboxed left and right, flush top and bottom');
  assert.equal(place.x * 2 + place.cx, slide.width, 'the margins are equal');
});

test('cover fills the slide and lets the overflow run off it', () => {
  const slide = { width: 12_192_000, height: 6_858_000 };
  const place = placeOnSlide({ width: 1000, height: 1000 }, slide, 'cover');
  assert.equal(place.cx, slide.width, 'the square is driven by the longer axis');
  assert.ok(place.cy > slide.height, 'so it overflows vertically');
  assert.ok(place.y < 0, 'and the overflow is split evenly, above and below');
});

test('neither mode distorts the picture', () => {
  const slide = { width: 12_192_000, height: 6_858_000 };
  for (const fit of ['contain', 'cover'] as const) {
    for (const image of [
      { width: 4000, height: 3000 },
      { width: 1080, height: 1920 },
      { width: 800, height: 800 },
    ]) {
      const place = placeOnSlide(image, slide, fit);
      const wanted = image.width / image.height;
      const got = place.cx / place.cy;
      assert.ok(
        Math.abs(wanted - got) < 0.001,
        `${fit} ${image.width}x${image.height}: ratio ${got} should be ${wanted}`,
      );
    }
  }
});

test('an image with no size does not produce a zero-sized shape', () => {
  const place = placeOnSlide({ width: 0, height: 0 }, SLIDE_SIZES['16:9'], 'contain');
  assert.ok(place.cx > 0 && place.cy > 0);
});

test('a fitted slide keeps the image shape and stays within PowerPoint limits', () => {
  const size = slideSizeForImage({ width: 3000, height: 2000 });
  assert.ok(Math.abs(size.width / size.height - 1.5) < 0.001);
  assert.ok(Math.max(size.width, size.height) <= 56 * EMU_PER_INCH);
  assert.equal(Math.max(size.width, size.height), 10 * EMU_PER_INCH);
});

/* ───────────────────────────── the package ──────────────────────────────── */

test('every part a minimal package needs is present, at its real path', () => {
  const path = save('one.pptx', build([jpeg(1600, 900)]));
  const entries = names(path);
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/slideMaster1.xml',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/slideLayout1.xml',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    'ppt/theme/theme1.xml',
    'ppt/slides/slide1.xml',
    'ppt/slides/_rels/slide1.xml.rels',
    'ppt/media/image1.jpeg',
  ]) {
    assert.ok(entries.includes(required), `missing ${required}\ngot:\n${entries.join('\n')}`);
  }
});

test('the paths survive the ZIP writer instead of being flattened', () => {
  // The bug this catches: the default writer reduces every name to its last
  // segment, which turns ppt/slides/slide1.xml into slide1.xml and produces a
  // package PowerPoint offers to repair.
  const path = save('paths.pptx', build([jpeg(800, 600)]));
  assert.ok(names(path).some((name) => name.includes('/')), 'no folder paths survived');
});

test('the content types cover every part in the package', () => {
  const path = save('types.pptx', build([jpeg(800, 600), jpeg(600, 800)]));
  const types = partText(path, '[Content_Types].xml');
  assert.match(types, /Extension="jpeg"/);
  assert.match(types, /PartName="\/ppt\/slides\/slide1\.xml"/);
  assert.match(types, /PartName="\/ppt\/slides\/slide2\.xml"/);
  assert.match(types, /PartName="\/ppt\/theme\/theme1\.xml"/);
});

test('every relationship target exists in the package', () => {
  const path = save('rels.pptx', build([jpeg(800, 600), jpeg(640, 480)]));
  const entries = new Set(names(path));

  for (const part of [
    '_rels/.rels',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    'ppt/slides/_rels/slide1.xml.rels',
    'ppt/slides/_rels/slide2.xml.rels',
  ]) {
    const xml = partText(path, part);
    const base = part.replace(/_rels\/[^/]+$/, '');
    for (const match of xml.matchAll(/Target="([^"]+)"/g)) {
      // Resolve the target against the part's own folder, the way a reader does.
      const resolved = new URL(match[1] as string, `file:///${base}`).pathname.slice(1);
      assert.ok(entries.has(resolved), `${part} points at ${resolved}, which is not in the package`);
    }
  }
});

test('the slide list and the relationships agree about how many slides there are', () => {
  const path = save('five.pptx', build(Array.from({ length: 5 }, () => jpeg(1200, 800))));
  const presentation = partText(path, 'ppt/presentation.xml');
  const ids = [...presentation.matchAll(/<p:sldId /g)].length;
  assert.equal(ids, 5);
  const rels = partText(path, 'ppt/_rels/presentation.xml.rels');
  assert.equal([...rels.matchAll(/Type="[^"]+\/slide"/g)].length, 5);
});

test('slide ids start at 256, which is the lowest PowerPoint accepts', () => {
  const path = save('ids.pptx', build([jpeg(800, 600), jpeg(800, 600)]));
  const presentation = partText(path, 'ppt/presentation.xml');
  assert.match(presentation, /<p:sldId id="256"/);
  assert.match(presentation, /<p:sldId id="257"/);
});

test('the slide size written is the size asked for', () => {
  const wide = partText(save('wide.pptx', build([jpeg(800, 600)])), 'ppt/presentation.xml');
  assert.match(wide, /cx="12192000" cy="6858000"/);
  const classic = partText(
    save('classic.pptx', build([jpeg(800, 600)], { size: '4:3' })),
    'ppt/presentation.xml',
  );
  assert.match(classic, /cx="9144000" cy="6858000"/);
});

test('fit takes the slide shape from the first image', () => {
  const xml = partText(
    save('fit.pptx', build([jpeg(2000, 1000)], { fit: 'fit' })),
    'ppt/presentation.xml',
  );
  const match = xml.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  assert.ok(match);
  assert.ok(Math.abs(Number(match[1]) / Number(match[2]) - 2) < 0.001, 'a 2:1 image, a 2:1 slide');
});

test('the image bytes go in untouched', () => {
  const image = jpeg(1000, 750);
  const path = save('verbatim.pptx', build([image]));
  const result = spawnSync('unzip', ['-p', path, 'ppt/media/image1.jpeg'], {
    maxBuffer: 32e6,
  });
  assert.equal(result.status, 0);
  assert.deepEqual(new Uint8Array(result.stdout), image.bytes, 'the JPEG was re-encoded');
});

test('the background colour reaches the master, and junk falls back to white', () => {
  const tinted = partText(
    save('bg.pptx', build([jpeg(800, 600)], { background: '#0F766E' })),
    'ppt/slideMasters/slideMaster1.xml',
  );
  assert.match(tinted, /<a:srgbClr val="0F766E"\/>/);

  const fallback = partText(
    save('bg-bad.pptx', build([jpeg(800, 600)], { background: 'not a colour' })),
    'ppt/slideMasters/slideMaster1.xml',
  );
  assert.match(fallback, /<a:srgbClr val="FFFFFF"\/>/);
});

test('an impossible deck is refused with a sentence, not a broken file', () => {
  const empty = writePptx([]);
  assert.equal(empty.ok, false);
  assert.match(empty.ok ? '' : empty.error, /at least one image/);

  const tooMany = writePptx(
    Array.from({ length: 301 }, () => ({
      kind: 'jpeg' as const,
      bytes: new Uint8Array([1]),
      width: 10,
      height: 10,
    })),
  );
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.ok ? '' : tooMany.error, /up to 300 slides/);

  const empptyBytes = writePptx([
    { kind: 'jpeg', bytes: new Uint8Array(0), width: 10, height: 10 },
  ]);
  assert.equal(empptyBytes.ok, false);
  assert.match(empptyBytes.ok ? '' : empptyBytes.error, /no data/);
});

/* ──────────────────── does other software open it? ──────────────────────── */

test('python-pptx opens the deck and agrees about it', needs(hasPythonPptx, 'python-pptx'), () => {
  const path = save('reader.pptx', build([jpeg(1600, 900), jpeg(900, 1600), jpeg(800, 800)]));
  const script = `
import json, sys
from pptx import Presentation
from pptx.util import Emu
deck = Presentation(sys.argv[1])
out = {
  "slides": len(deck.slides),
  "width": deck.slide_width,
  "height": deck.slide_height,
  "pictures": [],
}
for slide in deck.slides:
    shapes = [s for s in slide.shapes if s.shape_type == 13]
    out["pictures"].append([[s.left, s.top, s.width, s.height] for s in shapes])
print(json.dumps(out))
`;
  const result = spawnSync('python3', ['-c', script, path], { encoding: 'utf8' });
  assert.equal(result.status, 0, `python-pptx could not read it:\n${result.stderr}`);
  const read = JSON.parse(result.stdout) as {
    slides: number;
    width: number;
    height: number;
    pictures: number[][][];
  };

  assert.equal(read.slides, 3, 'three slides');
  assert.equal(read.width, 12_192_000);
  assert.equal(read.height, 6_858_000);
  for (const [index, pictures] of read.pictures.entries()) {
    assert.equal(pictures.length, 1, `slide ${index + 1} holds exactly one picture`);
    const [left, top, width, height] = pictures[0] as number[];
    assert.ok(width > 0 && height > 0, 'the picture has a size');
    // Contained: inside the slide on both axes.
    assert.ok(left >= 0 && top >= 0, 'contained pictures start inside the slide');
    assert.ok(left + width <= read.width + 1, 'and end inside it');
    assert.ok(top + height <= read.height + 1);
  }
});

test(
  'LibreOffice opens the deck and renders it to a PDF',
  needs(() => hasCommand('soffice'), 'LibreOffice'),
  () => {
    // The strongest check available: a second, unrelated implementation not
    // merely parsing the package but laying it out and printing it. A package
    // that fails structurally produces no output at all here.
    const path = save('render.pptx', build([jpeg(1600, 900), jpeg(1200, 1600)]));
    const result = spawnSync(
      'soffice',
      [
        '--headless',
        '--norestore',
        `-env:UserInstallation=file://${join(OUT, 'lo-profile')}`,
        '--convert-to',
        'pdf',
        '--outdir',
        OUT,
        path,
      ],
      { encoding: 'utf8', timeout: 180_000 },
    );
    assert.equal(result.status, 0, `soffice failed:\n${result.stdout}\n${result.stderr}`);

    const pdf = join(OUT, 'render.pdf');
    const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' });
    if (info.status !== 0) {
      // No poppler: the conversion succeeding is already the assertion.
      assert.ok(result.stdout.includes('render.pdf'), 'no PDF was produced');
      return;
    }
    assert.match(info.stdout, /Pages:\s+2/, 'two slides should be two pages');
  },
);
