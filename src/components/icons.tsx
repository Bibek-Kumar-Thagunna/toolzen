import type { SVGProps } from 'react';

/**
 * ============================================================================
 * ICONS — the product's entire iconographic identity
 * ============================================================================
 * One hand-drawn set rather than an icon dependency. Three reasons:
 *
 *   1. Weight. A tree-shaken icon package still ships its own runtime wrapper
 *      per icon; this file is a plain object of path strings and one function.
 *   2. Consistency. Every glyph is drawn on the same 24-unit grid at the same
 *      optical weight, so the set reads as a family instead of a collection.
 *   3. Server rendering. `Icon` is a pure function component with no hooks and
 *      no `'use client'`, so icons in cards, nav and tool headers cost zero
 *      client JavaScript.
 *
 * Accessibility: an icon with no `label` is decorative and hidden from
 * assistive technology. An icon with a `label` becomes `role="img"` with an
 * `aria-label`. We deliberately do NOT use a `<title>` element — that would
 * need a unique id, which needs `useId`, which would make this a client
 * component. `role="img"` + `aria-label` is the equivalent accessible name
 * computation with none of that cost.
 *
 * Drawing rules for anyone adding a glyph:
 *   - Geometry inside 2..22 so every icon has matching optical margin.
 *   - Stroke-based. Reuse a motif from a neighbour rather than inventing one:
 *     all `file-*` icons share one page outline, the four `chevron-*` are the
 *     same chevron rotated, `sort-asc`/`sort-desc` mirror one arrow.
 *   - Coordinates to at most 2 decimals.
 * ============================================================================
 */
const paths = {
  // ── Category ──────────────────────────────────────────────────────────────
  image: [
    'M5 4h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4z',
    'M9 11a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 9 11z',
    'M3.5 16.5 8.5 12l3.5 3 2.5-2 5 5',
  ],
  'file-pdf': [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M8.75 18v-4.5h1.5a1.25 1.25 0 0 1 0 2.5h-1.5',
    'M13.25 18v-4.5h2.25',
    'M13.25 15.75h1.5',
  ],
  text: ['M4 6.5V5h16v1.5', 'M12 5v14', 'M8.5 19h7'],
  code: ['M9 8.5 5 12l4 3.5', 'M15 8.5 19 12l-4 3.5', 'M13.5 7l-3 10'],
  calculator: [
    'M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z',
    'M8.5 6.5h7v2.5h-7z',
    'M8.25 13h2.5',
    'M9.5 11.75v2.5',
    'M13.25 12.25h2.5',
    'M13.25 14h2.5',
    'M8.25 17.5h2.5',
    'M13.25 17.5h2.5',
  ],
  spark: [
    'M11 5.5c.7 4 1.6 4.8 5.5 5.5-4 .7-4.8 1.6-5.5 5.5-.7-4-1.6-4.8-5.5-5.5 4-.7 4.8-1.6 5.5-5.5z',
    'M18.5 15c.4 2.2.9 2.7 3 3-2.2.4-2.7.9-3 3-.4-2.2-.9-2.7-3-3 2.2-.4 2.7-.9 3-3z',
  ],

  // ── Actions ───────────────────────────────────────────────────────────────
  upload: [
    'M12 16V4',
    'M7.5 8.5 12 4l4.5 4.5',
    'M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15',
  ],
  download: [
    'M12 4v12',
    'M7.5 11.5 12 16l4.5-4.5',
    'M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15',
  ],
  copy: [
    'M9 8h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 9 8z',
    'M16 5.5V4.5A1.5 1.5 0 0 0 14.5 3h-9A1.5 1.5 0 0 0 4 4.5v9A1.5 1.5 0 0 0 5.5 15h1',
  ],
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  'check-circle': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12.25 11 15.25 16 8.75'],
  x: ['M5.5 5.5 18.5 18.5', 'M18.5 5.5 5.5 18.5'],
  trash: [
    'M4.5 7.5h15',
    'M9.5 7.5V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v2.5',
    'M6.5 7.5 7.4 19.6A1.5 1.5 0 0 0 8.9 21h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.1',
    'M10.5 11v6',
    'M13.5 11v6',
  ],
  refresh: ['M4.5 12a7.5 7.5 0 1 0 7.5-7.5', 'M14.5 7 12 4.5 14.5 2'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: 'M5 12h14',
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M12 3v2.5',
    'M12 18.5V21',
    'M4.2 7.5l2.2 1.25',
    'M17.6 15.25l2.2 1.25',
    'M4.2 16.5l2.2-1.25',
    'M17.6 8.75l2.2-1.25',
  ],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20.5 20.5'],
  filter: 'M3.5 5.5h17l-6.5 7.5v6l-4-2.5v-3.5z',
  shuffle: [
    'M4 7.5h3.5a4 4 0 0 1 3.4 1.9l3.2 5.2a4 4 0 0 0 3.4 1.9H20',
    'M4 16.5h3.5a4 4 0 0 0 3.4-1.9l.8-1.3',
    'M14.3 9.7l.8-1.3a4 4 0 0 1 3.4-1.9H20',
    'M17.5 5 20 7.5 17.5 10',
    'M17.5 14 20 16.5 17.5 19',
  ],
  play: 'M8.5 5.2v13.6l11-6.8z',
  pause: ['M9.5 5v14', 'M14.5 5v14'],
  sliders: [
    'M3.5 7.5h6.5',
    'M14 7.5h6.5',
    'M3.5 16.5h3.5',
    'M11 16.5h9.5',
    'M12 9.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M9 18.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  maximize: [
    'M9 4.5H6A1.5 1.5 0 0 0 4.5 6v3',
    'M15 4.5h3A1.5 1.5 0 0 1 19.5 6v3',
    'M19.5 15v3a1.5 1.5 0 0 1-1.5 1.5h-3',
    'M9 19.5H6a1.5 1.5 0 0 1-1.5-1.5v-3',
  ],
  swap: ['M4 9h13', 'M13.5 5.5 17 9l-3.5 3.5', 'M20 15H7', 'M10.5 11.5 7 15l3.5 3.5'],

  // ── Navigation ────────────────────────────────────────────────────────────
  'chevron-up': 'M5.5 15 12 8.5l6.5 6.5',
  'chevron-down': 'M5.5 9 12 15.5 18.5 9',
  'chevron-left': 'M15 5.5 8.5 12l6.5 6.5',
  'chevron-right': 'M9 5.5 15.5 12 9 18.5',
  'arrow-right': ['M4 12h15.5', 'M14 6.5 19.5 12 14 17.5'],
  'arrow-left': ['M20 12H4.5', 'M10 6.5 4.5 12l5.5 5.5'],
  'arrow-up-right': ['M6 18 18 6', 'M9.5 6H18v8.5'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  home: [
    'M3.5 10.5 12 3.5l8.5 7',
    'M5.5 9.2V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.2',
    'M9.5 20.5v-5.5h5v5.5',
  ],
  grid: ['M4.5 4.5h5.5v5.5H4.5z', 'M14 4.5h5.5v5.5H14z', 'M4.5 14h5.5v5.5H4.5z', 'M14 14h5.5v5.5H14z'],
  'external-link': [
    'M13 4.5h6.5V11',
    'M19.5 4.5 11 13',
    'M17 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4.5',
  ],
  'corner-down-left': ['M19.5 5v7.5a2 2 0 0 1-2 2H5.5', 'M9.5 10.5 5.5 14.5l4 4'],
  command: [
    'M9 9h6v6H9z',
    'M9 9H6.5A2.5 2.5 0 1 1 9 6.5V9z',
    'M15 9h2.5A2.5 2.5 0 1 0 15 6.5V9z',
    'M15 15h2.5a2.5 2.5 0 1 1-2.5 2.5V15z',
    'M9 15H6.5A2.5 2.5 0 1 0 9 17.5V15z',
  ],
  keyboard: [
    'M4 6.5h16A1.5 1.5 0 0 1 21.5 8v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5z',
    'M6 10.25h1.5',
    'M9.5 10.25h1.5',
    'M13 10.25h1.5',
    'M16.5 10.25h1.5',
    'M7.5 13.75h9',
  ],
  'more-horizontal':
    'M7 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',

  // ── Status ────────────────────────────────────────────────────────────────
  'alert-triangle': [
    'M10.3 4.2 2.9 17.1A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0z',
    'M12 9.5v4',
    'M12 16.75h.01',
  ],
  'alert-circle': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5v5', 'M12 16h.01'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5.5', 'M12 7.75h.01'],
  shield: [
    'M12 3 5 5.8v5.7c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V5.8z',
    'M9 12l2.2 2.2L15.5 10',
  ],
  lock: [
    'M6.5 10.5h11A1.5 1.5 0 0 1 19 12v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5z',
    'M8 10.5V8a4 4 0 0 1 8 0v2.5',
    'M12 14.5v2.5',
  ],
  eye: [
    'M2.5 12c2.5-4.3 5.7-6.5 9.5-6.5s7 2.2 9.5 6.5c-2.5 4.3-5.7 6.5-9.5 6.5S5 16.3 2.5 12z',
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
  ],
  'eye-off': [
    'M4 4 20 20',
    'M9.9 5.8A9.6 9.6 0 0 1 12 5.5c3.8 0 7 2.2 9.5 6.5a17.6 17.6 0 0 1-2.9 3.8',
    'M6.4 8.2A17.4 17.4 0 0 0 2.5 12c2.5 4.3 5.7 6.5 9.5 6.5 1.5 0 2.9-.3 4.1-.9',
    'M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8',
  ],
  loader: 'M12 4.5a7.5 7.5 0 1 1-5.3 2.2',
  zap: 'M13.5 3 5.5 13.5h5L10.5 21l8-10.5h-5z',

  // ── Theme ─────────────────────────────────────────────────────────────────
  sun: [
    'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z',
    'M12 2.5v2',
    'M12 19.5v2',
    'M2.5 12h2',
    'M19.5 12h2',
    'M5.3 5.3l1.4 1.4',
    'M17.3 17.3l1.4 1.4',
    'M18.7 5.3l-1.4 1.4',
    'M6.7 17.3l-1.4 1.4',
  ],
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  monitor: [
    'M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5z',
    'M9 20h6',
    'M12 16.5V20',
  ],

  // ── Saved state ───────────────────────────────────────────────────────────
  star: 'M12 3.5 14.6 9l6 .9-4.3 4.3 1 6-5.3-2.9-5.3 2.9 1-6L3.4 9.9l6-.9z',
  // Same geometry as `star`, traversed the other way round — the filled variant
  // must not share a path string with the outline one.
  'star-filled': 'M12 3.5 9.4 9l-6 .9 4.3 4.3-1 6 5.3-2.9 5.3 2.9-1-6L20.6 9.9l-6-.9z',
  heart: 'M12 20.3 4.9 13.2A4.8 4.8 0 0 1 12 6.8a4.8 4.8 0 0 1 7.1 6.4z',
  'heart-filled': 'M12 20.3 19.1 13.2A4.8 4.8 0 0 0 12 6.8 4.8 4.8 0 0 0 4.9 13.2z',
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3.5 2.5'],

  // ── Files (one shared page outline + fold) ─────────────────────────────────
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  files: [
    'M16 7h-5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8z',
    'M16 7v4h4',
    'M15 4.5A2 2 0 0 0 13 3H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h.5',
  ],
  folder:
    'M4 8V6a2 2 0 0 1 2-2h3.2a2 2 0 0 1 1.6.8L12 6.5h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  'file-text': [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M8.5 13h7',
    'M8.5 17h4.5',
  ],
  'file-image': [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M9.5 14.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
    'M7 18.5 10.5 15l2.5 2 2-1.5 3 3',
  ],

  // ── Tool-specific ─────────────────────────────────────────────────────────
  compress: ['M12 3v6', 'M9 6 12 9l3-3', 'M12 21v-6', 'M9 18l3-3 3 3', 'M4 12h16'],
  crop: ['M6.5 3v12.5a2 2 0 0 0 2 2H21', 'M3 6.5h12.5a2 2 0 0 1 2 2V21'],
  rotate: ['M19.5 12a7.5 7.5 0 1 1-7.5-7.5', 'M9.5 2 12 4.5 9.5 7'],
  scissors: [
    'M8 8.5 19 19.5',
    'M8 15.5 19 4.5',
    'M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ],
  merge: [
    'M4 5h3.5a3 3 0 0 1 2.6 1.5l2.4 4A3 3 0 0 0 15.1 12H20',
    'M4 19h3.5a3 3 0 0 0 2.6-1.5l2.4-4A3 3 0 0 1 15.1 12',
    'M17 9l3 3-3 3',
  ],
  split: [
    'M20 5h-3.5a3 3 0 0 0-2.6 1.5l-2.4 4A3 3 0 0 1 8.9 12H4',
    'M20 19h-3.5a3 3 0 0 1-2.6-1.5l-2.4-4A3 3 0 0 0 8.9 12',
    'M7 9l-3 3 3 3',
  ],
  // Two half-capsules plus a connecting bar. Each arc is a true semicircle
  // (chord 9 == 2r), so the radius is never silently scaled up by the renderer.
  link: ['M10 7.5H7.5a4.5 4.5 0 0 0 0 9H10', 'M14 7.5h2.5a4.5 4.5 0 0 1 0 9H14', 'M8.5 12h7'],
  braces: [
    'M9.5 3.5h-1a2 2 0 0 0-2 2v4.5a2 2 0 0 1-2 2 2 2 0 0 1 2 2V18.5a2 2 0 0 0 2 2h1',
    'M14.5 3.5h1a2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2 2 2 0 0 0-2 2V18.5a2 2 0 0 1-2 2h-1',
  ],
  binary: [
    'M5.5 4.5h1.5v6',
    'M4.5 10.5h4',
    'M16 4h1a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 17 10.5h-1a1.5 1.5 0 0 1-1.5-1.5V5.5A1.5 1.5 0 0 1 16 4z',
    'M6.5 13.5h1a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 7.5 20h-1A1.5 1.5 0 0 1 5 18.5V15a1.5 1.5 0 0 1 1.5-1.5z',
    'M16 14h1.5v6',
    'M15 20h4',
  ],
  hash: ['M9 3.5 7 20.5', 'M17 3.5 15 20.5', 'M4.5 9h15', 'M3.5 15h15'],
  key: [
    'M15.5 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
    'M11.6 12.9 3.5 21',
    'M6.5 18l2 2',
    'M9 15.5l2 2',
  ],
  qr: [
    'M4 4h6v6H4z',
    'M6.25 6.25h1.5v1.5h-1.5z',
    'M14 4h6v6h-6z',
    'M16.25 6.25h1.5v1.5h-1.5z',
    'M4 14h6v6H4z',
    'M6.25 16.25h1.5v1.5h-1.5z',
    'M12 4v2',
    'M12 8v2',
    'M4 12h2',
    'M8 12h2',
    'M14 14h2v2h-2z',
    'M18 14h2v2h-2z',
    'M16 16h2v2h-2z',
    'M14 18h2v2h-2z',
    'M18 18h2v2h-2z',
  ],
  palette: [
    'M12 3.5a8.5 8.5 0 0 0 0 17c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z',
    'M7.5 11a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
    'M12 9a1.25 1.25 0 1 0 0-2.5A1.25 1.25 0 0 0 12 9z',
    'M16.25 11a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
    'M7.5 16a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
  ],
  droplet: 'M12 3.5 6.9 8.6a7.2 7.2 0 1 0 10.2 0z',
  pipette: [
    'M14.5 7.5 4.8 17.2A2.5 2.5 0 0 0 4 19v1h1a2.5 2.5 0 0 0 1.8-.8L16.5 9.5z',
    'M12.5 5.5 18.5 11.5',
    'M17 3.4a2.5 2.5 0 0 1 3.4 3.4l-1.9 1.9-3.4-3.4z',
  ],
  wand: [
    'M4 20 13.5 10.5',
    'M12 9 15 12',
    'M18 4.5c.35 1.9.75 2.3 2.65 2.65-1.9.35-2.3.75-2.65 2.65-.35-1.9-.75-2.3-2.65-2.65 1.9-.35 2.3-.75 2.65-2.65z',
    'M9 4v3',
    'M7.5 5.5h3',
  ],
  type: [
    'M3.5 19.5 8.75 5.5 14 19.5',
    'M5.7 15h6.1',
    'M20.5 12.75v6.75',
    'M20.5 16.25a3 3 0 1 0-3 3 3 3 0 0 0 3-3z',
  ],
  list: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  'sort-asc': ['M4 7h5', 'M4 12h8', 'M4 17h11', 'M18.5 17V7', 'M16 9.5 18.5 7l2.5 2.5'],
  'sort-desc': ['M4 7h11', 'M4 12h8', 'M4 17h5', 'M18.5 7v10', 'M16 14.5 18.5 17l2.5-2.5'],
  percent: [
    'M18.5 5.5 5.5 18.5',
    'M7.75 10.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z',
    'M16.25 19a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z',
  ],
  ruler: [
    'M3.5 14.5 9.5 20.5a1.5 1.5 0 0 0 2.1 0l8.9-8.9a1.5 1.5 0 0 0 0-2.1L14.5 3.5a1.5 1.5 0 0 0-2.1 0L3.5 12.4a1.5 1.5 0 0 0 0 2.1z',
    'M8 8.5 10.5 11',
    'M11 5.5 13.5 8',
    'M5.5 11.5 8 14',
  ],
  scale: [
    'M12 5.5v14',
    'M8 19.5h8',
    'M4.5 8.5h15',
    'M4.5 8.5 2 14.5h5z',
    'M19.5 8.5 17 14.5h5z',
    'M12 5.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z',
  ],
  calendar: [
    'M4.5 6.5h15A1.5 1.5 0 0 1 21 8v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19V8a1.5 1.5 0 0 1 1.5-1.5z',
    'M3 11h18',
    'M8 3.5v4',
    'M16 3.5v4',
  ],
  globe: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M3 12h18',
    'M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9s1.4-6.6 3.9-9z',
  ],
  dice: [
    'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M8.5 8.5h.01',
    'M15.5 8.5h.01',
    'M12 12h.01',
    'M8.5 15.5h.01',
    'M15.5 15.5h.01',
  ],
  table: [
    'M4.5 4.5h15A1.5 1.5 0 0 1 21 6v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5z',
    'M3 9.5h18',
    'M3 14.5h18',
    'M9.5 4.5v15',
  ],
} as const satisfies Record<string, string | readonly string[]>;

/**
 * Glyphs drawn as a solid shape rather than a stroke. Everything else is a
 * 1.75-unit stroke, which is what keeps the set at one optical weight.
 */
const filled: ReadonlySet<string> = new Set(['star-filled', 'heart-filled', 'more-horizontal']);

export type IconName = keyof typeof paths;

/** Every icon name, in declaration order. Used by the icon audit test. */
export const iconNames = Object.keys(paths) as IconName[];

export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(paths, value);
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Rendered size in px, applied to both axes. Default 20. */
  size?: number;
  /**
   * Accessible name. Omit it when the icon sits next to text that already says
   * the same thing — a decorative icon is hidden from screen readers, which is
   * correct and quieter than a duplicate announcement.
   */
  label?: string;
}

export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  const d = paths[name];
  const isFilled = filled.has(name);
  const shapes = typeof d === 'string' ? [d] : d;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={isFilled ? undefined : 1.75}
      strokeLinecap={isFilled ? undefined : 'round'}
      strokeLinejoin={isFilled ? undefined : 'round'}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={label ? undefined : 'false'}
      {...rest}
    >
      {shapes.map((shape) => (
        <path key={shape} d={shape} />
      ))}
    </svg>
  );
}

