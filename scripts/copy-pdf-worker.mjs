#!/usr/bin/env node
/**
 * ============================================================================
 * copy-pdf-worker.mjs — vendor the pdf.js worker into public/
 * ============================================================================
 * Run automatically by `npm install` (see `postinstall` in package.json), so a
 * fresh clone is ready to render a PDF without anyone reading this file.
 *
 * ── Why the worker is self-hosted rather than loaded from a CDN ─────────────
 * The documented pdf.js pattern is to point `workerSrc` at jsdelivr or unpkg.
 * That is wrong for this product in three separate ways:
 *
 *   1. It is a privacy leak dressed as a convenience. The page promises the
 *      file never leaves the device, and that stays true — but the *request for
 *      the worker* tells a third party, on every PDF a visitor opens, their IP
 *      address and the page they were on. Whatever the CDN's policy says, we
 *      would be making a claim about data flow that we do not control.
 *   2. It weakens the CSP. Self-hosting keeps `script-src` and `worker-src` at
 *      `'self'` for the PDF tools instead of widening them to a CDN origin that
 *      serves arbitrary packages.
 *   3. It is a hard dependency on someone else's uptime for a tool that
 *      otherwise needs nothing but the browser.
 *
 * ── Why the filename carries the version ───────────────────────────────────
 * The worker must be the exact same release as the `pdfjs-dist` build that
 * loads it; a mismatch throws `The API version does not match the Worker
 * version`, and the failure mode is a tool that works for new visitors and is
 * broken for everyone with a warm cache. So the copy is written as
 * `pdf.worker.<version>.min.mjs`, and the client reads that version from the
 * package itself:
 *
 *     import { GlobalWorkerOptions, version } from 'pdfjs-dist';
 *     GlobalWorkerOptions.workerSrc = `/pdf/pdf.worker.${version}.min.mjs`;
 *
 * One string, one source of truth, and `Cache-Control: immutable` on `/pdf/*`
 * (see next.config.mjs) becomes safe: an upgrade changes the URL.
 *
 * ── Deployment note ────────────────────────────────────────────────────────
 * `output: 'standalone'` does not copy `public/`. The Dockerfile has to, and
 * it must run `npm ci` (which triggers this script) in the same stage that
 * produces the image, or the worker will be missing at runtime.
 * ============================================================================
 */
import { createRequire } from 'node:module';
import { mkdir, copyFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectRoot, 'public', 'pdf');

/** Candidate worker paths inside pdfjs-dist, best first. */
const CANDIDATES = [
  'build/pdf.worker.min.mjs',
  'build/pdf.worker.mjs',
  'legacy/build/pdf.worker.min.mjs',
  'legacy/build/pdf.worker.mjs',
];

function log(message) {
  process.stdout.write(`[copy-pdf-worker] ${message}\n`);
}

/**
 * Locate the installed package. Returns `null` rather than throwing when it is
 * absent: this runs as a postinstall hook, and a partial or dev-only install
 * should not make `npm install` fail. The missing file is caught later and
 * loudly by `scripts/check-integrity.mjs`, which is the right place for a hard
 * failure because it runs before a build rather than during dependency setup.
 */
function locatePackage() {
  try {
    const manifestPath = require.resolve('pdfjs-dist/package.json');
    const manifest = require('pdfjs-dist/package.json');
    return { root: dirname(manifestPath), version: String(manifest.version ?? '') };
  } catch {
    return null;
  }
}

async function firstExisting(root) {
  for (const candidate of CANDIDATES) {
    const full = join(root, candidate);
    try {
      const info = await stat(full);
      if (info.isFile()) return { full, candidate, size: info.size };
    } catch {
      // Next candidate.
    }
  }
  return null;
}

/**
 * Remove worker copies from previous versions. Without this, every upgrade
 * leaves ~1MB of dead JavaScript in `public/`, which ends up in the Docker
 * image and in the repository if anyone commits it.
 */
async function pruneStale(keepName) {
  let entries;
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === keepName) continue;
    if (!/^pdf\.worker\..*\.m?js$/.test(entry)) continue;
    await rm(join(outDir, entry), { force: true });
    log(`removed stale ${entry}`);
  }
}

async function main() {
  const pkg = locatePackage();
  if (pkg === null) {
    log('pdfjs-dist is not installed — skipping. Run `npm install` before building.');
    return;
  }
  if (pkg.version === '') {
    log('pdfjs-dist has no version field — skipping.');
    return;
  }

  const source = await firstExisting(pkg.root);
  if (source === null) {
    // This one *is* an error worth failing on: the package is installed, so a
    // missing worker means the vendor moved it and CANDIDATES needs updating.
    // Silently continuing would ship a build whose PDF tools cannot start.
    process.exitCode = 1;
    log(`no worker found in pdfjs-dist@${pkg.version}. Looked for: ${CANDIDATES.join(', ')}`);
    return;
  }

  const targetName = `pdf.worker.${pkg.version}.min.mjs`;
  const target = join(outDir, targetName);

  await mkdir(outDir, { recursive: true });
  await copyFile(source.full, target);
  await pruneStale(targetName);

  const kb = Math.round(source.size / 1024);
  log(`pdfjs-dist@${pkg.version}: ${source.candidate} → ${relative(projectRoot, target)} (${kb}KB)`);
}

await main();
