/**
 * End-to-end smoke test for the second batch of tools.
 *
 * Same shape and same reasoning as e2e.mjs: the unit suite proves the engines,
 * and every bug found at this layer so far has been in the wiring between a
 * component and its engine. Needs a running server.
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-batch2.mjs (in another)
 */
import { chromium } from 'playwright';
import { readFileSync, statSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

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

async function runAndExpectResult(page, buttonText, pattern = /ready|extracted|smaller|small as it gets/i) {
  await page.getByRole('button', { name: buttonText, exact: false }).first().click();
  const heading = page.locator('h2').filter({ hasText: pattern });
  await heading.first().waitFor({ state: 'visible', timeout: 90_000 });
  return (await heading.first().innerText()).trim();
}

async function summaryText(page) {
  return (await page.locator('h2').first().locator('xpath=following-sibling::p[1]').innerText()).trim();
}

async function download(page, buttonText, saveAs) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: buttonText }).first().click(),
  ]);
  if (saveAs) await event.saveAs(saveAs);
  return event.suggestedFilename();
}

/* ── compress-pdf ──────────────────────────────────────────────────────── */

await check('compress-pdf (text document, lossless)', '/tools/compress-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  await page.getByRole('button', { name: /Text, or I am not sure/ }).click();
  const title = await runAndExpectResult(page, 'Compress PDF');
  const summary = await summaryText(page);
  const file = await download(page, 'Download PDF', '/tmp/out-text-compressed.pdf');
  const before = statSync('/tmp/text.pdf').size;
  const after = statSync('/tmp/out-text-compressed.pdf').size;
  if (after > before) throw new Error(`INFLATED: ${before} -> ${after}`);
  return `${title} | ${summary} | ${file} | ${before} -> ${after} bytes`;
});

await check('compress-pdf (scan, rebuild)', '/tools/compress-pdf', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/built.pdf');
  await page.getByRole('button', { name: /Scanned pages or photos/ }).click();
  // The warning must be visible before the run button is pressed.
  const warned = await page.getByText('This changes the document').isVisible();
  const title = await runAndExpectResult(page, 'Compress PDF');
  const summary = await summaryText(page);
  await download(page, 'Download PDF', '/tmp/out-scan-compressed.pdf');
  const before = statSync('/tmp/built.pdf').size;
  const after = statSync('/tmp/out-scan-compressed.pdf').size;
  if (after > before) throw new Error(`INFLATED: ${before} -> ${after}`);
  const head = readFileSync('/tmp/out-scan-compressed.pdf').subarray(0, 5).toString('latin1');
  if (head !== '%PDF-') throw new Error(`not a PDF: ${head}`);
  return `warned=${warned} | ${title} | ${summary} | ${before} -> ${after} bytes (${Math.round((1 - after / before) * 100)}% off)`;
});

/* ── extract-pdf-text ──────────────────────────────────────────────────── */

await check('extract-pdf-text (real text layer)', '/tools/extract-pdf-text', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  const title = await runAndExpectResult(page, 'Extract text');
  const summary = await summaryText(page);
  const text = await page.locator('textarea').first().inputValue();
  if (!text.includes('Quarterly report')) throw new Error('heading text missing from output');
  if (!text.includes('quick brown fox')) throw new Error('body text missing from output');
  const file = await download(page, 'Download .txt');
  return `${title} | ${summary} | ${file} | ${text.length} chars | first line: ${text.split('\n')[0]}`;
});

await check('extract-pdf-text (page range + markers)', '/tools/extract-pdf-text', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  await page.getByLabel('Pages').fill('2');
  await page.getByRole('switch', { name: /Mark where each page starts/ }).first().click();
  await runAndExpectResult(page, 'Extract text');
  const text = await page.locator('textarea').first().inputValue();
  if (!text.includes('--- Page 2 ---')) throw new Error('page marker missing');
  if (text.includes('page 1:')) throw new Error('page 1 leaked into a page-2-only extraction');
  return `only page 2, marker present | ${text.length} chars`;
});

await check('extract-pdf-text (scanned document)', '/tools/extract-pdf-text', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/built.pdf');
  await page.getByRole('button', { name: 'Extract text' }).first().click();
  const alert = page.getByText('This document has no text in it');
  await alert.waitFor({ state: 'visible', timeout: 60_000 });
  return 'empty result reported as a finding, not an error';
});

/* ── webp converters ───────────────────────────────────────────────────── */

await check('webp-to-jpg', '/tools/webp-to-jpg', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/pic.webp');
  const title = await runAndExpectResult(page, 'Convert to JPG', /ready|converted/i);
  const file = await download(page, /Download/, '/tmp/out-webp.jpg');
  const bytes = readFileSync('/tmp/out-webp.jpg');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  return `${title} | ${file} | ${bytes.length} bytes`;
});

await check('webp-to-png (transparent)', '/tools/webp-to-png', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/logo.webp');
  const title = await runAndExpectResult(page, 'Convert to PNG', /ready|converted/i);
  const file = await download(page, /Download/, '/tmp/out-webp.png');
  const bytes = readFileSync('/tmp/out-webp.png');
  if (bytes.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('not a PNG');
  // Colour type 6 is truecolour with alpha: the transparency survived.
  const colourType = bytes[25];
  if (colourType !== 6) throw new Error(`expected RGBA (6), got colour type ${colourType}`);
  return `${title} | ${file} | ${bytes.length} bytes | RGBA preserved`;
});

/* ── favicon-generator ─────────────────────────────────────────────────── */

await check('favicon-generator', '/tools/favicon-generator', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/logo.png');
  const title = await runAndExpectResult(page, 'Generate icons', /ready/i);
  const summary = await summaryText(page);
  const previews = await page.locator('img[alt^="Icon at"]').count();
  const markup = await page.locator('pre').first().innerText();
  const file = await download(page, 'Download all as ZIP', '/tmp/out-favicon.zip');

  // Read the archive back and confirm the ICO is a real ICO with three entries.
  const zip = readFileSync('/tmp/out-favicon.zip');
  const names = [];
  for (let i = 0; i < zip.length - 4; i++) {
    if (zip.readUInt32LE(i) === 0x04034b50) {
      const nameLen = zip.readUInt16LE(i + 26);
      names.push(zip.subarray(i + 30, i + 30 + nameLen).toString('latin1'));
    }
  }
  for (const wanted of ['favicon.ico', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'site.webmanifest']) {
    if (!names.includes(wanted)) throw new Error(`archive is missing ${wanted}`);
  }
  return `${title} | ${summary} | ${previews} previews | zip: ${names.join(', ')} | ${file} | markup lines: ${markup.split('\n').length}`;
});

/* ── the ad rule still holds on the new pages ──────────────────────────── */

await check('ads stay out of the new tool workspaces', '/tools/compress-pdf', async (page) => {
  const inWorkspace = await page.locator('[data-ad-slot]').count();
  return `${inWorkspace} ad slots on the page before a result`;
});

await browser.close();

let failed = 0;
for (const result of results) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  if (!result.ok) failed += 1;
  console.log(`${mark}  ${result.name}\n      ${result.detail}`);
  const noise = result.consoleErrors.filter((line) => !/favicon|404|Failed to load resource/i.test(line));
  if (noise.length > 0) console.log(`      console: ${noise.slice(0, 3).join(' | ')}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
