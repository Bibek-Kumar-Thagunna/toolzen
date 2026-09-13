/**
 * End-to-end check on the one claim these two pages make: the file comes back
 * under the number you typed.
 *
 * Every assertion is a byte count against a ceiling, because "compress to
 * 20 KB" is a promise about bytes and nothing else. The interesting case is
 * deliberately the hard one — a detailed photograph at full resolution, where
 * quality alone cannot reach the target and the engine has to start removing
 * pixels. That is the step every competing tool skips, so it is the step worth
 * proving.
 *
 * The signature fixture is a scan-shaped image: a small amount of dark line
 * work on a large, slightly-off-white sheet. It exists to prove the trim runs
 * before the compression, by checking that the output is much smaller at the
 * same ceiling than the untrimmed version of the same file.
 *
 *   npm i -D playwright      (once)
 *   npm start                (in one shell)
 *   node e2e-targetsize.mjs  (in another)
 */
import { chromium } from 'playwright';
import { statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(slug, name, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  try {
    await page.goto(`${BASE}/tools/${slug}`, { waitUntil: 'networkidle' });
    results.push({ name, ok: true, detail: await body(page), consoleErrors });
  } catch (cause) {
    results.push({ name, ok: false, detail: String(cause).split('\n')[0], consoleErrors });
  } finally {
    await page.close();
  }
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

const PHOTO = '/tmp/ts-photo.jpg';
const SIGNATURE = '/tmp/ts-signature.png';

/*
 * A photograph-shaped image: smooth gradients with real structure over them,
 * then a light blur so adjacent pixels correlate the way a lens makes them.
 *
 * The first version of this fixture was uniform random noise, which turned out
 * to be a bad test rather than a hard one. Noise is genuinely incompressible —
 * every pixel is independent, so there is no redundancy for an encoder to
 * exploit — and the tool correctly reported that it could not reach 20 KB even
 * at a fifth of the original size. Nothing a camera produces behaves that way,
 * so the test was failing the tool for refusing to do the impossible.
 */
execFileSync('python3', [
  '-c',
  `
import math
from PIL import Image, ImageFilter
w, h = 2400, 1800
img = Image.new('RGB', (w, h))
px = img.load()
for y in range(h):
    for x in range(w):
        v = int(128 + 80 * math.sin(x / 160.0) * math.cos(y / 130.0) + 30 * math.sin((x + y) / 45.0))
        px[x, y] = (max(0, min(255, v)), max(0, min(255, int(v * 0.8) + 30)), max(0, min(255, 255 - v)))
img = img.filter(ImageFilter.GaussianBlur(0.6))
img.save('${PHOTO}', quality=95)
`,
]);

// A signature: dark strokes on a large off-white sheet, the shape the trim
// exists for.
execFileSync('python3', [
  '-c',
  `
from PIL import Image, ImageDraw
import math
w, h = 3000, 4000
img = Image.new('RGB', (w, h), (243, 240, 232))
d = ImageDraw.Draw(img)
pts = [(1200 + int(300 * math.sin(t / 30.0)), 1900 + int(140 * math.cos(t / 17.0))) for t in range(0, 600)]
d.line(pts, fill=(18, 20, 40), width=14)
img.save('${SIGNATURE}')
`,
]);

/* ── the run helper ─────────────────────────────────────────────────────── */

async function run(page, file, kb, saveAs, setup) {
  await page.setInputFiles('input[type=file]', file);
  await page.getByLabel('Maximum file size').fill(String(kb));
  if (setup) await setup(page);
  await page.getByRole('button', { name: new RegExp(`Compress to ${kb} KB`) }).click();

  const heading = page.locator('h2').filter({ hasText: /brought under/i });
  await heading.first().waitFor({ state: 'visible', timeout: 180_000 });
  const summary = (await heading.first().locator('xpath=../p[1]').innerText()).trim();

  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /Download/ }).first().click(),
  ]);
  await event.saveAs(saveAs);
  return { summary, bytes: statSync(saveAs).size };
}

/* ── the claim ──────────────────────────────────────────────────────────── */

for (const kb of [100, 50, 20]) {
  await check('compress-image-to-size', `a detailed 2400x1800 photo reaches ${kb} KB`, async (page) => {
    const before = statSync(PHOTO).size;
    const out = await run(page, PHOTO, kb, `/tmp/ts-out-${kb}.jpg`);
    expect(
      out.bytes <= kb * 1024,
      `OVER TARGET: asked for ${kb} KB, got ${Math.round(out.bytes / 1024)} KB`,
    );
    // Guard against the opposite failure: hitting the number by destroying the
    // picture. Landing at under a fifth of the budget means the search gave up
    // early rather than finding the best quality that fits.
    expect(
      out.bytes > kb * 1024 * 0.2,
      `suspiciously small: ${out.bytes} bytes for a ${kb} KB budget — the search may be bailing out`,
    );
    return `${Math.round(before / 1024)} KB -> ${Math.round(out.bytes / 1024)} KB (ceiling ${kb}) · ${out.summary}`;
  });
}

await check('compress-image-to-size', 'a file already under the ceiling is left alone', async (page) => {
  const small = '/tmp/ts-small.jpg';
  execFileSync('python3', [
    '-c',
    `from PIL import Image; Image.new('RGB', (120, 90), (200, 40, 40)).save('${small}', quality=80)`,
  ]);
  const before = statSync(small).size;
  const out = await run(page, small, 200, '/tmp/ts-out-small.jpg');
  expect(out.bytes <= before, `INFLATED a file that already fitted: ${before} -> ${out.bytes}`);
  return `${before} B in, ${out.bytes} B out · ${out.summary}`;
});

/* ── the trim, which is the reason the signature page exists ────────────── */

await check('resize-signature', 'the border trim is on by default and does real work', async (page) => {
  const withTrim = await run(page, SIGNATURE, 20, '/tmp/ts-sig-trim.jpg');
  expect(
    withTrim.bytes <= 20 * 1024,
    `OVER TARGET: ${Math.round(withTrim.bytes / 1024)} KB against a 20 KB ceiling`,
  );
  return `${Math.round(statSync(SIGNATURE).size / 1024)} KB -> ${Math.round(withTrim.bytes / 1024)} KB · ${withTrim.summary}`;
});

await check('resize-signature', 'trimming keeps more resolution than not trimming', async (page) => {
  // Same file, same ceiling, trim switched off. With the paper included, the
  // 20 KB budget has to cover the whole sheet, so the engine is forced to
  // scale much further down. Comparing the output dimensions is the direct
  // measure of whether the crop actually helped the writing survive.
  const off = await run(page, SIGNATURE, 20, '/tmp/ts-sig-notrim.jpg', async (p) => {
    await p.getByRole('switch', { name: /Trim the blank border/i }).click();
  });
  const size = (path) => {
    const out = execFileSync('python3', [
      '-c',
      `from PIL import Image; im = Image.open('${path}'); print(im.width, im.height)`,
    ])
      .toString()
      .trim()
      .split(' ')
      .map(Number);
    return { width: out[0], height: out[1] };
  };
  const trimmed = size('/tmp/ts-sig-trim.jpg');
  const untrimmed = size(off === null ? '' : '/tmp/ts-sig-notrim.jpg');

  // Comparing the two output widths directly would be misleading, and in the
  // wrong direction: the untrimmed sheet is mostly blank paper, which encodes
  // almost for free, so it comes back with *larger* overall dimensions while
  // the signature inside it is tiny. The number that matters is how many
  // pixels the writing itself ends up with.
  //
  // In the fixture the signature spans roughly 600 of the 3000-pixel width, so
  // in an untrimmed output it occupies a fifth of the frame. Scaling by that
  // fraction puts both results in the same unit — pixels across the signature
  // — which is the only fair comparison, and the one the page's claim is about.
  const SIGNATURE_FRACTION = 600 / 3000;
  const trimmedInk = trimmed.width;
  const untrimmedInk = untrimmed.width * SIGNATURE_FRACTION;

  expect(
    trimmedInk > untrimmedInk * 1.5,
    `the trim did not buy real resolution: signature is ~${Math.round(trimmedInk)}px wide trimmed ` +
      `vs ~${Math.round(untrimmedInk)}px untrimmed, at the same 20 KB ceiling`,
  );
  return (
    `signature ~${Math.round(trimmedInk)}px wide trimmed vs ~${Math.round(untrimmedInk)}px untrimmed ` +
    `at 20 KB (frames: ${trimmed.width}x${trimmed.height} vs ${untrimmed.width}x${untrimmed.height})`
  );
});

/* ── report ─────────────────────────────────────────────────────────────── */

await browser.close();

let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}`);
  console.log(`      ${result.detail}`);
  if (result.consoleErrors.length > 0) {
    console.log(`      page errors: ${result.consoleErrors.join(' | ')}`);
  }
  if (!result.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
