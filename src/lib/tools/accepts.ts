/**
 * ============================================================================
 * WHAT EACH TOOL ACCEPTS
 * ============================================================================
 * One `AcceptSpec` per distinct file policy, named and shared.
 *
 * ── Why these are not written inline in the registry ───────────────────────
 * Two places need the same numbers: the registry, which is read on the server to
 * describe the tool, and the client component, which sizes and labels its own
 * dropzone. Inlining them meant a limit could be raised in the copy and not in
 * the control that enforces it — the sort of drift a reader cannot see and a user
 * discovers by having a file refused after being told it would fit.
 *
 * ── Why the client imports this module rather than the registry ────────────
 * `@/lib/registry` carries every tool's features, FAQ and long-form copy. A
 * client component that imported it to read four numbers would ship all of that
 * prose into the browser (§9). This module is a few hundred bytes and holds
 * nothing but policy.
 *
 * ── Why both MIME types and extensions are listed ──────────────────────────
 * The `accept` attribute matches on either, and neither alone is enough: on
 * Linux `File.type` is frequently `''`, and a camera export can arrive with no
 * extension. See the header of `src/lib/files/accept.ts` — this is a courtesy
 * filter, and the engines sniff the real bytes regardless.
 */

import type { AcceptSpec } from '../registry/types.ts';

const MB = 1024 * 1024;

/**
 * Every raster format `codec.ts` can decode through the browser's own image
 * pipeline. GIF and BMP decode but are never written back out.
 */
export const RASTER_IMAGES: AcceptSpec = {
  mime: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.bmp',
  ],
  label: 'JPG, PNG, WebP, GIF or BMP',
  maxBytes: 30 * MB,
  maxFiles: 20,
};

/**
 * The same formats, for the one tool that builds a document out of them. Fifty
 * pages is a realistic photo-album-to-PDF job; the per-file ceiling stays put
 * because the memory cost is per decode, not per document.
 */
export const RASTER_IMAGES_MANY: AcceptSpec = {
  ...RASTER_IMAGES,
  maxFiles: 50,
};

/** `.jpe` and `.jfif` are rare but real, and refusing them would be arbitrary. */
export const JPG_ONLY: AcceptSpec = {
  mime: ['image/jpeg', 'image/jpg', '.jpg', '.jpeg', '.jpe', '.jfif'],
  label: 'JPG or JPEG',
  maxBytes: 30 * MB,
  maxFiles: 20,
};

export const PNG_ONLY: AcceptSpec = {
  mime: ['image/png', '.png'],
  label: 'PNG',
  maxBytes: 30 * MB,
  maxFiles: 20,
};

/** Merging: many documents in, one out. */
export const PDF_MANY: AcceptSpec = {
  mime: ['application/pdf', '.pdf'],
  label: 'PDF',
  maxBytes: 50 * MB,
  maxFiles: 20,
};

/** Splitting: one document in, many out. */
export const PDF_ONE: AcceptSpec = {
  ...PDF_MANY,
  maxFiles: 1,
};

/**
 * For the text tools that let a file be dropped on the input box. The ceiling is
 * deliberately far below the image limits: this content ends up inside a
 * `<textarea>`, and a browser asked to lay out four megabytes of text in one is
 * already at the edge of feeling instant.
 */
export const TEXT_DOCUMENT: AcceptSpec = {
  mime: ['application/json', 'text/plain', '.json', '.txt'],
  label: 'JSON and plain text files',
  maxBytes: 4 * MB,
  maxFiles: 1,
};

/** Anything at all: Base64 encodes bytes, and every byte sequence is valid. */
export const ANY_FILE: AcceptSpec = {
  mime: ['*/*'],
  label: 'any file',
  maxBytes: 8 * MB,
  maxFiles: 1,
};
