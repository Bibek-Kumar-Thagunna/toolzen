'use client';

/**
 * JPG → PNG.
 *
 * The body is `ImageConvertTool`; this file is the direction and the one
 * sentence of honesty that belongs to it.
 *
 * PNG is lossless, so the output stores exactly the pixels the JPEG decoded to
 * — including its compression artefacts, which are now preserved perfectly and
 * forever. That is worth saying out loud, because "convert to lossless" reads
 * to a lot of people as "restore quality", and it is the opposite: the detail
 * JPEG discarded when the photo was first saved is gone, and no format can
 * bring it back. The legitimate reasons to do this — an editor or an upload
 * form that insists on PNG, or a base layer that will be edited repeatedly
 * without accumulating further loss — are real, and the tool exists for them.
 *
 * There is no quality control here because PNG has none.
 */
import { ImageConvertTool } from './ImageConvertTool';
import { JPG_ONLY } from '@/lib/tools/accepts';

export function JpgToPngTool() {
  return (
    <ImageConvertTool
      slug="jpg-to-png"
      accept={JPG_ONLY}
      to="png"
      runLabel="Convert to PNG"
      archiveLabel="png-images"
      note="PNG is lossless, so expect the file to get larger — often several times. Detail the JPEG already discarded cannot be recovered by converting."
    />
  );
}
