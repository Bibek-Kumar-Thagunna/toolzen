/**
 * ============================================================================
 * RENDERING PDF PAGES TO PIXELS
 * ============================================================================
 * The half of the PDF work that `writer.ts` does not do. That module builds new
 * documents; this one opens documents somebody else produced and draws them.
 *
 * Two tools sit on it — "PDF to JPG" and the rasterising half of "Compress
 * PDF" — and both need exactly the same sequence: load, walk the pages, render
 * each at a chosen scale, hand back bytes. Written twice, that is two places to
 * get the worker version wrong and two places to forget to free a canvas.
 *
 * ── The worker version has to match, exactly ──────────────────────────────
 * pdf.js runs its parser in a Web Worker, and the worker script must be the
 * same release as the `pdfjs-dist` build that loads it. A mismatch throws
 * "The API version does not match the Worker version", and the nasty part is
 * *when*: a CDN-pinned worker works until pdfjs is upgraded, then breaks for
 * everyone at once.
 *
 * So the worker is a local file, copied at install time by
 * `scripts/copy-pdf-worker.mjs` with the version in its name, and the version
 * is read from the library itself at runtime. The two cannot drift, and no
 * third-party host is involved — which also keeps the promise that nothing
 * about a document leaves the device.
 *
 * ── Why the library is imported inside the function ───────────────────────
 * `pdfjs-dist` is around half a megabyte. Someone who lands on the PDF-to-JPG
 * page from a search and reads the article without converting anything should
 * never pay for it, so it loads on the first run rather than at module scope.
 *
 * ── Scale, not DPI ────────────────────────────────────────────────────────
 * A PDF page is measured in points (1/72 inch). `scale` multiplies that, so
 * scale 1 is 72 DPI and the DPI a user asks for is `dpi / 72`. Doing the
 * conversion in one place stops the two units being mixed up at a call site,
 * which produces output either 72× too big or 72× too small.
 * ============================================================================
 */
import type { FailureReason } from '../../analytics.ts';

/** One rendered page. `bytes` is an encoded image, not raw pixels. */
export interface RenderedPage {
  /** 1-based, matching what the user sees. */
  pageNumber: number;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface RenderFailure {
  ok: false;
  error: string;
  reason: FailureReason;
}

export type RenderResult = { ok: true; pages: RenderedPage[] } | RenderFailure;

/** Structural subset of `RunContext`; see the note in `batch.ts`. */
export interface RenderContext {
  signal: AbortSignal;
  report: (done: number, total: number) => void;
  checkpoint: () => Promise<void>;
}

export interface RenderOptions {
  /** Output encoding. PNG for exactness, JPEG for size. */
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  /** 0–1. Ignored for PNG. */
  quality?: number;
  /** Dots per inch. 150 is the usual floor for something that will be read. */
  dpi: number;
  /** 1-based page numbers. Omit for every page. */
  pages?: readonly number[];
  /**
   * Painted before the page is drawn. PDF pages are transparent where nothing
   * is printed, and a transparent page flattened to JPEG comes out black —
   * which looks like a corrupt scan rather than a blank margin.
   */
  background?: string;
}

/**
 * The largest canvas we will ask a browser for, in pixels.
 *
 * A2 at 600 DPI is roughly 100 megapixels, and mobile Safari hands back a blank
 * canvas rather than an error well below that. The scale is reduced to fit and
 * the caller is told, which is better than a page of white.
 */
const MAX_PIXELS = 40_000_000;

export async function renderPdfPages(
  file: Blob,
  opts: RenderOptions,
  ctx: RenderContext,
): Promise<RenderResult> {
  if (typeof document === 'undefined') {
    return {
      ok: false,
      error: 'This tool needs to run in a browser tab. Reload the page and try again.',
      reason: 'unknown',
    };
  }

  const pdfjs = await import('pdfjs-dist');
  // Set every time rather than guarded: it is idempotent, and a guard would be
  // one more thing to get wrong across two tools.
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf/pdf.worker.${pdfjs.version}.min.mjs`;

  let document_;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    document_ = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/password/i.test(message)) {
      return {
        ok: false,
        error:
          'This PDF is password-protected, so its pages cannot be opened. Save an unprotected copy from your PDF reader and use that instead.',
        reason: 'password_protected',
      };
    }
    return {
      ok: false,
      error: 'That file could not be opened as a PDF. It may be damaged, or not a PDF at all.',
      reason: 'corrupt_input',
    };
  }

  const total = document_.numPages;
  const wanted = opts.pages ?? Array.from({ length: total }, (_, i) => i + 1);
  const rendered: RenderedPage[] = [];

  try {
    for (let index = 0; index < wanted.length; index += 1) {
      await ctx.checkpoint();
      const pageNumber = wanted[index];
      if (pageNumber === undefined || pageNumber < 1 || pageNumber > total) continue;

      const page = await document_.getPage(pageNumber);
      // Points to pixels. See the header: one conversion, one place.
      let scale = opts.dpi / 72;
      const base = page.getViewport({ scale: 1 });
      const projected = base.width * scale * (base.height * scale);
      if (projected > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / projected);

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (context === null) {
        page.cleanup();
        return {
          ok: false,
          error: 'The browser ran out of room while drawing this document. Try a lower DPI.',
          reason: 'out_of_memory',
        };
      }

      // See `background` in the options: without this, an unprinted margin
      // becomes black the moment the page is flattened to JPEG.
      context.fillStyle = opts.background ?? '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), opts.format, opts.quality);
      });

      // Read the size *before* the canvas is released, not after: zeroing the
      // dimensions is what frees the pixels, and it also zeroes the numbers.
      const pixelWidth = canvas.width;
      const pixelHeight = canvas.height;

      // Free the pixels before the next page allocates its own. A twenty-page
      // document at 300 DPI is otherwise twenty full-size canvases alive at
      // once, which is where a phone gives up.
      canvas.width = 0;
      canvas.height = 0;

      if (blob === null) {
        return {
          ok: false,
          error: 'The browser could not save one of the pages as an image. Try a lower DPI.',
          reason: 'unknown',
        };
      }

      rendered.push({
        pageNumber,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type || opts.format,
        width: pixelWidth,
        height: pixelHeight,
      });

      ctx.report(index + 1, wanted.length);
    }
  } finally {
    await document_.destroy();
  }

  if (rendered.length === 0) {
    return { ok: false, error: 'No pages were rendered.', reason: 'invalid_input' };
  }

  return { ok: true, pages: rendered };
}

/** Page count and whether the document is encrypted, without rendering anything. */
export async function readPdfInfo(
  file: Blob,
): Promise<{ ok: true; pageCount: number } | RenderFailure> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf/pdf.worker.${pdfjs.version}.min.mjs`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const pageCount = doc.numPages;
    await doc.destroy();
    return { ok: true, pageCount };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return /password/i.test(message)
      ? {
          ok: false,
          error: 'This PDF is password-protected, so its pages cannot be read.',
          reason: 'password_protected',
        }
      : {
          ok: false,
          error: 'That file could not be opened as a PDF.',
          reason: 'corrupt_input',
        };
  }
}
