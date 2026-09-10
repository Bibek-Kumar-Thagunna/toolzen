'use client';

/**
 * PNG → WebP.
 *
 * The one conversion in this group that is usually a straight win: WebP keeps
 * the alpha channel, so nothing has to be flattened, and it typically lands far
 * below the PNG it came from — a third of the size is ordinary for a
 * screenshot or a flat graphic.
 *
 * Quality defaults to 90 rather than the 85 used for JPEG. WebP's lossy mode
 * holds hard edges and text better than JPEG's at the same number, and this
 * tool's input is PNG — which means screenshots, logos and line art, where an
 * edge artefact is far more visible than it would be in a photograph. 90 is
 * still comfortably smaller than the source.
 *
 * `canvas.toBlob` on an engine with no WebP encoder quietly returns a PNG
 * instead of failing; the codec catches that mismatch and reports it as an
 * `encode_unsupported` failure rather than handing over a mislabelled file.
 */
import { ImageConvertTool } from './ImageConvertTool';
import { PNG_ONLY } from '@/lib/tools/accepts';

export function PngToWebpTool() {
  return (
    <ImageConvertTool
      slug="png-to-webp"
      accept={PNG_ONLY}
      to="webp"
      runLabel="Convert to WebP"
      archiveLabel="webp-images"
      defaultQuality={90}
      note="Transparency is kept. Every current browser displays WebP, but a few older apps and some print workflows still will not open one."
    />
  );
}
