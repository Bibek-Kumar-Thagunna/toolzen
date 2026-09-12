#!/usr/bin/env node
/**
 * ============================================================================
 * INTEGRITY CHECK
 * ============================================================================
 * The checks that catch real mistakes without needing a compiler or a package
 * install. `tsc`, `eslint` and `next build` are the real gate, and this script
 * does not pretend to replace them — it runs the subset of their work that can
 * be done by reading the tree, so that a broken import or a missing export is
 * found in seconds rather than at the first deploy.
 *
 * What it checks:
 *   1. Every relative and `@/…` import resolves to a file that exists.
 *   2. Every named import exists as an export of the file it points at,
 *      following `export * from` one hop at a time.
 *   3. Specifier style: modules under `src/lib` use relative paths with an
 *      explicit `.ts` extension, because Node's own type stripping runs them
 *      with no bundler to guess for it. Everything else uses extensionless
 *      paths, because TypeScript rejects a `.ts` extension in an import.
 *   4. Anything using a React hook, or attaching an inline event handler, is
 *      marked `'use client'`. Getting this wrong is a runtime error on a page
 *      that renders fine in isolation.
 *
 * Exit code 1 on any problem, so it can be a CI step.
 * ============================================================================
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const show = (file) => relative(root, file);
const fail = (file, message) => problems.push(`${show(file)}: ${message}`);

const sources = new Map();
function read(file) {
  let text = sources.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8');
    sources.set(file, text);
  }
  return text;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** `undefined` means "meant to resolve here and does not". */
function resolveSpecifier(fromFile, spec) {
  const base = spec.startsWith('@/')
    ? join(root, 'src', spec.slice(2))
    : resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/** Names in `{ a, b as c, type D }` as the *target* must export them. */
function importedNames(clause) {
  const names = [];
  for (const part of clause.split(',')) {
    // `{ a as b }` imports the target's `a`; the local alias is irrelevant here.
    const name = part.split(/\s+as\s+/)[0].trim().replace(/^type\s+/, '');
    if (name) names.push(name);
  }
  return names;
}

/** Names in `export { a, b as c }` as this module publishes them. */
function exportedNames(clause) {
  const names = [];
  for (const part of clause.split(',')) {
    const [left, right] = part.split(/\s+as\s+/);
    const name = (right ?? left).trim().replace(/^type\s+/, '');
    if (name) names.push(name);
  }
  return names;
}

const DECLARED =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|type|interface|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CLAUSE = /^export\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*'[^']+')?\s*;/gm;
const EXPORT_STAR = /^export\s+\*\s+from\s*'([^']+)'\s*;/gm;

const exportCache = new Map();

/** Every name a module publishes, following `export *` outward as needed. */
function exportsOf(file, seen = new Set()) {
  const cached = exportCache.get(file);
  if (cached) return cached;
  if (seen.has(file)) return new Set();
  seen.add(file);

  const src = read(file);
  const names = new Set();
  for (const match of src.matchAll(DECLARED)) names.add(match[1]);
  for (const match of src.matchAll(EXPORT_CLAUSE)) {
    for (const name of exportedNames(match[1])) names.add(name);
  }
  if (/^export\s+default\b/m.test(src)) names.add('default');

  for (const match of src.matchAll(EXPORT_STAR)) {
    const target = resolveSpecifier(file, match[1]);
    if (target && /\.tsx?$/.test(target)) {
      for (const name of exportsOf(target, seen)) names.add(name);
    }
  }

  exportCache.set(file, names);
  return names;
}

// The clause may not contain a quote or a semicolon, which is what stops a lazy
// match from swallowing a `import './globals.css';` line above it and reading
// the next statement's clause as a default import.
const IMPORT_FROM = /^import\s+([^';]*?)\s*from\s*'([^']+)'\s*;/gm;
const IMPORT_BARE = /^import\s*'([^']+)'\s*;/gm;
const REEXPORT_FROM = /^export\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'\s*;/gm;

function parseClause(raw) {
  const clause = raw.trim();
  const bare = clause.replace(/^type\s+/, '');
  const brace = bare.match(/\{([\s\S]*)\}/);
  const head = bare.split('{')[0].replace(/,\s*$/, '').trim();
  const specifiers = brace ? brace[1].split(',').filter((part) => part.trim()) : [];
  return {
    named: brace ? importedNames(brace[1]) : [],
    wantsDefault: head.length > 0 && !head.startsWith('*'),
    namespace: head.startsWith('*'),
    // A type-only import is erased before Node ever sees the module, so the
    // extension and path-shape rules below simply do not apply to it. This is
    // what lets `src/lib/registry` name an `IconName` from a .tsx module and
    // still run under `node --experimental-strip-types`.
    typeOnly:
      /^type\s/.test(clause) ||
      (specifiers.length > 0 && specifiers.every((part) => /^\s*type\s/.test(part))),
  };
}

/** One import or re-export: does it point somewhere real, and is it spelt right? */
function checkEdge(file, spec, named, wantsDefault, typeOnly = false) {
  const internal = spec.startsWith('.') || spec.startsWith('@/');
  const inLib = show(file).startsWith('src/lib/');

  if (!internal) {
    if (!inLib && !typeOnly && spec.startsWith('node:')) {
      fail(file, `imports ${spec} — Node built-ins cannot reach the browser`);
    }
    return;
  }

  if (!typeOnly) {
    if (inLib) {
      if (spec.startsWith('@/')) {
        fail(file, `${spec} should be a relative path: src/lib runs under Node's type stripping`);
      } else if (!/\.tsx?$/.test(spec)) {
        fail(file, `${spec} needs its .ts extension`);
      }
    } else if (/\.tsx?$/.test(spec)) {
      fail(file, `${spec} must not carry a .ts/.tsx extension`);
    }
  }

  const target = resolveSpecifier(file, spec);
  if (target === undefined) {
    fail(file, `cannot resolve ${spec}`);
    return;
  }
  if (!/\.tsx?$/.test(target)) return;

  const available = exportsOf(target);
  for (const name of named) {
    if (!available.has(name)) fail(file, `${show(target)} does not export ${name}`);
  }
  if (wantsDefault && !available.has('default')) {
    fail(file, `${show(target)} has no default export`);
  }
}

const HOOK_CALL = /\b(useState|useEffect|useLayoutEffect|useRef|useCallback|useMemo|useReducer|useId|useContext|useSyncExternalStore|useTransition|useOptimistic|useFormStatus)\s*\(/;
const INLINE_HANDLER = /\son[A-Z][A-Za-z]*=\{(?:\(|async|function)/;

/**
 * A hook or an inline handler in a module without `'use client'` is a runtime
 * error — and one that only appears when the module is rendered from a page,
 * which is exactly the case nobody tests by hand.
 *
 * Comments are stripped first: several files document the client-side pattern in
 * their header, and a `useState` inside a code example is not a call.
 */
function checkClientBoundary(file) {
  const shown = show(file);
  if (!shown.startsWith('src/components/') && !shown.startsWith('src/app/')) return;
  const src = read(file);
  if (/^'use client';/m.test(src)) return;
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (HOOK_CALL.test(code)) fail(file, "calls a React hook without 'use client'");
  else if (INLINE_HANDLER.test(code)) fail(file, "attaches an inline handler without 'use client'");
}

/**
 * ============================================================================
 * EVERY TOOL IN THE REGISTRY HAS A COMPONENT, AND VICE VERSA
 * ============================================================================
 * The registry decides which URLs exist: `generateStaticParams` builds a page
 * for every slug in it. `ToolMount` decides what renders inside those pages.
 * When the two disagree the failure is silent and expensive — a tool added to
 * the registry without a component ships a page with an article, a FAQ, a
 * breadcrumb and *no tool*, which is exactly the sort of page a search engine
 * demotes and an ad network flags as thin.
 *
 * Neither list can be imported here (one is TypeScript, the other pulls in
 * React), so both are read as text. That is coarse but exact for the thing it
 * checks: a slug is a quoted string in a known position in both files.
 *
 * The reverse direction matters too. A component left in the map after its
 * registry entry was removed is dead weight in no bundle and no page, but it
 * reads as supported and someone will eventually wire a link to it.
 * ============================================================================
 */
function checkToolCoverage() {
  const registryDir = join(root, 'src/lib/registry/tools');
  const mountFile = join(root, 'src/components/tools/ToolMount.tsx');

  let registrySlugs;
  let mountSlugs;
  try {
    registrySlugs = new Set(
      readdirSync(registryDir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .flatMap((name) => [...read(join(registryDir, name)).matchAll(/^\s*slug: '([a-z0-9-]+)',$/gm)])
        .map((match) => match[1]),
    );
    // Keys of the `registry` map: `  'slug': dynamic(` at one indent level.
    mountSlugs = new Set(
      [...read(mountFile).matchAll(/^\s{2}'([a-z0-9-]+)': dynamic\(/gm)].map((match) => match[1]),
    );
  } catch (cause) {
    problems.push(`tool coverage could not be checked: ${cause.message}`);
    return;
  }

  if (registrySlugs.size === 0) {
    problems.push('src/lib/registry/tools: no slugs found — has the registry format changed?');
    return;
  }

  for (const slug of registrySlugs) {
    if (!mountSlugs.has(slug)) {
      fail(mountFile, `'${slug}' is in the registry but has no component here — its page would render empty`);
    }
  }
  for (const slug of mountSlugs) {
    if (!registrySlugs.has(slug)) {
      fail(mountFile, `'${slug}' has a component here but no registry entry — no page will ever render it`);
    }
  }
}

/**
 * ============================================================================
 * THE PRIVACY CLAIMS, ENFORCED
 * ============================================================================
 * /privacy tells people three things that are properties of the code rather
 * than promises about our conduct: files are not uploaded, passwords are never
 * transmitted, and passwords are never stored. A privacy policy that has
 * drifted from the software is worse than none, because people have relied on
 * it — so the claims are checked here instead of being maintained by memory.
 *
 * ── Network ───────────────────────────────────────────────────────────────
 * No tool engine and no tool component may reference an API that can send
 * data off the device. This is what makes "there is no endpoint that receives
 * your file" a fact about the repository rather than an assurance: a tool that
 * acquired one would fail the build before it could ship.
 *
 * ── Storage, for the locking tools only ───────────────────────────────────
 * Narrower on purpose. Other tools legitimately remember a preference in local
 * storage, and saying otherwise would be the drift this check exists to stop.
 * The locking tools are different: the page says a password is never written
 * anywhere, and a "remember this password" convenience added in good faith two
 * years from now would quietly make that false.
 *
 * ── Comments are stripped first ───────────────────────────────────────────
 * Every one of these words appears in the prose above and in the module
 * headers, which explain at length why the code does not use them. Scanning
 * raw source would flag the explanations along with the violations, and a
 * check that cries wolf gets deleted.
 * ============================================================================
 */
const NETWORK_APIS = [
  ['fetch', /(?<![.\w])fetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['navigator.sendBeacon', /\bsendBeacon\b/],
];

const STORAGE_APIS = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/i],
  ['document.cookie', /document\s*\.\s*cookie\b/],
];

/** Source with comments and string literals removed, so only real code is scanned. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

function checkPrivacyClaims(file, src) {
  const relative = file.slice(root.length + 1);
  const isTool =
    relative.startsWith('src/lib/tools/') || relative.startsWith('src/components/tools/');
  const isLocking =
    relative.startsWith('src/lib/tools/secure/') ||
    relative.startsWith('src/lib/crypto/') ||
    /\/(LockFilesTool|UnlockFileTool)\.tsx$/.test(relative);
  if (!isTool && !isLocking) return;
  if (relative.endsWith('.test.ts') || relative.endsWith('.test.tsx')) return;

  const code = codeOnly(src);
  for (const [name, pattern] of NETWORK_APIS) {
    if (pattern.test(code)) {
      fail(
        file,
        `uses ${name}. Tools are declared as processed in the browser, and /privacy says so — a tool that sends data off the device makes that page a lie`,
      );
    }
  }
  if (!isLocking) return;
  for (const [name, pattern] of STORAGE_APIS) {
    if (pattern.test(code)) {
      fail(
        file,
        `uses ${name}. /privacy states that a password is never written to storage of any kind, including on the user's own device`,
      );
    }
  }
}

const files = walk(join(root, 'src')).filter((file) => /\.tsx?$/.test(file));

for (const file of files) {
  const src = read(file);
  for (const match of src.matchAll(IMPORT_FROM)) {
    const { named, wantsDefault, typeOnly } = parseClause(match[1]);
    checkEdge(file, match[2], named, wantsDefault, typeOnly);
  }
  for (const match of src.matchAll(IMPORT_BARE)) checkEdge(file, match[1], [], false);
  for (const match of src.matchAll(REEXPORT_FROM)) {
    // A re-export names the *target's* exports, same as an import does.
    checkEdge(file, match[3], importedNames(match[2]), false, Boolean(match[1]));
  }
  for (const match of src.matchAll(EXPORT_STAR)) checkEdge(file, match[1], [], false);
  checkClientBoundary(file);
  checkPrivacyClaims(file, src);
}

checkToolCoverage();

console.log(`Checked ${files.length} TypeScript files under src/.`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('No problems found.');
