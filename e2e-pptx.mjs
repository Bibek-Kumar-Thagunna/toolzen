/**
 * End-to-end test for the two PowerPoint tools.
 *
 * The unit suite already proves the writer produces a package python-pptx and
 * LibreOffice will open. What it cannot prove is that the *page* hands the
 * writer the right bytes — so every check here drives the real UI, saves the
 * real download, and then opens it with python-pptx again. A deck that the
 * browser assembles wrongly fails at the last step, not at a DOM assertion.
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-pptx.mjs   (in another)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = join(tmpdir(), 'e2e-pptx');
mkdirSync(OUT, { recursive: true });

const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, path, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const detail = await body(page);
    results.push({ name, ok: true, detail, consoleErrors });
  } catch (cause) {
    results.push({ name, ok: false, detail: String(cause).split('\n')[0], consoleErrors });
  } finally {
    await page.close();
  }
}

async function download(page, saveAs) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: /Download \.pptx/ }).first().click(),
  ]);
  await event.saveAs(saveAs);
  return event.suggestedFilename();
}

/**
 * The verifier: an implementation that has never seen this code reading the
 * file the way the user's copy of PowerPoint will.
 */
const INSPECT = `
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
  out["pictures"].append([
    {"l": s.left, "t": s.top, "w": s.width, "h": s.height, "bytes": len(s.image.blob), "ext": s.image.ext}
    for s in shapes
  ])
print(json.dumps(out))
`;

function inspect(file) {
  // NOT 'inspect.py': python puts the script's own directory first on the
  // import path, and a file by that name shadows the standard library's
  // `inspect`, which lxml imports — so python-pptx fails to load rather than
  // the deck failing to open. An hour of a very misleading traceback.
  const script = join(OUT, 'read-deck.py');
  writeFileSync(script, INSPECT);
  return JSON.parse(execFileSync('python3', [script, file], { encoding: 'utf8' }));
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

// Two landscape and one portrait, so a "fit the first picture" run has
// something to disagree with.
const MAKE = `
from PIL import Image
Image.new("RGB", (1600, 900), (200, 40, 40)).save("${OUT}/a.jpg", quality=90)
Image.new("RGB", (1600, 900), (40, 200, 40)).save("${OUT}/b.jpg", quality=90)
Image.new("RGB", (900, 1600), (40, 40, 200)).save("${OUT}/c.png")
Image.new("RGB", (64, 64), (0, 0, 0)).save("${OUT}/bad.webp")
`;
writeFileSync(join(OUT, 'make.py'), MAKE);
execFileSync('python3', [join(OUT, 'make.py')]);

/* ── images to pptx ────────────────────────────────────────────────────── */

await check('images-to-pptx (three pictures, 16:9)', '/tools/images-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', [
    join(OUT, 'a.jpg'),
    join(OUT, 'b.jpg'),
    join(OUT, 'c.png'),
  ]);
  await page.getByRole('button', { name: 'Build presentation' }).click();
  await page.locator('h2').filter({ hasText: /presentation is ready/i }).first().waitFor({ timeout: 60_000 });

  const file = join(OUT, 'three.pptx');
  const name = await download(page, file);
  const deck = inspect(file);

  expect(name.endsWith('.pptx'), `expected a .pptx, got ${name}`);
  expect(deck.slides === 3, `expected 3 slides, got ${deck.slides}`);
  expect(deck.width === 12192000 && deck.height === 6858000, `expected 16:9 EMU, got ${deck.width}x${deck.height}`);
  expect(deck.pictures.every((p) => p.length === 1), 'every slide should hold exactly one picture');

  // The two 16:9 photos should fill the slide edge to edge; the portrait one
  // must be letterboxed rather than stretched.
  const [first, , third] = deck.pictures.map((p) => p[0]);
  expect(first.w === deck.width, `a 16:9 picture should span the slide, got ${first.w}`);
  expect(third.w < deck.width && third.h === deck.height, 'a portrait picture should be pillarboxed, not stretched');
  expect(Math.abs(third.l + third.w / 2 - deck.width / 2) <= 2, 'the portrait picture should be centred');

  // Byte-for-byte embedding: the JPEG in the deck is the JPEG on disk.
  const onDisk = execFileSync('stat', ['-c', '%s', join(OUT, 'a.jpg')], { encoding: 'utf8' }).trim();
  expect(first.bytes === Number(onDisk), `embedded ${first.bytes} bytes, file is ${onDisk}`);
  expect(first.ext === 'jpg' || first.ext === 'jpeg', `expected a jpeg, got ${first.ext}`);

  return `3 slides at ${deck.width}×${deck.height}, portrait centred, JPEG embedded verbatim (${first.bytes} B)`;
});

await check('images-to-pptx (4:3 and cover)', '/tools/images-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', [join(OUT, 'c.png')]);
  await page.getByLabel('How the picture sits').selectOption('cover');
  await page.getByLabel('Slide size').selectOption('4:3');
  await page.getByRole('button', { name: 'Build presentation' }).click();
  await page.locator('h2').filter({ hasText: /presentation is ready/i }).first().waitFor({ timeout: 60_000 });

  const file = join(OUT, 'cover.pptx');
  await download(page, file);
  const deck = inspect(file);
  const pic = deck.pictures[0][0];

  expect(deck.width === 9144000, `expected 4:3 width, got ${deck.width}`);
  // Cover on a portrait picture means overflowing top and bottom.
  expect(pic.w === deck.width, 'cover must span the slide horizontally');
  expect(pic.h > deck.height, 'cover on a portrait picture must overflow vertically');
  expect(pic.t < 0, `the overflow should be split, so top is negative — got ${pic.t}`);
  return `4:3 slide, picture ${pic.w}×${pic.h} overflowing to ${pic.t} EMU`;
});

await check('images-to-pptx (a WebP is named, not dropped)', '/tools/images-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', [join(OUT, 'a.jpg'), join(OUT, 'bad.webp')]);
  await page.getByRole('button', { name: 'Build presentation' }).click();
  await page.locator('h2').filter({ hasText: /presentation is ready/i }).first().waitFor({ timeout: 60_000 });

  const body = await page.locator('body').innerText();
  expect(/left out/i.test(body), 'the skipped file should be reported');
  expect(body.includes('bad.webp'), 'the skipped file should be named');
  expect(/WEBP/i.test(body), 'the reason should say what the format was');

  const file = join(OUT, 'skip.pptx');
  await download(page, file);
  const deck = inspect(file);
  expect(deck.slides === 1, `the usable picture should still produce a slide, got ${deck.slides}`);
  return `WebP named and skipped, ${deck.slides} slide built from the rest`;
});

/* ── pdf to pptx ───────────────────────────────────────────────────────── */

await check('pdf-to-pptx (pages become slides)', '/tools/pdf-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  await page.getByLabel('Pages').waitFor({ timeout: 30_000 });

  // The warning has to be readable before the button is pressed, not after.
  const beforeRun = await page.locator('body').innerText();
  expect(/picture of the page/i.test(beforeRun), 'the not-editable warning must be visible before running');

  await page.getByRole('button', { name: 'Build presentation' }).click();
  await page.locator('h2').filter({ hasText: /presentation is ready/i }).first().waitFor({ timeout: 120_000 });

  const file = join(OUT, 'pages.pptx');
  await download(page, file);
  const deck = inspect(file);

  expect(deck.slides >= 1, `expected at least one slide, got ${deck.slides}`);
  expect(deck.pictures.every((p) => p.length === 1), 'every page should land as one picture');
  // 'Match the pages' is the default, so an A4 document must come out portrait.
  expect(deck.height > deck.width, `pages are portrait, so the deck should be too — got ${deck.width}×${deck.height}`);
  const pic = deck.pictures[0][0];
  expect(pic.w === deck.width && pic.h === deck.height, 'the page image should fill the slide exactly');
  return `${deck.slides} slides at ${deck.width}×${deck.height}, each page filling its slide`;
});

await check('pdf-to-pptx (a page range and 16:9)', '/tools/pdf-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  await page.getByLabel('Pages').waitFor({ timeout: 30_000 });
  await page.getByLabel('Pages').fill('1');
  await page.getByLabel('Slide shape').selectOption('16:9');
  await page.getByRole('button', { name: 'Build presentation' }).click();
  await page.locator('h2').filter({ hasText: /presentation is ready/i }).first().waitFor({ timeout: 120_000 });

  const file = join(OUT, 'one.pptx');
  await download(page, file);
  const deck = inspect(file);

  expect(deck.slides === 1, `a range of "1" should give one slide, got ${deck.slides}`);
  expect(deck.width === 12192000, `expected a 16:9 slide, got ${deck.width}`);
  const pic = deck.pictures[0][0];
  expect(pic.h === deck.height && pic.w < deck.width, 'a portrait page on a 16:9 slide should be pillarboxed');
  return `1 slide, 16:9, portrait page pillarboxed to ${pic.w} EMU wide`;
});

await check('pdf-to-pptx (a bad range blocks the run)', '/tools/pdf-to-pptx', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  await page.getByLabel('Pages').waitFor({ timeout: 30_000 });
  await page.getByLabel('Pages').fill('9999');
  const button = page.getByRole('button', { name: 'Build presentation' });
  await button.waitFor();
  expect(await button.isDisabled(), 'an out-of-range page should disable the button');
  return 'out-of-range page range disables the build button';
});

/* ── the ad rule ───────────────────────────────────────────────────────── */

await check('no ad slots inside the pptx workspaces', '/tools/pdf-to-pptx', async (page) => {
  const inside = await page.locator('[data-ad-free] [data-ad-slot]').count();
  expect(inside === 0, `${inside} ad slots inside the workspace`);
  return 'no ad slots inside the tool workspace';
});

await browser.close();

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n      ${result.detail}`);
  const noise = result.consoleErrors.filter((line) => !/favicon|404|Failed to load resource/i.test(line));
  if (noise.length > 0) console.log(`      console: ${noise.slice(0, 3).join(' | ')}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
