/**
 * A one-shot codemod for adding FAQ entries to registry tools by slug.
 *
 * Kept in the repo rather than run and deleted, because the SEO audit will
 * eventually demand another round of these and re-deriving the insertion logic
 * from scratch is how a registry file gets mangled at midnight.
 *
 * Usage: node scripts/add-faq.mjs <additions.json>
 *   { "<slug>": [ { "q": "...", "a": "..." }, … ] }
 *
 * Entries are appended to the end of the tool's existing `faq` array, which is
 * where a "common questions" block belongs: the questions specific to the tool
 * are what a reader came for, and the ones about price and watermarks are what
 * they check before leaving.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = join(root, 'src/lib/registry/tools');

const additions = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/** TypeScript string literal in the file's own style: single quotes, escaped. */
function literal(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * The index just past the `]` that closes the `faq: [` array of the tool whose
 * `slug: '<slug>'` appears at `from`.
 *
 * Bracket-counted rather than regex-matched, because answers contain square
 * brackets and a lazy `\]` would close the array inside a sentence.
 */
function faqArrayEnd(src, from) {
  const faqAt = src.indexOf('faq: [', from);
  if (faqAt < 0) return -1;
  let depth = 0;
  for (let at = faqAt + 5; at < src.length; at += 1) {
    const character = src[at];
    if (character === "'") {
      // Skip the string, honouring escapes.
      at += 1;
      while (at < src.length && (src[at] !== "'" || src[at - 1] === '\\')) at += 1;
      continue;
    }
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return at;
    }
  }
  return -1;
}

let changed = 0;
for (const name of readdirSync(registryDir)) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
  const path = join(registryDir, name);
  let src = readFileSync(path, 'utf8');
  let touched = false;

  for (const [slug, entries] of Object.entries(additions)) {
    const slugAt = src.indexOf(`slug: '${slug}',`);
    if (slugAt < 0) continue;
    const end = faqArrayEnd(src, slugAt);
    if (end < 0) {
      console.error(`  ! ${slug}: could not find the end of its faq array`);
      continue;
    }
    const block = entries
      .map((entry) => `      {\n        q: ${literal(entry.q)},\n        a: ${literal(entry.a)},\n      },\n`)
      .join('');
    // The slice already ends with the indent that sat before `]`, so it is
    // trimmed before the block goes in — otherwise every added entry lands
    // four spaces deeper than the ones above it.
    src = `${src.slice(0, end).replace(/[ \t]+$/, '')}${block}    ${src.slice(end)}`;
    touched = true;
    changed += entries.length;
    console.log(`  + ${slug}: ${entries.length} entries`);
  }

  if (touched) writeFileSync(path, src);
}

console.log(`\n${changed} FAQ entries added.`);
