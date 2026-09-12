/**
 * The variant pages must be different *tools*, not the same tool with
 * different words on it. That is the line between a landing page and a
 * doorway page, and it is a claim about behaviour, so it is tested as one:
 * each check drives the real page and asserts the narrowing is actually there.
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-variants.mjs (in another)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, path, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    results.push({ name, ok: true, detail: await body(page), errors });
  } catch (cause) {
    results.push({ name, ok: false, detail: String(cause).split('\n')[0], errors });
  } finally {
    await page.close();
  }
}

/** What the file input will actually let through. */
async function acceptAttr(page) {
  return page.locator('input[type=file]').first().getAttribute('accept');
}

await check('jpg-to-pdf accepts only JPEG', '/tools/jpg-to-pdf', async (page) => {
  const accept = await acceptAttr(page);
  expect(/jpeg|jpg/i.test(accept), `no jpeg in accept: ${accept}`);
  expect(!/png|webp|gif|bmp/i.test(accept), `the variant should refuse other formats: ${accept}`);
  return `accept="${accept}"`;
});

await check('png-to-pdf accepts only PNG', '/tools/png-to-pdf', async (page) => {
  const accept = await acceptAttr(page);
  expect(/png/i.test(accept), `no png in accept: ${accept}`);
  expect(!/jpeg|jpg|webp/i.test(accept), `the variant should refuse other formats: ${accept}`);
  return `accept="${accept}"`;
});

await check('image-to-pdf still accepts everything', '/tools/image-to-pdf', async (page) => {
  const accept = await acceptAttr(page);
  // The parent must be unchanged — a variant that narrowed its parent would be
  // a regression dressed as an SEO win.
  expect(/png/i.test(accept) && /jpeg/i.test(accept) && /webp/i.test(accept), accept);
  return `accept="${accept}"`;
});

// The controls on these two only exist once a file is queued, so the file has
// to go in before the default can be read.
await check('pdf-to-png opens on PNG, not JPG', '/tools/pdf-to-png', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  const select = page.locator('#pdfimg-format');
  await select.waitFor({ timeout: 20_000 });
  const value = await select.inputValue();
  expect(/png/i.test(value), `expected the PNG option selected, got ${value}`);
  return `default format: ${value}`;
});

await check('pdf-to-jpg still opens on JPG', '/tools/pdf-to-jpg', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/text.pdf');
  const select = page.locator('#pdfimg-format');
  await select.waitFor({ timeout: 20_000 });
  const value = await select.inputValue();
  expect(/jpeg|jpg/i.test(value), `the parent should be unchanged, got ${value}`);
  return `default format: ${value}`;
});

await check('compress-png hides the format chooser', '/tools/compress-png', async (page) => {
  const accept = await acceptAttr(page);
  expect(/png/i.test(accept) && !/jpeg/i.test(accept), `accept: ${accept}`);
  await page.setInputFiles('input[type=file]', '/tmp/e2e-var/shot.png');
  // The colour-reduction control is the one this page keeps, so it is what
  // marks the controls as rendered.
  await page.locator('#compressor-colors').waitFor({ timeout: 20_000 });
  expect((await page.locator('#compressor-format').count()) === 0, 'a PNG page should not ask which format you want out');
  // The quality slider is lossless-irrelevant and the copy says it is hidden,
  // so the copy and the code have to agree.
  expect((await page.locator('#compressor-quality').count()) === 0, 'the dead quality slider should be gone, as the page claims');
  return `accept="${accept}", format chooser and quality slider both absent`;
});

await check('compress-jpeg hides it too, and takes only JPG', '/tools/compress-jpeg', async (page) => {
  const accept = await acceptAttr(page);
  expect(/jpeg|jpg/i.test(accept) && !/png/i.test(accept), `accept: ${accept}`);
  await page.setInputFiles('input[type=file]', '/tmp/e2e-var/photo.jpg');
  await page.locator('#compressor-quality').waitFor({ timeout: 20_000 });
  expect((await page.locator('#compressor-format').count()) === 0, 'format chooser should be hidden');
  return `accept="${accept}", format chooser absent with a file queued`;
});

await check('image-compressor keeps its chooser', '/tools/image-compressor', async (page) => {
  await page.setInputFiles('input[type=file]', '/tmp/e2e-var/photo.jpg');
  await page.locator('#compressor-quality').waitFor({ timeout: 20_000 });
  expect((await page.locator('#compressor-format').count()) === 1, 'the parent must be unchanged');
  return 'format chooser still present on the general tool';
});

/* ── the pages themselves ──────────────────────────────────────────────── */

for (const [slug, phrase] of [
  ['jpg-to-pdf', 'JPG to PDF'],
  ['png-to-pdf', 'PNG to PDF'],
  ['pdf-to-png', 'PDF to PNG'],
  ['compress-jpeg', 'Compress JPEG'],
  ['compress-png', 'Compress PNG'],
]) {
  await check(`${slug} is indexable and distinct`, `/tools/${slug}`, async (page) => {
    const title = await page.title();
    expect(title.includes(phrase), `title should carry "${phrase}": ${title}`);
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    expect(canonical.endsWith(`/tools/${slug}`), `canonical points elsewhere: ${canonical}`);
    const robots = await page.locator('meta[name=robots]').count();
    const body = await page.locator('body').innerText();
    expect(/watermark/i.test(body), 'the watermark question should be answered on the page');
    return `"${title}" · canonical ok · ${robots} robots meta · ${body.split(/\s+/).length} words`;
  });
}

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
  const noise = r.errors.filter((l) => !/favicon|404/i.test(l));
  if (noise.length) console.log(`      console: ${noise.slice(0, 2).join(' | ')}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
