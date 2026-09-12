'use client';

/**
 * ============================================================================
 * THE SINGLE-FORMAT VARIANTS
 * ============================================================================
 * Five pages that are each one of the general tools, narrowed to one format.
 *
 * ── Why these exist, and why they are not doorway pages ───────────────────
 * "jpg to pdf", "png to pdf", "pdf to png", "compress jpeg" and "compress png"
 * are searched far more than the general phrases they sit under, and answering
 * them from a page about images in general is answering a narrower question
 * with a broader tool.
 *
 * Google's word for a page built to catch a query and then hand the visitor
 * the same undifferentiated thing is "doorway", and it is penalised. The test
 * that keeps these on the right side of it is simple and was applied before a
 * word of copy was written: **each variant behaves differently from its
 * parent.** The dropzone accepts one format and rejects the rest. The
 * compressors open on the control that actually helps their format and hide
 * the one that does not. `pdf-to-png` opens on PNG.
 *
 * That is a real product difference — a person converting a folder of scans
 * genuinely wants the stray screenshot refused rather than silently included —
 * and the copy on each page is about that format's own problems: verbatim
 * JPEG embedding, what happens to PNG transparency, why a PNG cannot be
 * compressed with a quality slider at all.
 *
 * If a future variant cannot be given a real behavioural difference, it should
 * not be built. A synonym is not a page.
 * ============================================================================
 */
import { ImageCompressorTool } from './ImageCompressorTool';
import { ImageToPdfTool } from './ImageToPdfTool';
import { PdfToJpgTool } from './PdfToJpgTool';
import { JPG_ONLY, JPG_ONLY_MANY, PNG_ONLY, PNG_ONLY_MANY } from '@/lib/tools/accepts';

/** JPEGs go into a PDF byte-for-byte, so this page accepts only those. */
export function JpgToPdfTool() {
  return <ImageToPdfTool slug="jpg-to-pdf" accept={JPG_ONLY_MANY} />;
}

/** PNGs are deflated with a soft mask for transparency — a different path. */
export function PngToPdfTool() {
  return <ImageToPdfTool slug="png-to-pdf" accept={PNG_ONLY_MANY} />;
}

/** Same renderer, opened on the lossless format the visitor asked for. */
export function PdfToPngTool() {
  return <PdfToJpgTool slug="pdf-to-png" defaultFormat="image/png" />;
}

/**
 * JPEG compression is the quality slider, and nothing else, so the format
 * chooser is gone and every file goes out as a JPEG.
 */
export function CompressJpegTool() {
  return (
    <ImageCompressorTool
      slug="compress-jpeg"
      accept={JPG_ONLY}
      lockFormat="jpeg"
      hint="Up to 20 JPGs at a time, 30 MB each. Everything happens on your device."
    />
  );
}

/**
 * PNG is lossless, so the quality slider does nothing for it and the colour
 * reduction control is the whole tool. Locking the format is what lets the
 * page say that plainly instead of offering a slider that will not help.
 */
export function CompressPngTool() {
  return (
    <ImageCompressorTool
      slug="compress-png"
      accept={PNG_ONLY}
      lockFormat="png"
      hint="Up to 20 PNGs at a time, 30 MB each. Everything happens on your device."
    />
  );
}
