/**
 * End-to-end test for the locking tools.
 *
 * The unit suites prove the formats are right. What only a browser can prove
 * is that the *pages* produce those formats — so every check here drives the
 * real UI, saves the real download, and then verifies it with software that
 * has never seen this codebase: 7-Zip for the zip path, and a round trip back
 * through the site's own unlock page for both.
 *
 * The last test is the important one. It loads the standalone unlocker with
 * the network cut off at the browser, and confirms it still opens a file. That
 * page is the promise that a .tzlock is never a hostage, and a promise that is
 * not tested is not a promise.
 *
 *   npm i -D playwright   (once)
 *   npm start             (in one shell)
 *   node e2e-lock.mjs   (in another)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const OUT = join(tmpdir(), 'e2e-lock');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const PASSWORD = 'three purple lanterns drift';
const results = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function check(name, path, body) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const consoleErrors = [];
  const requests = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(path.startsWith('file:') ? path : BASE + path, { waitUntil: 'networkidle' });
    const detail = await body(page, requests);
    results.push({ name, ok: true, detail, consoleErrors });
  } catch (cause) {
    results.push({ name, ok: false, detail: String(cause).split('\n')[0], consoleErrors });
  } finally {
    await page.close();
  }
}

async function download(page, buttonPattern, saveAs) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: buttonPattern }).first().click(),
  ]);
  await event.saveAs(saveAs);
  return event.suggestedFilename();
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

const SECRET = Buffer.from('salary review, strictly confidential. '.repeat(200), 'utf8');
const BINARY = Buffer.from(
  Array.from({ length: 30_000 }, (_, i) => (i * 2654435761) % 256),
);
writeFileSync(join(OUT, 'memo.txt'), SECRET);
writeFileSync(join(OUT, 'scan.bin'), BINARY);

/** Fill the shared parts of the locking form. */
async function fillLockForm(page, { format, password = PASSWORD, files }) {
  await page.setInputFiles('input[type=file]', files);
  await page.locator(`#fmt-${format}`).check();
  await page.locator('#lock-password').fill(password);
}

/* ── the zip path ──────────────────────────────────────────────────────── */

await check('lock → a zip 7-Zip opens with the password', '/tools/password-protect-files', async (page) => {
  await fillLockForm(page, {
    format: 'zip',
    files: [join(OUT, 'memo.txt'), join(OUT, 'scan.bin')],
  });
  await page.getByRole('button', { name: 'Lock files' }).click();
  await page.locator('h2').filter({ hasText: /file is locked/i }).first().waitFor({ timeout: 60_000 });

  const archive = join(OUT, 'locked.zip');
  const name = await download(page, /Download \.zip/, archive);
  expect(name.endsWith('.zip'), `expected a .zip, got ${name}`);

  const dir = join(OUT, 'seven');
  const run = execFileSync('7z', ['x', archive, `-p${PASSWORD}`, `-o${dir}`, '-y'], {
    encoding: 'utf8',
  });
  expect(/Everything is Ok/.test(run), `7z did not extract cleanly:\n${run}`);
  expect(
    sha(readFileSync(join(dir, 'memo.txt'))) === sha(SECRET),
    'the text file did not come back identical',
  );
  expect(
    sha(readFileSync(join(dir, 'scan.bin'))) === sha(BINARY),
    'the binary file did not come back identical',
  );

  const listed = execFileSync('7z', ['l', '-slt', archive, `-p${PASSWORD}`], { encoding: 'utf8' });
  expect(/AES-256/.test(listed), 'the archive should be AES-256, not ZipCrypto');
  return '7-Zip extracted both files byte-identically, reported AES-256';
});

await check('a wrong password is refused by 7-Zip too', '/tools/password-protect-files', async (page) => {
  await fillLockForm(page, { format: 'zip', files: [join(OUT, 'memo.txt')] });
  await page.getByRole('button', { name: 'Lock files' }).click();
  await page.locator('h2').filter({ hasText: /file is locked/i }).first().waitFor({ timeout: 60_000 });
  const archive = join(OUT, 'wrong.zip');
  await download(page, /Download \.zip/, archive);

  let failed = false;
  try {
    execFileSync('7z', ['x', archive, '-pwrong', `-o${join(OUT, 'wrongout')}`, '-y'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    failed = true;
  }
  expect(failed, 'a wrong password must not extract anything');
  return 'the archive refuses a wrong password in an independent reader';
});

/* ── the .tzlock path ──────────────────────────────────────────────────── */

await check('lock → .tzlock, with a hint', '/tools/password-protect-files', async (page) => {
  await fillLockForm(page, { format: 'tzlock', files: [join(OUT, 'memo.txt')] });
  await page.locator('#lock-hint').fill('the usual one');
  await page.getByRole('button', { name: 'Lock files' }).click();
  await page.locator('h2').filter({ hasText: /file is locked/i }).first().waitFor({ timeout: 60_000 });

  const locked = join(OUT, 'locked.tzlock');
  const name = await download(page, /Download \.tzlock/, locked);
  expect(name.endsWith('.tzlock'), `expected a .tzlock, got ${name}`);

  const bytes = readFileSync(locked);
  expect(bytes.subarray(0, 6).toString('latin1') === 'TZLOCK', 'the magic bytes are wrong');
  expect(bytes[7] === 1, `expected format version 1, got ${bytes[7]}`);
  // The hint is in the clear by design; the contents must not be.
  expect(bytes.includes(Buffer.from('the usual one')), 'the hint should be readable in the header');
  expect(
    !bytes.includes(Buffer.from('strictly confidential')),
    'the plaintext must not be findable in the locked file',
  );
  return `${bytes.length} bytes, version 1, hint readable, contents not`;
});

/* ── the strength meter ────────────────────────────────────────────────── */

await check('the meter refuses to flatter a bad password', '/tools/password-protect-files', async (page) => {
  await page.setInputFiles('input[type=file]', [join(OUT, 'memo.txt')]);
  await page.locator('#lock-password').fill('P@ssw0rd');
  await page.waitForTimeout(150);
  const weak = await page.locator('body').innerText();
  expect(/Very weak/.test(weak), 'P@ssw0rd must not be rated as anything but very weak');
  expect(/instantly|seconds/.test(weak), 'it should say how fast it falls');

  await page.locator('#lock-password').fill('three purple lanterns drift together');
  await page.waitForTimeout(150);
  const strong = await page.locator('body').innerText();
  expect(/Strong/.test(strong), 'a four-word passphrase should rate strong');
  return 'P@ssw0rd rates very weak; a passphrase rates strong';
});

await check('the same password is rated differently per format', '/tools/password-protect-files', async (page) => {
  await page.setInputFiles('input[type=file]', [join(OUT, 'memo.txt')]);
  // Chosen to land mid-scale, where the 600× work factor moves the answer.
  await page.locator('#lock-password').fill('Rk4!zQ9m');
  await page.locator('#fmt-zip').check();
  await page.waitForTimeout(150);
  const zipTime = await page.locator('text=/Guessed in/').first().innerText();
  await page.locator('#fmt-tzlock').check();
  await page.waitForTimeout(150);
  const lockTime = await page.locator('text=/Guessed in/').first().innerText();
  expect(
    zipTime !== lockTime,
    `the work factor should change the estimate, both said "${zipTime}"`,
  );
  return `zip: ${zipTime.replace(/\s+/g, ' ')} · tzlock: ${lockTime.replace(/\s+/g, ' ')}`;
});

/* ── the unlock tool ───────────────────────────────────────────────────── */

await check('unlock → the site opens its own .tzlock', '/tools/unlock-file', async (page) => {
  await page.setInputFiles('input[type=file]', join(OUT, 'locked.tzlock'));
  await page.locator('#unlock-password').waitFor({ timeout: 20_000 });

  const before = await page.locator('body').innerText();
  expect(/the usual one/.test(before), 'the hint should be shown before the password is typed');

  await page.locator('#unlock-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('h2').filter({ hasText: /ready/i }).first().waitFor({ timeout: 60_000 });

  const saved = join(OUT, 'from-site.txt');
  await download(page, /Download/, saved);
  expect(sha(readFileSync(saved)) === sha(SECRET), 'the file did not come back identical');
  return 'hint shown before the prompt, file recovered byte for byte';
});

await check('unlock → a wrong password says so', '/tools/unlock-file', async (page) => {
  await page.setInputFiles('input[type=file]', join(OUT, 'locked.tzlock'));
  await page.locator('#unlock-password').waitFor({ timeout: 20_000 });
  await page.locator('#unlock-password').fill('definitely not it');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('text=/does not open this file/i').first().waitFor({ timeout: 60_000 });
  return 'a wrong password is reported as a wrong password';
});

await check('unlock → opens an AES zip made by 7-Zip, not by us', '/tools/unlock-file', async (page) => {
  // The case that matters most: a file a colleague sent, made by other software.
  const theirs = join(OUT, 'theirs.zip');
  execFileSync('7z', ['a', '-tzip', '-mem=AES256', `-p${PASSWORD}`, theirs, join(OUT, 'memo.txt')], {
    encoding: 'utf8',
  });

  await page.setInputFiles('input[type=file]', theirs);
  await page.locator('#unlock-password').waitFor({ timeout: 20_000 });
  const listing = await page.locator('body').innerText();
  expect(/memo\.txt/.test(listing), 'a zip listing should be readable before the password');

  await page.locator('#unlock-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('h2').filter({ hasText: /ready/i }).first().waitFor({ timeout: 60_000 });

  const saved = join(OUT, 'from-7z.txt');
  await download(page, /Download/, saved);
  expect(sha(readFileSync(saved)) === sha(SECRET), 'the file did not come back identical');
  return "7-Zip's own AES archive opened and extracted correctly";
});

await check('unlock → a weakly-encrypted zip is called out', '/tools/unlock-file', async (page) => {
  const legacy = join(OUT, 'legacy.zip');
  execFileSync(
    '7z',
    ['a', '-tzip', '-mem=ZipCrypto', `-p${PASSWORD}`, legacy, join(OUT, 'memo.txt')],
    { encoding: 'utf8' },
  );
  await page.setInputFiles('input[type=file]', legacy);
  await page.locator('#unlock-password').waitFor({ timeout: 20_000 });
  await page.locator('#unlock-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.locator('text=/ZipCrypto/i').first().waitFor({ timeout: 30_000 });
  return 'the old scheme is named and explained rather than silently accepted';
});

/* ── nothing is uploaded ───────────────────────────────────────────────── */

await check('nothing leaves the device while locking', '/tools/password-protect-files', async (page, requests) => {
  const beforeCount = requests.length;
  await fillLockForm(page, { format: 'tzlock', files: [join(OUT, 'memo.txt')] });
  await page.getByRole('button', { name: 'Lock files' }).click();
  await page.locator('h2').filter({ hasText: /file is locked/i }).first().waitFor({ timeout: 60_000 });

  const during = requests.slice(beforeCount).filter((url) => !url.startsWith('blob:'));
  // Next may fetch a route chunk; a data upload is a POST to anywhere, and
  // there should be none at all.
  const uploads = during.filter((url) => !/\/_next\/|\.js$|\.css$|\.woff2?$/.test(url));
  expect(uploads.length === 0, `unexpected requests during encryption: ${uploads.join(', ')}`);
  return `${during.length} requests during the run, none of them an upload`;
});

/* ── the offline unlocker, with the network actually cut ───────────────── */

await check(
  'the standalone unlocker works with the network switched off',
  pathToFileURL(join(process.cwd(), 'public', 'unlock.html')).href,
  async (page) => {
    // Offline *and* loaded from file://, so there is no server to fall back on.
    await page.context().setOffline(true);

    await page.setInputFiles('#file', join(OUT, 'locked.tzlock'));
    await page.locator('#passwordField:visible').waitFor({ timeout: 20_000 });
    const note = await page.locator('#fileNote').innerText();
    expect(/version 1/.test(note), `the header should be read offline, got: ${note}`);
    expect(/the usual one/.test(note), 'the hint should be shown');

    await page.locator('#password').fill(PASSWORD);
    await page.locator('#unlock').click();
    await page.locator('#results:visible').waitFor({ timeout: 60_000 });

    const [event] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Save' }).first().click(),
    ]);
    const saved = join(OUT, 'from-offline.txt');
    await event.saveAs(saved);
    expect(sha(readFileSync(saved)) === sha(SECRET), 'the offline unlocker returned the wrong bytes');
    return 'opened a .tzlock from file:// with the network off and recovered the file exactly';
  },
);

await check(
  'the standalone unlocker refuses a wrong password offline too',
  pathToFileURL(join(process.cwd(), 'public', 'unlock.html')).href,
  async (page) => {
    await page.context().setOffline(true);
    await page.setInputFiles('#file', join(OUT, 'locked.tzlock'));
    await page.locator('#passwordField:visible').waitFor({ timeout: 20_000 });
    await page.locator('#password').fill('wrong');
    await page.locator('#unlock').click();
    await page.locator('#status.error').waitFor({ timeout: 60_000 });
    const message = await page.locator('#status').innerText();
    expect(/does not open/i.test(message), `unexpected message: ${message}`);
    return 'a wrong password is refused, with the honest message about alteration';
  },
);

/* ── the ad rule ───────────────────────────────────────────────────────── */

await check('no ad slots inside the locking workspace', '/tools/password-protect-files', async (page) => {
  const inside = await page.locator('[data-ad-free] [data-ad-slot]').count();
  expect(inside === 0, `${inside} ad slots inside the workspace`);
  return 'no ad slots inside the tool workspace';
});

await browser.close();

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}\n      ${result.detail}`);
  const noise = result.consoleErrors.filter(
    (line) => !/favicon|404|Failed to load resource|ERR_INTERNET_DISCONNECTED/i.test(line),
  );
  if (noise.length > 0) console.log(`      console: ${noise.slice(0, 3).join(' | ')}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
