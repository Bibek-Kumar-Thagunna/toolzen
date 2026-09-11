/**
 * End-to-end smoke test for the calculators-and-text batch.
 *
 * These tools compute during render rather than on a run button, so the checks
 * here are about the wiring being right and the arithmetic reaching the page —
 * including the two conversions that are easy to get plausibly wrong: feet and
 * inches, and Fahrenheit.
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-batch3.mjs (in another)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const results = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function check(name, path, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
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

/** The big number in the answer card. */
async function headline(page) {
  const el = page.locator('p.text-2xl, p.tabular').first();
  await el.waitFor({ state: 'visible', timeout: 15_000 });
  return (await el.innerText()).trim();
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/* ── BMI ───────────────────────────────────────────────────────────────── */

await check('bmi-calculator (metric)', '/tools/bmi-calculator', async (page) => {
  await page.getByLabel('Weight', { exact: false }).first().fill('70');
  await page.locator('#bmi-height').fill('170');
  const value = await headline(page);
  // 70 / 1.7^2 = 24.221...
  expect(value.startsWith('24.2'), `expected ~24.22, got ${value}`);
  const marked = await page.locator('tr[aria-current="true"]').innerText();
  expect(/Normal/.test(marked), `expected the normal band marked, got ${marked}`);
  return `BMI ${value} · band: ${marked.replace(/\s+/g, ' ').trim()}`;
});

await check('bmi-calculator (feet and inches)', '/tools/bmi-calculator', async (page) => {
  await page.locator('#bmi-weight').fill('154');
  await page.getByLabel('Weight unit').selectOption('lb');
  await page.getByLabel('Height unit').selectOption('ft');
  await page.locator('#bmi-feet').fill('5');
  await page.getByLabel('Height in inches').fill('9');
  const value = await headline(page);
  // 154 lb = 69.85 kg, 5 ft 9 in = 175.26 cm -> 22.74.
  // The classic bug reads 5 ft 9 as 5.9 ft (179.8 cm) and returns 21.6.
  expect(value.startsWith('22.7'), `expected ~22.74 — 5.9ft would give 21.6 — got ${value}`);
  return `BMI ${value} from 154 lb, 5 ft 9 in (the decimal-feet trap is avoided)`;
});

/* ── unit converter ────────────────────────────────────────────────────── */

await check('unit-converter (length)', '/tools/unit-converter', async (page) => {
  await page.locator('#unit-amount').fill('5');
  await page.getByLabel('Convert from').selectOption('km');
  await page.getByLabel('Convert to').selectOption('mi');
  const value = await page.getByLabel('Converted amount').inputValue();
  // 5 km is 3.106855961 miles. Compare as a number: the engine keeps ten
  // significant figures, and asserting on a prefix would fail on correct output.
  expect(Math.abs(Number(value) - 3.106855961) < 1e-6, `5 km should be ~3.106856 miles, got ${value}`);
  const rows = await page.locator('table tbody tr').count();
  return `5 km = ${value} miles · ${rows} other units listed`;
});

await check('unit-converter (temperature offset)', '/tools/unit-converter', async (page) => {
  await page.getByLabel('What are you converting?').selectOption('temperature');
  await page.locator('#unit-amount').fill('100');
  await page.getByLabel('Convert from').selectOption('C');
  await page.getByLabel('Convert to').selectOption('F');
  const value = await page.getByLabel('Converted amount').inputValue();
  // A converter that treats °F as a pure ratio returns 180 here.
  expect(value.startsWith('212'), `100°C must be 212°F — a ratio-only converter says 180 — got ${value}`);
  return `100 °C = ${value} °F (offset applied, not just the ratio)`;
});

await check('unit-converter (swap is exact)', '/tools/unit-converter', async (page) => {
  await page.locator('#unit-amount').fill('1');
  await page.getByLabel('Convert from').selectOption('mi');
  await page.getByLabel('Convert to').selectOption('km');
  const forward = await page.getByLabel('Converted amount').inputValue();
  expect(forward.startsWith('1.609344'), `1 mile should be 1.609344 km, got ${forward}`);
  return `1 mile = ${forward} km (exact by definition)`;
});

/* ── discount ──────────────────────────────────────────────────────────── */

await check('discount-calculator (price and tax)', '/tools/discount-calculator', async (page) => {
  await page.locator('#disc-price').fill('80');
  await page.locator('#disc-percent').fill('25');
  await page.locator('#disc-tax').fill('20');
  const value = await headline(page);
  // 80 - 25% = 60, +20% tax = 72.
  expect(value.includes('72'), `expected 72.00, got ${value}`);
  return `£80 − 25% + 20% tax = ${value}`;
});

await check('discount-calculator (stacking)', '/tools/discount-calculator', async (page) => {
  await page.getByRole('tab', { name: 'Stacked discounts' }).click();
  await page.locator('#disc-stackprice').fill('100');
  await page.locator('#disc-stacklist').fill('20, 20');
  const value = await headline(page);
  expect(value.includes('64'), `100 with two 20% discounts should be 64, got ${value}`);
  const body = await page.locator('body').innerText();
  expect(/36(\.00)?%/.test(body), 'the real 36% figure should appear');
  expect(/40(\.00)?%/.test(body), 'the naive 40% figure should be shown for comparison');
  return `two 20% discounts on 100 = ${value}, shown as 36% not 40%`;
});

/* ── url encoder ───────────────────────────────────────────────────────── */

await check('url-encoder (component vs whole URL)', '/tools/url-encoder', async (page) => {
  await page.locator('#url-input').fill('cats & dogs/kittens?a=1');
  const asComponent = await page.locator('#url-encoded').inputValue();
  expect(asComponent.includes('%26'), 'an ampersand must be escaped in a component');
  expect(asComponent.includes('%2F'), 'a slash must be escaped in a component');

  await page.getByRole('switch', { name: /Encode a whole address/ }).click();
  const asUrl = await page.locator('#url-encoded').inputValue();
  expect(asUrl.includes('&') && !asUrl.includes('%26'), 'a whole address keeps its ampersand');
  expect(asUrl.includes('%20'), 'a space is still escaped in a whole address');
  return `component: ${asComponent} | address: ${asUrl}`;
});

await check('url-encoder (inspect)', '/tools/url-encoder', async (page) => {
  await page.getByRole('tab', { name: 'Inspect a URL' }).click();
  await page.locator('#url-input').fill('https://example.com/a/b?q=caf%C3%A9%20bar&utm_source=news#top');
  const body = await page.locator('body').innerText();
  expect(body.includes('café bar'), 'the decoded parameter value should be shown');
  expect(body.includes('utm_source'), 'every parameter should be listed');
  expect(body.includes('example.com'), 'the host should be shown');
  return 'host, path, fragment and both parameters decoded';
});

await check('url-encoder (double encoding warned)', '/tools/url-encoder', async (page) => {
  await page.getByRole('tab', { name: 'Decode' }).click();
  await page.locator('#url-input').fill('hello%2520world');
  const decoded = await page.locator('#url-decoded').inputValue();
  expect(decoded === 'hello%20world', `expected one layer removed, got ${decoded}`);
  return `decoded one layer: "${decoded}"`;
});

/* ── lorem ─────────────────────────────────────────────────────────────── */

await check('lorem-ipsum-generator', '/tools/lorem-ipsum-generator', async (page) => {
  const first = await page.locator('#lorem-output').inputValue();
  expect(first.length > 200, 'the page should arrive with text already on it');
  expect(first.split('\n\n').length === 3, 'three paragraphs by default');

  await page.getByRole('button', { name: 'Generate again' }).click();
  const second = await page.locator('#lorem-output').inputValue();
  expect(second !== first, 'regenerating should produce different text');

  await page.getByRole('switch', { name: /Lorem ipsum dolor sit amet/i }).click();
  const third = await page.locator('#lorem-output').inputValue();
  expect(third.startsWith('Lorem ipsum dolor sit amet'), `expected the classic opening, got ${third.slice(0, 40)}`);

  await page.getByRole('switch', { name: /Wrap in HTML paragraph tags/i }).click();
  const html = await page.locator('#lorem-output').inputValue();
  expect(html.startsWith('<p>'), 'HTML mode should wrap paragraphs');
  return 'renders on first paint, regenerates, classic opening and <p> tags all work';
});

/* ── the ad rule ───────────────────────────────────────────────────────── */

await check('no ad slots inside the new workspaces', '/tools/bmi-calculator', async (page) => {
  const count = await page.locator('[data-ad-slot]').count();
  return `${count} ad slots on the page`;
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
