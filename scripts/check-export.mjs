/**
 * ============================================================================
 * POST-EXPORT SAFETY NET
 * ============================================================================
 * Runs after the static export and refuses to let a de-indexed build reach the
 * deploy step.
 *
 * ── The failure this exists to catch ──────────────────────────────────────
 * `src/lib/site.ts` deliberately disables indexing when the site URL looks
 * local or `NEXT_PUBLIC_NOINDEX` is set: the sitemap comes out empty and
 * robots.txt says `Disallow: /`. That is exactly right for a preview host, and
 * it is silent by design.
 *
 * Silent is the problem. Build without `NEXT_PUBLIC_SITE_URL` set — a shell
 * that forgot it, a CI job that did not pass it through, a deploy run by hand
 * on a tired evening — and the export is a complete, working, perfectly styled
 * site that tells every crawler to go away. Nothing looks wrong. The pages all
 * load. It would be discovered weeks later as "why is traffic zero", and weeks
 * of crawl budget and freshness would already be gone.
 *
 * So the export is inspected rather than trusted. Three things have to be true
 * of a build that is about to be published:
 *
 *   1. robots.txt does not disallow everything.
 *   2. the sitemap contains URLs, and enough of them to be the real site.
 *   3. those URLs are absolute and not pointed at localhost.
 *
 * Any of them failing is a build that must not go out, so this exits non-zero
 * and `npm run build:static` stops before `wrangler deploy` ever runs.
 *
 * ── Why the count is checked and not just "more than zero" ────────────────
 * A sitemap listing only the home page is the other shape of this bug — a
 * registry that failed to load, an export that ran before the pages were
 * generated. One URL is not evidence of a working site.
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.env.EXPORT_DIR ?? 'out');

/** Below this, something has gone wrong rather than the site being small. */
const MIN_URLS = 20;

const problems = [];

if (!existsSync(out)) {
  console.error(`check-export: no export found at ${out} — did the build run?`);
  process.exit(1);
}

/* ── robots.txt ────────────────────────────────────────────────────────── */

const robotsPath = join(out, 'robots.txt');
if (!existsSync(robotsPath)) {
  problems.push('robots.txt is missing from the export');
} else {
  const robots = readFileSync(robotsPath, 'utf8');
  if (/^\s*Disallow:\s*\/\s*$/im.test(robots)) {
    problems.push(
      'robots.txt disallows the whole site. This is what a build with no NEXT_PUBLIC_SITE_URL ' +
        '(or with NEXT_PUBLIC_NOINDEX=true) produces — correct for a preview host, catastrophic ' +
        'for production. Set NEXT_PUBLIC_SITE_URL and build again.',
    );
  }
  if (!/^\s*Sitemap:\s*https?:\/\//im.test(robots)) {
    problems.push('robots.txt names no sitemap, so a crawler has to discover every page by link');
  }
}

/* ── sitemap.xml ───────────────────────────────────────────────────────── */

const sitemapPath = join(out, 'sitemap.xml');
if (!existsSync(sitemapPath)) {
  problems.push('sitemap.xml is missing from the export');
} else {
  const xml = readFileSync(sitemapPath, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  if (urls.length === 0) {
    problems.push(
      'the sitemap is empty. Same cause as above: the build decided this deployment is not ' +
        'indexable. Nothing else about the export looks wrong, which is exactly why this is checked.',
    );
  } else if (urls.length < MIN_URLS) {
    problems.push(
      `the sitemap lists only ${urls.length} URLs, which is fewer than this site has. ` +
        'Something failed to enumerate rather than the site being small.',
    );
  }

  const local = urls.filter((url) => /localhost|127\.0\.0\.1|\[::1\]/.test(url));
  if (local.length > 0) {
    problems.push(`the sitemap points at localhost (${local[0]}) — the site URL was not set`);
  }
  const relative = urls.filter((url) => !/^https?:\/\//.test(url));
  if (relative.length > 0) {
    problems.push(`the sitemap contains a relative URL (${relative[0]}); crawlers require absolute ones`);
  }

  if (problems.length === 0) {
    console.log(`Export looks publishable: ${urls.length} URLs, robots.txt allows crawling.`);
  }
}

/* ── canonical spot check ──────────────────────────────────────────────── */

const home = join(out, 'index.html');
if (existsSync(home)) {
  const html = readFileSync(home, 'utf8');
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i.exec(html);
  if (!canonical) {
    problems.push('the home page has no canonical link');
  } else if (/localhost/.test(canonical[1])) {
    problems.push(`the home page canonical points at ${canonical[1]}`);
  }
  if (/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html)) {
    problems.push('the home page carries a noindex meta tag');
  }
}

if (problems.length > 0) {
  console.error(`\nThis build must not be published — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
