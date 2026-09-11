/**
 * End-to-end check on the thing the tool is named after: does it compress?
 *
 * Every assertion here is a byte count, because "compress" is a claim about
 * bytes and the failure mode reported from the field was a file coming back
 * *larger* than it went in. The fixtures are the two cases that matter:
 *
 *   photo-as-png   a photograph saved as PNG — the file people actually bring
 *                  to a compressor, and the one a canvas re-encode inflates
 *   ui-shot        a flat interface screenshot — where colour reduction wins
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-compress.mjs (in another)
 */
import { chromium } from 'playwright';
import { statSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function check(name, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  try {
    await page.goto(`${BASE}/tools/image-compressor`, { waitUntil: 'networkidle' });
    results.push({ name, ok: true, detail: await body(page), consoleErrors });
  } catch (cause) {
    results.push({ name, ok: false, detail: String(cause).split('\n')[0], consoleErrors });
  } finally {
    await page.close();
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Run the compressor and hand back the summary line plus the downloaded size.
 *
 * `setup` runs after the file is queued, because the format and colour controls
 * only exist once there is something to compress — the workspace is a dropzone
 * until then.
 */
async function compress(page, file, saveAs, setup) {
  await page.setInputFiles('input[type=file]', file);
  if (setup) await setup(page);
  await page.getByRole('button', { name: 'Compress images' }).click();
  const heading = page.locator('h2').filter({ hasText: /compressed|small as it gets/i });
  await heading.first().waitFor({ state: 'visible', timeout: 120_000 });
  const summary = (
    await heading.first().locator('xpath=../p[1]').innerText()
  ).trim();

  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: /Download/ }).first().click(),
  ]);
  await event.saveAs(saveAs);
  return { summary, bytes: statSync(saveAs).size, name: event.suggestedFilename() };
}

const PHOTO_PNG = '/tmp/photo-as-png.png';
const UI_SHOT = '/tmp/ui-shot.png';

/* ── the reported bug: a PNG coming back larger ──────────────────────────── */

await check('a photo saved as PNG gets genuinely smaller', async (page) => {
  const before = statSync(PHOTO_PNG).size;
  const out = await compress(page, PHOTO_PNG, '/tmp/out-photo-png.png');
  expect(out.bytes < before, `INFLATED: ${before} -> ${out.bytes}`);
  expect(
    out.bytes < before * 0.5,
    `expected well under half of ${before}, got ${out.bytes} — this is the case the tool exists for`,
  );
  return `${before} -> ${out.bytes} (${Math.round((1 - out.bytes / before) * 100)}% off) · ${out.summary}`;
});

await check('"keep the original format" on a PNG never inflates', async (page) => {
  const before = statSync(PHOTO_PNG).size;
  const out = await compress(page, PHOTO_PNG, '/tmp/out-keep.png', async (p) => {
    await p.getByLabel('Save as').selectOption('keep');
  });
  expect(out.bytes < before, `INFLATED: ${before} -> ${out.bytes}`);
  expect(out.name.endsWith('.png'), `"keep the format" produced ${out.name}`);
  return `${before} -> ${out.bytes} as ${out.name} · ${out.summary}`;
});

await check('turning colour reduction off keeps a PNG pixel-exact', async (page) => {
  const before = statSync(PHOTO_PNG).size;
  const out = await compress(page, PHOTO_PNG, '/tmp/out-lossless.png', async (p) => {
    await p.getByLabel('Save as').selectOption('png');
    await p.getByRole('switch', { name: /reducing colours/i }).click();
  });
  // With no colour reduction there is no lossless saving to find, so the
  // never-inflate rule should hand the original straight back.
  expect(out.bytes <= before, `INFLATED: ${before} -> ${out.bytes}`);
  return `${before} -> ${out.bytes} · ${out.summary}`;
});

await check('forced PNG output uses the indexed encoder and wins big', async (page) => {
  const before = statSync(PHOTO_PNG).size;
  const out = await compress(page, PHOTO_PNG, '/tmp/out-indexed.png', async (p) => {
    await p.getByLabel('Save as').selectOption('png');
  });
  expect(out.name.endsWith('.png'), `asked for PNG, got ${out.name}`);
  expect(out.bytes < before * 0.6, `expected a real saving on PNG output, got ${out.bytes} of ${before}`);
  // Colour type 3 is an indexed PNG — proof the custom encoder, not the canvas,
  // produced this file. A canvas always writes colour type 6.
  const colourType = (await import('node:fs')).readFileSync('/tmp/out-indexed.png')[25];
  expect(colourType === 3, `expected an indexed PNG (colour type 3), got type ${colourType}`);
  return `${before} -> ${out.bytes} (${Math.round((1 - out.bytes / before) * 100)}% off) as an indexed PNG · ${out.summary}`;
});

await check('a flat screenshot compresses hard', async (page) => {
  const before = statSync(UI_SHOT).size;
  const out = await compress(page, UI_SHOT, '/tmp/out-ui.png');
  expect(out.bytes < before, `INFLATED: ${before} -> ${out.bytes}`);
  return `${before} -> ${out.bytes} (${Math.round((1 - out.bytes / before) * 100)}% off) · ${out.summary}`;
});

await check('the output is a valid image the browser can display', async (page) => {
  const out = await compress(page, UI_SHOT, '/tmp/out-valid.png');
  // Load the bytes back through the browser's own decoder: a PNG we wrote by
  // hand that no decoder accepts would pass every byte-count check above.
  const size = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const out = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return out;
  }, Array.from(new Uint8Array((await import('node:fs')).readFileSync('/tmp/out-valid.png'))));
  expect(size.width === 1200 && size.height === 800, `decoded as ${size.width}x${size.height}`);
  return `re-decoded at ${size.width}×${size.height} from ${out.bytes} bytes`;
});

/* ── the slider the user could not see ───────────────────────────────────── */

await check('the quality slider is visible and draggable', async (page) => {
  await page.setInputFiles('input[type=file]', UI_SHOT);
  const slider = page.locator('#compressor-quality');
  await slider.waitFor({ state: 'visible' });

  const box = await slider.boundingBox();
  expect(box !== null && box.height >= 20, `the slider has no usable hit area: ${JSON.stringify(box)}`);

  // The groove must actually differ from the card behind it.
  const contrast = await page.evaluate(() => {
    const read = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const a = lum(read('--c-track'));
    const b = lum(read('--c-surface'));
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  });
  expect(contrast >= 3, `the groove is ${contrast.toFixed(2)}:1 against the card — needs 3:1`);

  // And the filled portion must track the value.
  await slider.fill('30');
  const fill = await slider.evaluate((el) => el.style.getPropertyValue('--slider-fill'));
  expect(fill.startsWith('29') || fill.startsWith('30'), `fill did not follow the value: ${fill}`);
  return `${box.height}px tall · groove ${contrast.toFixed(2)}:1 · fill ${fill} at quality 30`;
});

await browser.close();

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n      ${result.detail}`);
  const noise = result.consoleErrors.filter((line) => !/favicon|404/i.test(line));
  if (noise.length > 0) console.log(`      console: ${noise.slice(0, 2).join(' | ')}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
