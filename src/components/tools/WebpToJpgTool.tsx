'use client';

/**
 * WebP → JPG.
 *
 * The most-asked conversion of the four, and the one with the most footguns.
 *
 * ── Transparency has to go somewhere ──────────────────────────────────────
 * JPEG has no alpha channel. A WebP with a transparent background encoded
 * without a fill comes out with *black* where the transparency was, which
 * everyone reads as a corrupt file. The shared converter body exposes a
 * background colour for exactly this, defaulting to white.
 *
 * ── Two lossy generations ─────────────────────────────────────────────────
 * A lossy WebP has already thrown detail away, and JPEG then throws away a
 * different set of detail on top. That is unavoidable — there is no lossless
 * route between two lossy formats — but it argues for a higher quality number
 * than a first-generation encode would need, so the default is 88 rather than
 * 85. The note says it plainly rather than leaving people to discover it on a
 * photograph with a smooth sky.
 */
import { ImageConvertTool } from './ImageConvertTool';
import { WEBP_ONLY } from '@/lib/tools/accepts';

export function WebpToJpgTool() {
  return (
    <ImageConvertTool
      slug="webp-to-jpg"
      accept={WEBP_ONLY}
      to="jpeg"
      runLabel="Convert to JPG"
      archiveLabel="jpg-images"
      defaultQuality={88}
      note="JPEG cannot store transparency, so any transparent area is filled with the colour above. The image is also compressed a second time — keep the WebP if you may need it again."
    />
  );
}
