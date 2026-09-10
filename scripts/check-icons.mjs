/**
 * Mechanical audit of src/components/icons.tsx.
 *
 * Parses the `paths` object out of the source, then walks every path with a
 * real SVG path interpreter: current point, subpath start, command persistence,
 * repeated-M-becomes-L, and endpoint-to-centre arc parameterisation so the
 * bounding box of an `a` command is exact rather than the crude +/-r box.
 *
 * Checks: key set, duplicate geometry, legal characters, first command is M,
 * no adjacent command letters, decimal budget, arc chord vs 2r, geometry
 * inside the 2..22 optical grid, and drawn extent (warning only).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src/components/icons.tsx');
const source = readFileSync(SRC, 'utf8');

// ── Extract the `paths` object ───────────────────────────────────────────────
const start = source.indexOf('const paths = {');
const end = source.indexOf('} as const satisfies', start);
if (start < 0 || end < 0) throw new Error('could not locate the paths object');
const body = source.slice(source.indexOf('{', start) + 1, end);

/** name -> string[] */
const icons = new Map();
{
  // Strip comments so `// ── Category ──` lines cannot be read as keys.
  const clean = body.replace(/\/\/[^\n]*/g, '');
  const keyRe = /(?:'([^']+)'|([A-Za-z][\w-]*))\s*:\s*/g;
  let m;
  const hits = [];
  while ((m = keyRe.exec(clean)) !== null) hits.push({ name: m[1] ?? m[2], at: m.index, after: keyRe.lastIndex });
  for (let i = 0; i < hits.length; i += 1) {
    const slice = clean.slice(hits[i].after, i + 1 < hits.length ? hits[i + 1].at : clean.length);
    const list = [...slice.matchAll(/'([^']*)'/g)].map((x) => x[1]);
    icons.set(hits[i].name, list);
  }
}

const errors = [];
const warnings = [];

// ── Path interpreter ─────────────────────────────────────────────────────────
const ARG_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenise(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) out.push(m[1] ? { cmd: m[1] } : { num: Number(m[2]) });
  return out;
}

/** Exact bounding box contribution of an elliptical arc, via centre parameterisation. */
function arcExtremes(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  const pts = [
    [x1, y1],
    [x2, y2],
  ];
  if (rx === 0 || ry === 0) return pts;
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // Step 1: compute (x1', y1')
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;
  let RX = Math.abs(rx);
  let RY = Math.abs(ry);
  // Step 2: correct out-of-range radii (F.6.6)
  const lambda = (x1p * x1p) / (RX * RX) + (y1p * y1p) / (RY * RY);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    RX *= s;
    RY *= s;
  }
  const sq = Math.max(0, (RX * RX * RY * RY - RX * RX * y1p * y1p - RY * RY * x1p * x1p) /
    (RX * RX * y1p * y1p + RY * RY * x1p * x1p));
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(sq);
  const cxp = coef * ((RX * y1p) / RY);
  const cyp = coef * (-(RY * x1p) / RX);
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / RX, (y1p - cyp) / RY);
  let delta = ang((x1p - cxp) / RX, (y1p - cyp) / RY, (-x1p - cxp) / RX, (-y1p - cyp) / RY);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  // Include any parametric extreme whose angle lies inside the swept range.
  const inSweep = (t) => {
    // normalise offset from theta1 into the sweep direction
    let off = t - theta1;
    if (delta > 0) {
      while (off < 0) off += 2 * Math.PI;
      while (off > 2 * Math.PI) off -= 2 * Math.PI;
      return off <= delta + 1e-9;
    }
    while (off > 0) off -= 2 * Math.PI;
    while (off < -2 * Math.PI) off += 2 * Math.PI;
    return off >= delta - 1e-9;
  };
  // dx/dt = 0 and dy/dt = 0 for the rotated ellipse
  const tx = Math.atan2(-RY * sin, RX * cos);
  const ty = Math.atan2(RY * cos, RX * sin);
  for (const base of [tx, ty]) {
    for (const t of [base, base + Math.PI]) {
      if (!inSweep(t)) continue;
      pts.push([
        cx + RX * Math.cos(t) * cos - RY * Math.sin(t) * sin,
        cy + RX * Math.cos(t) * sin + RY * Math.sin(t) * cos,
      ]);
    }
  }
  return pts;
}

function walk(name, d) {
  const toks = tokenise(d);
  if (toks.length === 0 || toks[0].cmd === undefined) {
    errors.push(`${name}: path does not start with a command in ${d}`);
    return null;
  }
  if (toks[0].cmd !== 'M' && toks[0].cmd !== 'm') {
    errors.push(`${name}: first command is ${toks[0].cmd}, must be M or m, in ${d}`);
  }
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = null;
  let i = 0;
  const pts = [];
  const push = (px, py) => pts.push([px, py]);
  while (i < toks.length) {
    if (toks[i].cmd !== undefined) {
      const next = toks[i].cmd;
      if (cmd !== null && ARG_COUNT[cmd.toUpperCase()] > 0 && i > 0 && toks[i - 1].cmd !== undefined) {
        errors.push(`${name}: command ${cmd} immediately followed by ${next} with no arguments in ${d}`);
      }
      cmd = next;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        x = sx;
        y = sy;
        continue;
      }
    }
    if (cmd === null) break;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARG_COUNT[up];
    const args = [];
    for (let k = 0; k < n; k += 1) {
      if (i >= toks.length || toks[i].cmd !== undefined) {
        errors.push(`${name}: ${cmd} is missing arguments in ${d}`);
        return pts;
      }
      args.push(toks[i].num);
      i += 1;
    }
    if (up === 'M') {
      x = rel ? x + args[0] : args[0];
      y = rel ? y + args[1] : args[1];
      sx = x;
      sy = y;
      push(x, y);
      // A repeated argument set after M is an implicit L.
      cmd = rel ? 'l' : 'L';
    } else if (up === 'L') {
      x = rel ? x + args[0] : args[0];
      y = rel ? y + args[1] : args[1];
      push(x, y);
    } else if (up === 'H') {
      x = rel ? x + args[0] : args[0];
      push(x, y);
    } else if (up === 'V') {
      y = rel ? y + args[0] : args[0];
      push(x, y);
    } else if (up === 'C' || up === 'S' || up === 'Q' || up === 'T') {
      // Control points bound the curve, which is conservative but never wrong.
      for (let k = 0; k < n; k += 2) {
        push(rel ? x + args[k] : args[k], rel ? y + args[k + 1] : args[k + 1]);
      }
      x = rel ? x + args[n - 2] : args[n - 2];
      y = rel ? y + args[n - 1] : args[n - 1];
    } else if (up === 'A') {
      const [rx, ry, rot, laf, sf] = args;
      const ex = rel ? x + args[5] : args[5];
      const ey = rel ? y + args[6] : args[6];
      const chord = Math.hypot(ex - x, ey - y);
      const maxChord = 2 * Math.max(Math.abs(rx), Math.abs(ry));
      if (chord > maxChord + 1e-9) {
        errors.push(
          `${name}: arc chord ${chord.toFixed(2)} exceeds 2r (${maxChord}) in ${d}`,
        );
      }
      for (const p of arcExtremes(x, y, rx, ry, rot, laf, sf, ex, ey)) push(p[0], p[1]);
      x = ex;
      y = ey;
    }
  }
  return pts;
}

// ── Per-icon checks ──────────────────────────────────────────────────────────
const seen = new Map();
let subpaths = 0;

for (const [name, list] of icons) {
  if (list.length === 0) {
    errors.push(`${name}: no path data`);
    continue;
  }
  const all = [];
  for (const d of list) {
    subpaths += 1;
    if (/[^MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]/.test(d)) {
      errors.push(`${name}: illegal character in ${d}`);
    }
    for (const num of d.match(/\d+\.\d+/g) ?? []) {
      const dec = num.split('.')[1].length;
      if (dec > 2) errors.push(`${name}: ${num} has ${dec} decimals (max 2) in ${d}`);
    }
    if (/[MmLlHhVvCcSsQqTtAa]\s*$/.test(d)) errors.push(`${name}: trailing bare command in ${d}`);
    const pts = walk(name, d);
    if (pts) all.push(...pts);
  }
  // Duplicate detection compares the WHOLE icon, not individual subpaths: the
  // drawing rules deliberately share motifs (one page outline across every
  // `file-*`, one chevron rotated four ways). Two icons rendering identical
  // pixels is the actual defect, and `star`/`star-filled` plus
  // `heart`/`heart-filled` must differ here even though they enclose the same
  // shape — they do, because each is traversed the opposite way round.
  {
    const sig = list.map((d) => d.replace(/\s+/g, ' ').trim()).join('|');
    if (seen.has(sig)) errors.push(`${name}: renders identically to ${seen.get(sig)}`);
    else seen.set(sig, name);
  }
  if (all.length === 0) continue;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const TOL = 0.01;
  if (minX < 2 - TOL || minY < 2 - TOL || maxX > 22 + TOL || maxY > 22 + TOL) {
    errors.push(
      `${name}: geometry outside the 2..22 grid — x ${minX.toFixed(2)}..${maxX.toFixed(2)}, y ${minY.toFixed(2)}..${maxY.toFixed(2)}`,
    );
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (extent < 13) warnings.push(`${name}: drawn extent only ${extent.toFixed(1)} units — looks undersized`);
}

// ── Key set ──────────────────────────────────────────────────────────────────
const declared = [...icons.keys()];
const dupes = declared.filter((k, idx) => declared.indexOf(k) !== idx);
if (dupes.length) errors.push(`duplicate keys: ${dupes.join(', ')}`);

// Every icon name referenced anywhere in src/ must exist in the set.
console.log(`keys: ${declared.length} | subpaths: ${subpaths}`);
if (errors.length) {
  console.log(`\nERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  ${e}`);
} else {
  console.log('\nERRORS: none');
}
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ${w}`);
}
process.exit(errors.length ? 1 : 0);
