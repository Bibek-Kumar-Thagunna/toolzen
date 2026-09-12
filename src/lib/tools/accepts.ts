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

/** One picture in, a set of files out. */
export const RASTER_IMAGE_ONE: AcceptSpec = {
  ...RASTER_IMAGES,
  maxFiles: 1,
};

export const WEBP_ONLY: AcceptSpec = {
  mime: ['image/webp', '.webp'],
  label: 'WebP',
  maxBytes: 30 * MB,
  maxFiles: 20,
};

/**
 * Merging: many documents in, one out.
 *
 * 100 MB each is not a limit of the format or of the browser — it is the point
 * where holding twenty of them in one tab stops being reasonable. Merging has
 * to have every document open at once, so the ceiling here is per-file *and*
 * effectively collective.
 */
export const PDF_MANY: AcceptSpec = {
  mime: ['application/pdf', '.pdf'],
  label: 'PDF',
  maxBytes: 100 * MB,
  maxFiles: 20,
};

/**
 * One document in.
 *
 * Deliberately far higher than the multi-file limit, because only one file is
 * ever in memory: the scans people actually want to compress — a hundred pages
 * photographed at 600 DPI — routinely run past 200 MB, and refusing them is
 * refusing the exact job the tool exists for.
 *
 * This is our number, not a browser limit. The real constraint is device
 * memory, and it varies by an order of magnitude between a phone and a laptop,
 * so the honest thing is a generous cap plus a warning on the way in rather
 * than a low cap that turns away work that would have succeeded.
 */
export const PDF_ONE: AcceptSpec = {
  ...PDF_MANY,
  maxBytes: 300 * MB,
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

/**
 * Anything at all, in quantity: the locking tool takes whatever a person wants
 * to protect, and refusing a file type would be arbitrary — the bytes are never
 * decoded, only encrypted.
 *
 * The ceilings are about what a browser tab can hold rather than about policy.
 * Encryption needs the file in memory and the output alongside it, so the
 * working set is roughly twice the input; 100 MB each and twenty files is
 * comfortably inside what a mid-range phone survives, and the tool refuses a
 * .tzlock past 200 MB in total with an explanation rather than a crash.
 */
export const ANY_FILES_MANY: AcceptSpec = {
  mime: ['*/*'],
  label: 'any files',
  maxBytes: 100 * MB,
  maxFiles: 20,
};

/**
 * One locked file to open. `.tzlock` is ours; `.zip` covers the archives other
 * programs produce, which this tool reads too.
 *
 * The ceiling is higher than the locking side's because opening is the cheaper
 * direction — one file in, and entries come out one at a time rather than all
 * being held at once.
 */
export const LOCKED_FILE_ONE: AcceptSpec = {
  mime: ['application/zip', 'application/octet-stream', '.zip', '.tzlock'],
  label: 'a .tzlock or password-protected .zip',
  maxBytes: 300 * MB,
  maxFiles: 1,
};
