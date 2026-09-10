'use client';

/**
 * PNG → JPG.
 *
 * The interesting control here is the background colour, and it is the reason
 * this is not simply "convert". JPEG has no alpha channel, so every transparent
 * pixel has to become an opaque one, and a converter that does not ask fills
 * them with black — which looks like a corrupted file to anyone who has not met
 * the format before. White is the default because it is right most of the time;
 * the picker is there because a logo bound for a dark page is the case where it
 * is not.
 *
 * The quality slider is the other half: this is the conversion people reach for
 * when a PNG screenshot is too heavy to email, so the size has to be
 * adjustable rather than fixed at some tasteful default.
 */
import { ImageConvertTool } from './ImageConvertTool';
import { PNG_ONLY } from '@/lib/tools/accepts';

export function PngToJpgTool() {
  return (
    <ImageConvertTool
      slug="png-to-jpg"
      accept={PNG_ONLY}
      to="jpeg"
      runLabel="Convert to JPG"
      archiveLabel="jpg-images"
      defaultQuality={85}
      note="JPEG is lossy and has no transparency: see-through areas are filled with the colour above, and the conversion cannot be undone from the result."
    />
  );
}
