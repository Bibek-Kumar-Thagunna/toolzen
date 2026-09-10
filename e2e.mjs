/**
 * End-to-end smoke test for the nine tools built in this pass.
 *
 * Not part of `npm run verify` — it needs a running server and a browser, which
 * the unit suite deliberately does not. It exists because the engines being
 * tested says nothing about whether the components wired to them work: every
 * bug this found was in the wiring, not in the maths.
 *
 *   npm start            (in one shell)
 *   node e2e.mjs         (in another)
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** Run one tool's flow, recording the outcome rather than throwing. */
async function check(name, path, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

/** Press the run button, then wait for the result panel's heading. */
async function runAndExpectResult(page, buttonText) {
  await page.getByRole('button', { name: buttonText }).first().click();
  const heading = page.locator('h2').filter({ hasText: /ready|compressed|resized|converted|extracted|files/i });
  await heading.first().waitFor({ state: 'visible', timeout: 45_000 });
  return (await heading.first().innerText()).trim();
}

/** Click the download control and report the file the browser was handed. */
async function download(page, buttonText) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByRole('button', { name: buttonText }).first().click(),
  ]);
  return event.suggestedFilename();
}

/* ── image tools ───────────────────────────────────────────────────────── */

await check('image-compressor', '/tools/image-compressor', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/photo.jpg');
  await page.getByLabel('Quality').fill('40');
  const title = await runAndExpectResult(page, 'Compress images');
  const summary = await page.locator('h2:has-text("compressed") + p').innerText();
  const file = await download(page, 'Download');
  return `${title} · ${summary} · ${file}`;
});

await check('image-resizer', '/tools/image-resizer', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/photo.jpg');
  await page.getByLabel('Width').fill('800');
  const title = await runAndExpectResult(page, 'Resize images');
  const file = await download(page, 'Download');
  return `${title} · ${file}`;
});

await check('image-cropper', '/tools/image-cropper', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/photo.jpg');
  await page.getByRole('button', { name: '1:1' }).click();
  const readout = await page.locator('[role=status]').first().innerText();
  await page.getByRole('button', { name: 'Crop image' }).click();
  await page.locator('h2:has-text("Crop ready")').waitFor({ timeout: 45_000 });
  const summary = await page.locator('h2:has-text("Crop ready") + p').innerText();
  const file = await download(page, 'Download crop');
  return `ratio readout "${readout}" → ${summary} · ${file}`;
});

await check('jpg-to-png', '/tools/jpg-to-png', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/photo.jpg');
  const title = await runAndExpectResult(page, 'Convert to PNG');
  const file = await download(page, 'Download');
  return `${title} · ${file}`;
});

await check('png-to-jpg', '/tools/png-to-jpg', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/pic.png');
  const title = await runAndExpectResult(page, 'Convert to JPG');
  const file = await download(page, 'Download');
  return `${title} · ${file}`;
});

await check('png-to-webp', '/tools/png-to-webp', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/pic.png');
  const title = await runAndExpectResult(page, 'Convert to WebP');
  const file = await download(page, 'Download');
  return `${title} · ${file}`;
});

/* ── pdf tools ─────────────────────────────────────────────────────────── */

await check('image-to-pdf', '/tools/image-to-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', ['/tmp/photo.jpg', '/tmp/pic.png']);
  await page.getByRole('button', { name: /Build PDF/ }).click();
  await page.locator('h2:has-text("PDF ready")').waitFor({ timeout: 60_000 });
  const summary = await page.locator('h2:has-text("PDF ready") + p').innerText();
  const file = await download(page, 'Download PDF');
  return `${summary} · ${file}`;
});

// The merge and split tools need a real PDF; the one produced above is the
// obvious source, so it is rebuilt here through the same tool and reused.
await check('merge-pdf + split-pdf', '/tools/image-to-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', ['/tmp/photo.jpg', '/tmp/pic.png']);
  await page.getByRole('button', { name: /Build PDF/ }).click();
  await page.locator('h2:has-text("PDF ready")').waitFor({ timeout: 60_000 });
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  await event.saveAs('/tmp/built.pdf');
  return `wrote /tmp/built.pdf for the PDF tools`;
});

await check('merge-pdf', '/tools/merge-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', ['/tmp/built.pdf', '/tmp/built.pdf']);
  await page.getByRole('button', { name: /Merge 2 PDFs/ }).click();
  await page.locator('h2:has-text("Merged PDF ready")').waitFor({ timeout: 60_000 });
  const summary = await page.locator('h2:has-text("Merged PDF ready") + p').innerText();
  const file = await download(page, 'Download merged PDF');
  return `${summary} · ${file}`;
});

await check('split-pdf', '/tools/split-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/built.pdf');
  await page.locator('text=/\\d+ pages/').first().waitFor({ timeout: 30_000 });
  await page.getByLabel('Pages to take').fill('2');
  await page.getByRole('button', { name: 'Extract pages' }).click();
  await page.locator('h2:has-text("Pages extracted")').waitFor({ timeout: 60_000 });
  const summary = await page.locator('h2:has-text("Pages extracted") + p').innerText();
  const file = await download(page, 'Download PDF');
  return `${summary} · ${file}`;
});

/* ── report ────────────────────────────────────────────────────────────── */

await browser.close();

let failed = 0;
for (const result of results) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  if (!result.ok) failed += 1;
  console.log(`${mark}  ${result.name.padEnd(22)} ${result.detail}`);
  for (const error of result.consoleErrors.slice(0, 3)) {
    console.log(`      console: ${error.slice(0, 160)}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
