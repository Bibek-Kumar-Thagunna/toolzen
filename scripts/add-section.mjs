/**
 * A one-shot codemod for appending a `content` section to registry tools.
 *
 * Companion to add-faq.mjs, and kept for the same reason: the SEO audit's
 * depth floor will be hit again by a future tool, and hand-editing a registry
 * file with a 3,000-character prose array in it is how a stray quote ends up
 * breaking the build.
 *
 * Usage: node scripts/add-section.mjs <sections.json>
 *   { "<slug>": { "heading": "...", "body": ["para", "para"] } }
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = join(root, 'src/lib/registry/tools');
const sections = JSON.parse(readFileSync(process.argv[2], 'utf8'));

function literal(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** End of the `content: [` array belonging to the tool whose slug is at `from`. */
function contentArrayEnd(src, from) {
  const at = src.indexOf('content: [', from);
  if (at < 0) return -1;
  let depth = 0;
  for (let i = at + 9; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'") {
      i += 1;
      while (i < src.length && (src[i] !== "'" || src[i - 1] === '\\')) i += 1;
      continue;
    }
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

let added = 0;
for (const name of readdirSync(registryDir)) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
  const path = join(registryDir, name);
  let src = readFileSync(path, 'utf8');
  let touched = false;

  for (const [slug, section] of Object.entries(sections)) {
    const slugAt = src.indexOf(`slug: '${slug}',`);
    if (slugAt < 0) continue;
    const end = contentArrayEnd(src, slugAt);
    if (end < 0) {
      console.error(`  ! ${slug}: no content array found`);
      continue;
    }
    const body = section.body.map((line) => `          ${literal(line)},\n`).join('');
    const block = `      {\n        heading: ${literal(section.heading)},\n        body: [\n${body}        ],\n      },\n`;
    src = `${src.slice(0, end).replace(/[ \t]+$/, '')}${block}    ${src.slice(end)}`;
    touched = true;
    added += 1;
    console.log(`  + ${slug}: "${section.heading}"`);
  }
  if (touched) writeFileSync(path, src);
}
console.log(`\n${added} sections added.`);
