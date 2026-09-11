'use client';

/**
 * WebP → PNG.
 *
 * The reason this tool exists is compatibility, not size: WebP is smaller than
 * PNG at every quality, and converting one to the other makes the file bigger —
 * often two or three times bigger for a screenshot. Nobody does this to save
 * space. They do it because something they need to use will not open a WebP:
 * an older design tool, a print workflow, a company system, an image field on a
 * form that lists three formats and WebP is not one of them.
 *
 * PNG is the right target for that job because it keeps the alpha channel, so a
 * cut-out stays a cut-out and nothing has to be flattened onto a colour.
 *
 * ── What it cannot get back ───────────────────────────────────────────────
 * Most WebP files in the wild are lossy, and the detail their encoder discarded
 * is gone. PNG stores what it is given exactly, so the result is a lossless copy
 * of a lossy image — no better than the input, just larger and more portable.
 * The note under the button says so, because a "convert to lossless" control
 * invites exactly the opposite assumption.
 */
import { ImageConvertTool } from './ImageConvertTool';
import { WEBP_ONLY } from '@/lib/tools/accepts';

export function WebpToPngTool() {
  return (
    <ImageConvertTool
      slug="webp-to-png"
      accept={WEBP_ONLY}
      to="png"
      runLabel="Convert to PNG"
      archiveLabel="png-images"
      note="Transparency is kept. Expect the PNG to be larger than the WebP — that is the cost of a format everything can open, and no detail is recovered by the conversion."
    />
  );
}
