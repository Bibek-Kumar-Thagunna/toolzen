import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';

import { browserDeflate, estimatePdfBytes, writePdf } from './writer.ts';
import type { Deflate, PdfMeta, PdfPageSpec } from './writer.ts';
import { PAGE_SIZES, placeImage, resolvePageSize } from './pages.ts';

const FIXTURES = '/tmp/pdf-fixtures';
const OUT = '/tmp/pdf-out';

/**
 * The same fixture script as `jpeg.test.ts`, repeated so either file runs alone.
 * Whichever process gets there first wins the rename; the other reuses the result.
 */
const FIXTURE_SCRIPT = `
import sys, os
from PIL import Image, ImageDraw
D = sys.argv[1]
os.makedirs(D, exist_ok=True)

def photo(w, h):
    g = Image.linear_gradient('L').resize((w, h))
    r = g.transpose(Image.Transpose.ROTATE_90).resize((w, h))
    b = Image.new('L', (w, h), 128)
    im = Image.merge('RGB', (r, g, b))
    ImageDraw.Draw(im).ellipse([w // 6, h // 6, w * 5 // 6, h * 5 // 6], outline=(255, 0, 0), width=6)
    return im

photo(640, 480).save(D + '/baseline-rgb.jpg', quality=90)
photo(320, 200).convert('L').save(D + '/gray.jpg', quality=90)
photo(640, 480).save(D + '/progressive.jpg', quality=85, progressive=True)
photo(200, 150).convert('CMYK').save(D + '/cmyk.jpg', quality=90)
Image.new('RGB', (200, 200), (220, 20, 30)).save(D + '/red.jpg', quality=95)
im = Image.new('RGB', (300, 200), (10, 120, 200))
ex = im.getexif(); ex[0x0112] = 6
im.save(D + '/exif-orient6.jpg', quality=88, exif=ex)
Image.new('RGB', (8, 8), (1, 2, 3)).save(D + '/tiny.png')
open(D + '/rgb-raw.bin', 'wb').write(bytes(v for y in range(48) for x in range(64) for v in (x * 4, y * 5, 200)))
open(D + '/rgba-raw.bin', 'wb').write(bytes(v for y in range(48) for x in range(64) for v in (255, 40, 40, 0 if x < 32 else 255)))
open(D + '/gray-raw.bin', 'wb').write(bytes((x * 8) % 256 for x in range(1024)))
`;

/** Mean and a few sampled pixels from a rendered page. */
const PIL_STATS = `
import sys, json
from PIL import Image, ImageStat
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
pts = []
for spec in sys.argv[2:]:
    fx, fy = [float(v) for v in spec.split(',')]
    x = min(w - 1, max(0, int(fx * w)))
    y = min(h - 1, max(0, int(fy * h)))
    pts.append(list(im.getpixel((x, y))))
print(json.dumps({'size': [w, h], 'mean': ImageStat.Stat(im).mean, 'points': pts}))
`;

/** What an independent PDF library makes of the file. */
const PYPDF_READ = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
m = r.metadata or {}
print(json.dumps({
    'pages': len(r.pages),
    'title': m.get('/Title'),
    'author': m.get('/Author'),
    'producer': m.get('/Producer'),
    'created': m.get('/CreationDate'),
    'mediabox': [float(v) for v in r.pages[0].mediabox],
}))
`;

/** How far two images are apart, averaged over every channel of a sampled grid. */
const IMAGE_DIFF = `
import sys, json
from PIL import Image
a = Image.open(sys.argv[1]).convert('RGB')
b = Image.open(sys.argv[2]).convert('RGB').resize(a.size)
pa, pb = a.load(), b.load()
total = 0
count = 0
for y in range(0, a.size[1], 3):
    for x in range(0, a.size[0], 3):
        for i in range(3):
            total += abs(pa[x, y][i] - pb[x, y][i])
            count += 1
print(json.dumps({'meanAbsDiff': total / count}))
`;

function ensureFixtures(): void {
  if (existsSync(`${FIXTURES}/baseline-rgb.jpg`)) return;
  const staging = `${FIXTURES}.${process.pid}`;
  mkdirSync(staging, { recursive: true });
  const built = spawnSync('python3', ['-c', FIXTURE_SCRIPT, staging], { encoding: 'utf8' });
  if (built.status !== 0) throw new Error(`could not build fixtures: ${built.stderr}`);
  try {
    renameSync(staging, FIXTURES);
  } catch {
    // Another test file built them first.
  }
  if (!existsSync(`${FIXTURES}/baseline-rgb.jpg`)) throw new Error('fixtures were not created');
}

ensureFixtures();
mkdirSync(OUT, { recursive: true });

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES}/${name}`));
}

/**
 * `node:zlib` stands in for the browser's `CompressionStream`. That the writer
 * accepts either is the whole point of injecting it.
 */
const deflate: Deflate = async (bytes) => new Uint8Array(deflateSync(bytes));

/** Is an external checker on this machine? Memoised — `which` is a process. */
const commandCache = new Map<string, boolean>();
function hasCommand(command: string): boolean {
  const cached = commandCache.get(command);
  if (cached !== undefined) return cached;
  const found = spawnSync('which', [command], { encoding: 'utf8' }).status === 0;
  commandCache.set(command, found);
  return found;
}

/**
 * The external PDF tooling this file validates against.
 *
 * qpdf reads every object and cross-reference offset; poppler's pdfinfo and
 * pdftoppm read the metadata and actually render the pages. Together they are
 * the second opinion that makes these integration tests worth having, and they
 * are not optional to the *assertions* — nothing here is relaxed to get past a
 * failure.
 *
 * They are optional to the *machine*, though. On a fresh clone, a CI image or a
 * laptop without poppler installed, a missing developer tool is not a defect in
 * the writer, and a suite that goes red for one teaches people to ignore red —
 * which is how a real failure gets waved through. So these tests skip, loudly
 * and by name, when the tools are absent.
 *
 * Install them with: apt install qpdf poppler-utils  (or: brew install qpdf poppler)
 */
const PDF_TOOLS = ['qpdf', 'pdfinfo', 'pdftoppm'] as const;

/** `{}` when every tool is present, a skip reason when any is missing. */
function needsPdfTools(): { skip?: string } {
  const missing = PDF_TOOLS.filter((command) => !hasCommand(command));
  return missing.length === 0
    ? {}
    : { skip: `not installed on this machine: ${missing.join(', ')} — install qpdf and poppler-utils to run this` };
}

function run(command: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) assert.fail(`${command} could not be run: ${result.error.message}`);
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function python(script: string, args: string[]): Record<string, unknown> {
  const result = run('python3', ['-c', script, ...args]);
  assert.equal(result.status, 0, `python failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

async function build(pages: PdfPageSpec[], meta?: PdfMeta): Promise<Uint8Array> {
  const result = await writePdf(pages, { deflate, meta });
  if (!result.ok) assert.fail(`writePdf should have succeeded: ${result.error}`);
  return result.bytes;
}

function save(name: string, bytes: Uint8Array): string {
  const path = `${OUT}/${name}`;
  writeFileSync(path, bytes);
  return path;
}

/**
 * `qpdf --check` reads the whole file the way a reader does: every object, every
 * stream, and above all the cross-reference offsets. A non-zero exit means the
 * writer is wrong, and no assertion in this file is ever relaxed to get past it.
 */
function qpdfCheck(path: string): string {
  const result = run('qpdf', ['--check', path]);
  assert.equal(result.status, 0, `qpdf --check failed for ${path}:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /No syntax or stream encoding errors found/);
  return result.stdout;
}

/**
 * Ghostscript is a second, unrelated implementation. qpdf validates the file's
 * structure; `gs` actually interprets every content stream, so a bad `cm` matrix
 * or an undefined resource name fails here even when the syntax is clean.
 *
 * It exits 0 on a damaged file because it repairs what it can, printing the
 * complaint to stdout instead — so the output is what has to be checked, and
 * `-q` means a healthy file prints nothing at all.
 */
function ghostscript(path: string): void {
  // Ghostscript is a second opinion, not the primary check: `qpdf --check` above
  // already reads every object and cross-reference offset, and it is not
  // optional. So on a machine without `gs` installed — most CI images, and a
  // fresh clone on a laptop — this step steps aside with a note rather than
  // failing the suite. A missing developer tool is not a defect in the writer,
  // and a test suite that goes red for one teaches people to ignore red.
  if (!hasCommand('gs')) {
    console.log(`  (ghostscript not installed — skipped the second-opinion render of ${path})`);
    return;
  }
  const result = run('gs', ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=nullpage', path]);
  assert.equal(result.status, 0, `ghostscript rejected ${path}:\n${result.stdout}\n${result.stderr}`);
  const said = `${result.stdout}${result.stderr}`.trim();
  assert.equal(said, '', `ghostscript had something to say about ${path}:\n${said}`);
}

/** `pdfinfo`'s `Key: value` output as a record. */
function pdfInfo(path: string): Record<string, string> {
  const result = run('pdfinfo', [path]);
  assert.equal(result.status, 0, `pdfinfo failed: ${result.stderr}`);
  const fields: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    const split = line.indexOf(':');
    if (split > 0) fields[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return fields;
}

/** Rasterise one page with poppler. `-singlefile` keeps the name predictable. */
function render(path: string, name: string, dpi: number, page = 1): string {
  const prefix = `${OUT}/${name}`;
  const result = run('pdftoppm', [
    '-r',
    String(dpi),
    '-png',
    '-singlefile',
    '-f',
    String(page),
    '-l',
    String(page),
    path,
    prefix,
  ]);
  assert.equal(result.status, 0, `pdftoppm failed: ${result.stderr}`);
  assert.ok(existsSync(`${prefix}.png`), 'pdftoppm produced no image');
  return `${prefix}.png`;
}

const A4 = PAGE_SIZES.a4;

/** One A4 page holding one image, laid out the way the tool would. */
function pageFor(image: PdfPageSpec['image'], size = A4): PdfPageSpec {
  return {
    size,
    image,
    placement: placeImage({ width: image.width, height: image.height }, size, {
      fit: 'contain',
      marginPt: 36,
    }),
  };
}

test('a one-page JPEG PDF passes qpdf --check and pdfinfo agrees about it', needsPdfTools(), async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const bytes = await build([pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })], {
    title: 'One page',
  });
  const path = save('one-jpeg.pdf', bytes);

  qpdfCheck(path);

  const info = pdfInfo(path);
  assert.equal(info.Pages, '1');
  assert.equal(info['PDF version'], '1.7');
  assert.match(info['Page size'], /^595\.276 x 841\.89 pts \(A4\)$/, 'A4 portrait, in points');
  assert.equal(info.Title, 'One page');

  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.7\n'), 'the header is the first thing in the file');
  assert.match(text, /%%EOF\n$/, 'and %%EOF is the last');
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Type \/Pages \/Count 1 \/Kids \[\d+ 0 R\]/);
  assert.match(text, /\/Type \/Page \/Parent/);
  assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/);
  assert.match(text, /\/Resources << \/XObject << \/Im0 \d+ 0 R >> >>/);
  assert.match(text, /\/Filter \/DCTDecode/);
  // The second line marks the file as binary so no tool rewrites the line endings.
  assert.equal(bytes[9], 0x25);
  assert.ok(bytes[10] > 0x7f && bytes[11] > 0x7f, 'high bytes in the binary comment');
});

test('the JPEG bitstream goes in untouched, which is what makes it lossless', async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const bytes = await build([pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })]);

  const found = Buffer.from(bytes).indexOf(Buffer.from(jpeg));
  assert.ok(found > 0, 'the entire original JPEG appears verbatim inside the PDF');
  assert.deepEqual(
    Array.from(bytes.subarray(found, found + jpeg.length)),
    Array.from(jpeg),
    'every byte of it, in order',
  );

  const overhead = bytes.length - jpeg.length;
  assert.ok(overhead > 0 && overhead < 2048, `the PDF wrapper should be small, was ${overhead} bytes`);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(!text.includes('/FlateDecode'), 'nothing was compressed on the JPEG route');
  assert.match(text, new RegExp(`/Length ${jpeg.length} >>\\nstream`), '/Length is the real stream length');
});

test('a three-page mixed JPEG and raw document checks out end to end', needsPdfTools(), async () => {
  const pages: PdfPageSpec[] = [
    pageFor({ kind: 'jpeg', bytes: fixture('baseline-rgb.jpg'), width: 640, height: 480 }),
    pageFor({ kind: 'jpeg', bytes: fixture('gray.jpg'), width: 320, height: 200 }),
    pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48, components: 3 }),
  ];
  const title = 'Three pages — café ☕';
  const bytes = await build(pages, { title, author: 'A. Tester', subject: 'Mixed sources' });
  const path = save('three-mixed.pdf', bytes);

  qpdfCheck(path);
  ghostscript(path);

  const info = pdfInfo(path);
  assert.equal(info.Pages, '3');
  assert.match(info['Page size'], /^595\.276 x 841\.89 pts \(A4\)$/);
  assert.equal(info.Title, title, 'pdfinfo decodes the UTF-16 title');

  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/Filter \/DCTDecode/, 'the JPEGs went in as-is');
  assert.match(text, /\/Filter \/FlateDecode/, 'the raw pixels were compressed');
  assert.match(text, /\/ColorSpace \/DeviceGray/, 'the grey JPEG is a grey image, not a colour one');
  assert.match(text, /\/Type \/Pages \/Count 3 \/Kids \[\d+ 0 R \d+ 0 R \d+ 0 R\]/);

  // An independent library, not our own parser, reading it back.
  const read = python(PYPDF_READ, [path]);
  assert.equal(read.pages, 3);
  assert.equal(read.title, title, 'pypdf reads the non-ASCII title back exactly');
  assert.equal(read.author, 'A. Tester');
  assert.deepEqual(read.mediabox, [0, 0, 595.276, 841.89]);

  // The raw RGB stream really is deflate: unpack it and check the first pixel.
  const flateAt = text.indexOf('/Filter /FlateDecode');
  const streamAt = text.indexOf('stream\n', flateAt) + 'stream\n'.length;
  const lengthMatch = /\/Length (\d+)/.exec(text.slice(flateAt, flateAt + 200));
  assert.ok(lengthMatch, 'the flate stream declares a length');
  const raw = inflateSync(bytes.subarray(streamAt, streamAt + Number(lengthMatch[1])));
  assert.equal(raw.length, 64 * 48 * 3, 'it unpacks to exactly the pixels handed in');
  assert.deepEqual(Array.from(raw.subarray(0, 3)), [0, 0, 200], 'first pixel survives the round trip');
});

test('RGBA becomes an image plus a soft mask, and the clear half shows the page', needsPdfTools(), async () => {
  // A "fit" page at 72 dpi maps one pixel to one point to one rendered pixel, so
  // the sampled coordinates below are the image's own pixels.
  const size = resolvePageSize('fit', 'auto', { width: 64, height: 48 });
  const image: PdfPageSpec['image'] = {
    kind: 'raw',
    bytes: fixture('rgba-raw.bin'),
    width: 64,
    height: 48,
    components: 4,
    hasAlpha: true,
  };
  const bytes = await build([
    { size, image, placement: placeImage({ width: 64, height: 48 }, size, { fit: 'contain', marginPt: 0 }) },
  ]);
  const path = save('alpha-smask.pdf', bytes);

  qpdfCheck(path);
  ghostscript(path);

  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/SMask \d+ 0 R/, 'the alpha channel became a soft mask');
  assert.match(text, /\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/FlateDecode/, 'a grey mask image');
  assert.equal(text.match(/\/Subtype \/Image/g)?.length, 2, 'two image objects: the colour and the mask');
  assert.ok(!/\/SMask \d+ 0 R[^>]*\/SMask/.test(text), 'the mask itself has no mask');

  // The left half of the source is fully transparent, the right half solid red.
  const png = render(path, 'alpha-smask', 72);
  const stats = python(PIL_STATS, [png, '0.25,0.5', '0.75,0.5']);
  const points = stats.points as number[][];
  assert.deepEqual(stats.size, [64, 48], 'one image pixel per rendered pixel');
  assert.deepEqual(points[0], [255, 255, 255], 'the transparent half lets the white page through');
  const [red, green, blue] = points[1];
  assert.ok(red > 240 && green < 70 && blue < 70, `the opaque half is red, got ${points[1].join(',')}`);
});

test('a 50-page document checks out, and the repeated image is stored once', needsPdfTools(), async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const page = pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 });
  const pages = Array.from({ length: 50 }, () => page);
  const bytes = await build(pages, { title: 'Fifty of the same' });
  const path = save('fifty.pdf', bytes);

  qpdfCheck(path);
  const info = pdfInfo(path);
  assert.equal(info.Pages, '50');
  assert.equal(python(PYPDF_READ, [path]).pages, 50);

  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(text.match(/\/DCTDecode/g)?.length, 1, 'one image object, shared by every page');
  assert.equal(text.match(/\/Type \/Page[^s]/g)?.length, 50);
  assert.ok(
    bytes.length < jpeg.length * 2,
    `50 pages of the same photo should not be 50 copies of it: ${bytes.length} bytes for a ${jpeg.length} byte JPEG`,
  );

  // A different image with the same bytes reused deliberately: two distinct
  // descriptions of one buffer must not be merged into one object.
  const asGrey: PdfPageSpec['image'] = { kind: 'jpeg', bytes: jpeg, width: 640, height: 480, components: 1 };
  const mixed = await build([page, pageFor(asGrey)]);
  const mixedText = Buffer.from(mixed).toString('latin1');
  assert.equal(mixedText.match(/\/DCTDecode/g)?.length, 2, 'described differently means stored separately');
});

test('the rendered page is not blank, and a solid colour comes out as that colour', needsPdfTools(), async () => {
  const red = fixture('red.jpg');
  const size = resolvePageSize('fit', 'auto', { width: 200, height: 200 });
  const redPath = save(
    'red-fit.pdf',
    await build([
      {
        size,
        image: { kind: 'jpeg', bytes: red, width: 200, height: 200 },
        placement: placeImage({ width: 200, height: 200 }, size, { fit: 'contain', marginPt: 0 }),
      },
    ]),
  );
  qpdfCheck(redPath);

  // The source is a flat (220, 20, 30). Anything close to that proves the page
  // holds a decoded image and not merely valid-but-empty structure.
  const redStats = python(PIL_STATS, [render(redPath, 'red-fit', 36), '0.5,0.5']);
  const mean = redStats.mean as number[];
  const centre = (redStats.points as number[][])[0];
  assert.ok(Math.abs(mean[0] - 220) < 6, `mean red should be about 220, was ${mean[0]}`);
  assert.ok(Math.abs(mean[1] - 20) < 6, `mean green should be about 20, was ${mean[1]}`);
  assert.ok(Math.abs(mean[2] - 30) < 6, `mean blue should be about 30, was ${mean[2]}`);
  assert.ok(Math.abs(centre[0] - 220) < 8 && Math.abs(centre[1] - 20) < 8 && Math.abs(centre[2] - 30) < 8,
    `the centre pixel should be red, was ${centre.join(',')}`);

  // And a photograph on a white A4 page: mostly paper, but definitely not blank.
  const photoPath = save(
    'photo-a4.pdf',
    await build([pageFor({ kind: 'jpeg', bytes: fixture('baseline-rgb.jpg'), width: 640, height: 480 })]),
  );
  const photoStats = python(PIL_STATS, [render(photoPath, 'photo-a4', 36), '0.5,0.5']);
  const photoMean = photoStats.mean as number[];
  assert.ok(
    photoMean.some((channel) => Math.abs(channel - 255) > 20),
    `the page should not be blank white, mean was ${photoMean.map((v) => Math.round(v)).join(',')}`,
  );
});

test('the y coordinate is measured from the bottom of the page, as poppler sees it', needsPdfTools(), async () => {
  // The end-to-end proof of the coordinate convention. A red square aligned to
  // the bottom of an A4 page must appear in the *lower* part of the raster — and
  // a raster's own row 0 is its top, so this fails loudly if y were treated as a
  // distance from the top.
  const red = fixture('red.jpg');
  const image: PdfPageSpec['image'] = { kind: 'jpeg', bytes: red, width: 200, height: 200 };
  const bottom = placeImage({ width: 200, height: 200 }, A4, { fit: 'contain', marginPt: 36, align: 'bottom' });
  const path = save('bottom-aligned.pdf', await build([{ size: A4, image, placement: bottom }]));
  qpdfCheck(path);

  const stats = python(PIL_STATS, [render(path, 'bottom-aligned', 36), '0.5,0.1', '0.5,0.9']);
  const [nearTop, nearBottom] = stats.points as number[][];
  assert.deepEqual(nearTop, [255, 255, 255], 'the top tenth of the page is bare paper');
  assert.ok(
    nearBottom[0] > 200 && nearBottom[1] < 60,
    `the bottom tenth holds the red image, got ${nearBottom.join(',')}`,
  );

  const top = placeImage({ width: 200, height: 200 }, A4, { fit: 'contain', marginPt: 36, align: 'top' });
  const flipped = save('top-aligned.pdf', await build([{ size: A4, image, placement: top }]));
  const flippedStats = python(PIL_STATS, [render(flipped, 'top-aligned', 36), '0.5,0.1', '0.5,0.9']);
  const [topInk, bottomPaper] = flippedStats.points as number[][];
  assert.ok(topInk[0] > 200 && topInk[1] < 60, `top-aligned puts ink at the top, got ${topInk.join(',')}`);
  assert.deepEqual(bottomPaper, [255, 255, 255], 'and paper at the bottom');
});

test('the cross-reference table points exactly at each object', async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const samples: [string, Uint8Array][] = [
    [
      'mixed',
      await build([
        pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 }),
        pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48, components: 3 }),
        pageFor({ kind: 'jpeg', bytes: fixture('gray.jpg'), width: 320, height: 200 }),
      ]),
    ],
    [
      'with a soft mask',
      await build([
        pageFor({
          kind: 'raw',
          bytes: fixture('rgba-raw.bin'),
          width: 64,
          height: 48,
          components: 4,
          hasAlpha: true,
        }),
      ]),
    ],
    ['fifty pages', await build(Array.from({ length: 50 }, () => pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })))],
  ];

  for (const [name, bytes] of samples) {
    const text = Buffer.from(bytes).toString('latin1');

    const startxrefMatch = /startxref\n(\d+)\n%%EOF/.exec(text);
    assert.ok(startxrefMatch, `${name}: no startxref`);
    const startxref = Number(startxrefMatch[1]);
    assert.equal(text.slice(startxref, startxref + 4), 'xref', `${name}: startxref must point at the table`);

    const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref, startxref + 40));
    assert.ok(header, `${name}: malformed xref header`);
    const count = Number(header[1]);
    const rowsAt = startxref + header[0].length;

    // Every row is exactly 20 bytes, which is what lets a reader seek to one.
    const free = text.slice(rowsAt, rowsAt + 20);
    assert.equal(free, '0000000000 65535 f\r\n', `${name}: object 0 must head the free list`);
    for (let object = 1; object < count; object += 1) {
      const row = text.slice(rowsAt + object * 20, rowsAt + object * 20 + 20);
      const parsed = /^(\d{10}) (\d{5}) n\r\n$/.exec(row);
      assert.ok(parsed, `${name}: object ${object} has a malformed 20-byte row: ${JSON.stringify(row)}`);
      const offset = Number(parsed[1]);
      const expected = `${object} 0 obj`;
      assert.equal(
        text.slice(offset, offset + expected.length),
        expected,
        `${name}: the offset for object ${object} lands on the wrong bytes`,
      );
    }

    const size = /\/Size (\d+)/.exec(text.slice(startxref));
    assert.ok(size && Number(size[1]) === count, `${name}: /Size must match the table length`);
    assert.match(text.slice(startxref), /\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/, `${name}: /ID is two 16-byte strings`);
  }
});

test('metadata: brackets escaped, non-ASCII in UTF-16, dates in PDF form', needsPdfTools(), async () => {
  const jpeg = fixture('red.jpg');
  const page = pageFor({ kind: 'jpeg', bytes: jpeg, width: 200, height: 200 });

  const awkward = 'Receipts (2026) 50% off + a backslash \\ and (unbalanced';
  const plain = await build([page], {
    title: awkward,
    author: 'O\\Brien (Sr.)',
    keywords: 'a, b',
    creator: 'Test suite',
    producedAt: new Date(Date.UTC(2024, 0, 15, 10, 30, 0)),
  });
  const plainPath = save('meta-plain.pdf', plain);
  qpdfCheck(plainPath);

  const plainText = Buffer.from(plain).toString('latin1');
  assert.match(plainText, /\/CreationDate \(D:20240115103000\+00'00'\)/, 'the exact PDF date form');
  assert.match(plainText, /\/ModDate \(D:20240115103000\+00'00'\)/);
  assert.ok(plainText.includes('\\(2026\\)'), 'brackets are escaped');
  assert.ok(plainText.includes('backslash \\\\ and'), 'and so is the backslash itself');

  const readPlain = python(PYPDF_READ, [plainPath]);
  assert.equal(readPlain.title, awkward, 'an unbalanced bracket survives the round trip');
  assert.equal(readPlain.author, 'O\\Brien (Sr.)');
  assert.equal(readPlain.created, "D:20240115103000+00'00'");

  const unicode = 'Rechnung für Straße — 発注書 🧾';
  const wide = await build([page], { title: unicode, subject: 'ελληνικά' });
  const widePath = save('meta-unicode.pdf', wide);
  qpdfCheck(widePath);
  const wideText = Buffer.from(wide).toString('latin1');
  assert.match(wideText, /\/Title <FEFF[0-9A-F]+>/, 'non-ASCII becomes a UTF-16BE hex string with a BOM');
  assert.equal(python(PYPDF_READ, [widePath]).title, unicode, 'and pypdf reads every character back');
  assert.equal(pdfInfo(widePath).Title, unicode, 'as does pdfinfo');

  // Nothing invented: a document with no metadata gets no /Title at all.
  const bare = Buffer.from(await build([page])).toString('latin1');
  assert.ok(!bare.includes('/Title'), 'no title was supplied, so none is written');
  assert.ok(!bare.includes('/Author'), 'and no author');
});

/** Every refusal is a sentence, not a code, because a person reads it. */
async function refusal(pages: PdfPageSpec[], what: string): Promise<string> {
  const result = await writePdf(pages, { deflate });
  if (result.ok) assert.fail(`${what} should have been refused, got ${result.bytes.length} bytes`);
  assert.ok(result.error.length > 30, `${what}: the message should be a sentence, got "${result.error}"`);
  assert.ok(/[.!]$/.test(result.error), `${what}: the message should end in a full stop`);
  assert.ok(!/undefined|NaN|\[object/.test(result.error), `${what}: no internals leaked: "${result.error}"`);
  return result.error;
}

test('impossible documents are refused with an explanation, not a broken PDF', needsPdfTools(), async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const good = pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 });

  await refusal([], 'a document with no pages');

  // 500 is the cap, so 500 works and 501 does not. Testing only the failure
  // would pass just as well if the cap were 1.
  const fiveHundred = await build(Array.from({ length: 500 }, () => good));
  qpdfCheck(save('five-hundred.pdf', fiveHundred));
  assert.match(await refusal(Array.from({ length: 501 }, () => good), '501 pages'), /500/);

  assert.match(
    await refusal([pageFor({ kind: 'jpeg', bytes: jpeg, width: 0, height: 480 })], 'a zero-width image'),
    /width|height|size/i,
  );
  await refusal([pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 0, components: 3 })], 'a zero-height image');
  await refusal([pageFor({ kind: 'jpeg', bytes: new Uint8Array(0), width: 10, height: 10 })], 'an empty file');
  await refusal([pageFor({ kind: 'jpeg', bytes: fixture('tiny.png'), width: 8, height: 8 })], 'a PNG labelled as a JPEG');

  // The declared size and the size in the JPEG header must agree, or the picture
  // is placed to the wrong shape.
  assert.match(
    await refusal([pageFor({ kind: 'jpeg', bytes: jpeg, width: 480, height: 640 })], 'a JPEG whose header disagrees'),
    /640|480/,
  );

  // Raw pixels have exactly one correct byte count.
  await refusal(
    [pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48, components: 4 })],
    'raw pixels that do not add up',
  );
  await refusal(
    [{ ...pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48 }) }],
    'raw pixels with no channel count',
  );

  // A page larger than PDF allows, and a placement with no area.
  await refusal([pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 }, { width: 20000, height: 500 })], 'a page 20000 pt wide');
  await refusal([{ ...good, size: { width: 0, height: 100 } }], 'a page with no width');
  await refusal([{ ...good, placement: { ...good.placement, width: 0 } }], 'an image scaled to nothing');
  await refusal([{ ...good, placement: { ...good.placement, x: Number.NaN } }], 'a placement that is not a number');
});

test('estimatePdfBytes is an upper bound, and cheap enough to call before writing', async () => {
  const jpeg = fixture('baseline-rgb.jpg');
  const cases: [string, PdfPageSpec[]][] = [
    ['one JPEG', [pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })]],
    [
      'mixed',
      [
        pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 }),
        pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48, components: 3 }),
        pageFor({ kind: 'raw', bytes: fixture('rgba-raw.bin'), width: 64, height: 48, components: 4, hasAlpha: true }),
      ],
    ],
    ['forty of the same', Array.from({ length: 40 }, () => pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 }))],
  ];

  for (const [name, pages] of cases) {
    const estimate = estimatePdfBytes(pages);
    const actual = (await build(pages)).length;
    assert.ok(estimate >= actual, `${name}: the estimate ${estimate} must not undershoot the real ${actual}`);
    assert.ok(estimate < actual * 6 + 8192, `${name}: ${estimate} is a useless over-estimate of ${actual}`);
  }

  // Repeating one image does not repeat its bytes in the estimate either, because
  // the writer stores it once.
  const once = estimatePdfBytes([pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })]);
  const fifty = estimatePdfBytes(Array.from({ length: 50 }, () => pageFor({ kind: 'jpeg', bytes: jpeg, width: 640, height: 480 })));
  assert.ok(fifty < once + 50 * 4096, 'fifty copies of one photo is not fifty photos');
  assert.ok(estimatePdfBytes([]) > 0, 'an empty document still has a header, a catalog and a trailer');
});

test('browserDeflate uses the platform stream, and its output is real zlib', needsPdfTools(), async () => {
  assert.notEqual(typeof CompressionStream, 'undefined', 'Node 22 has CompressionStream, so this path is testable here');

  const platform = browserDeflate();
  const original = new Uint8Array([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 9, 9, 9, 9, 9, 9, 9, 9]);
  const squashed = await platform(original);
  assert.deepEqual(Array.from(inflateSync(squashed)), Array.from(original), 'zlib inflates what the stream deflated');
  // /FlateDecode wants a zlib wrapper (RFC 1950), not a bare deflate stream:
  // 0x78 is the only CMF byte zlib emits for method 8 with a 32 KiB window.
  assert.equal(squashed[0], 0x78, 'the zlib header is present, so this is not deflate-raw');

  const empty = await platform(new Uint8Array(0));
  assert.equal(inflateSync(empty).length, 0, 'even nothing round-trips');

  const noisy = new Uint8Array(200000);
  for (let i = 0; i < noisy.length; i += 1) noisy[i] = (i * 2654435761) % 251;
  assert.deepEqual(Array.from(inflateSync(await platform(noisy))), Array.from(noisy), '200 KB crosses the stream chunk boundary');

  // The end-to-end proof: a PDF whose raw image was compressed by the browser
  // path, checked by qpdf and rendered by poppler.
  const result = await writePdf(
    [pageFor({ kind: 'raw', bytes: fixture('rgb-raw.bin'), width: 64, height: 48, components: 3 })],
    { deflate: platform },
  );
  if (!result.ok) assert.fail(`the platform deflate should have produced a PDF: ${result.error}`);
  const path = save('browser-deflate.pdf', result.bytes);
  qpdfCheck(path);
  const stats = python(PIL_STATS, [render(path, 'browser-deflate', 72), '0.5,0.5']);
  assert.deepEqual((stats.size as number[]).length, 2);
  assert.ok((stats.mean as number[])[2] > 120, 'the blue channel survived the round trip through CompressionStream');
});

test('an Adobe CMYK JPEG needs /Decode, and without it the page is a negative', needsPdfTools(), async () => {
  const cmyk = fixture('cmyk.jpg');
  // The page is exactly the image, edge to edge: the render can then be compared
  // pixel for pixel with PIL's own conversion, with no margin to explain away.
  const page: PdfPageSpec = {
    size: { width: 200, height: 150 },
    image: { kind: 'jpeg', bytes: cmyk, width: 200, height: 150 },
    placement: { x: 0, y: 0, width: 200, height: 150 },
  };

  // The writer works this out from the APP14 marker on its own; `decodeInverted`
  // is only the override used below to show what the wrong answer looks like.
  const right = await build([page]);
  const rightText = Buffer.from(right).toString('latin1');
  assert.match(rightText, /\/ColorSpace \/DeviceCMYK/);
  assert.match(rightText, /\/Decode \[1 0 1 0 1 0 1 0\]/, 'four channels, each complemented back');

  const wrong = await build([{ ...page, image: { ...page.image, decodeInverted: false } }]);
  assert.ok(!Buffer.from(wrong).toString('latin1').includes('/Decode'), 'the deliberately wrong file has no /Decode');

  // PIL's own conversion of the same file is the reference. Poppler's CMYK render
  // is not identical to PIL's, so this is a comparison of two distances, not an
  // equality: the corrected page is close, the uncorrected one is a negative.
  const reference = `${OUT}/cmyk-reference.png`;
  const converted = run('python3', [
    '-c',
    'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2])',
    `${FIXTURES}/cmyk.jpg`,
    reference,
  ]);
  assert.equal(converted.status, 0, `PIL could not convert the CMYK fixture: ${converted.stderr}`);

  const rightPath = save('cmyk-decoded.pdf', right);
  const wrongPath = save('cmyk-inverted.pdf', wrong);
  qpdfCheck(rightPath);
  qpdfCheck(wrongPath);
  ghostscript(rightPath);

  const near = python(IMAGE_DIFF, [reference, render(rightPath, 'cmyk-right', 72)]).meanAbsDiff as number;
  const far = python(IMAGE_DIFF, [reference, render(wrongPath, 'cmyk-wrong', 72)]).meanAbsDiff as number;
  assert.ok(near < 40, `the corrected page should look like the original, mean channel difference was ${near}`);
  assert.ok(far > 90, `and the uncorrected one should not, but its difference was only ${far}`);
  assert.ok(far > near * 3, `${far} against ${near}: /Decode is what makes the difference`);

  // A grey image asked to invert gets a two-entry array, not a four-entry one.
  const grey = await build([pageFor({ kind: 'jpeg', bytes: fixture('gray.jpg'), width: 320, height: 200 })]);
  assert.ok(!Buffer.from(grey).toString('latin1').includes('/Decode'), 'a normal grey JPEG needs no /Decode');
  const greyPixels = fixture('gray-raw.bin');
  const greyInverted = await build([
    {
      size: { width: 32, height: 32 },
      image: { kind: 'raw', bytes: greyPixels, width: 32, height: 32, components: 1, decodeInverted: true },
      placement: { x: 0, y: 0, width: 32, height: 32 },
    },
  ]);
  const greyText = Buffer.from(greyInverted).toString('latin1');
  assert.match(greyText, /\/Decode \[1 0\]/, 'the array is sized to the channel count');
  qpdfCheck(save('grey-inverted.pdf', greyInverted));
});
