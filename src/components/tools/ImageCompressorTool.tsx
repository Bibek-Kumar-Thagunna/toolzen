'use client';

/**
 * ============================================================================
 * IMAGE COMPRESSOR
 * ============================================================================
 * A quality slider, a format choice, and an honest before-and-after.
 *
 * ── The estimate comes from the file header, not from a decode ─────────────
 * The page promises an estimated output size beside the slider *before*
 * anything is encoded. Decoding twenty photographs to learn their dimensions
 * would cost hundreds of megabytes and several seconds, for a number that is
 * only ever a guess. `ImageBatchShell` reads the first 64 KB of each file
 * instead — every format's header states its pixel size — so the estimate is on
 * screen within milliseconds of a drop.
 *
 * ── A format this browser cannot write is disabled before it can be chosen ──
 * `canvas.toBlob(cb, 'image/webp')` on an engine with no WebP encoder does not
 * fail; it quietly hands back a PNG. `canEncodeFormat` probes with a 1×1 encode
 * after mount, so an unavailable option arrives disabled and says why, rather
 * than accepting the choice and apologising after the work.
 *
 * ── "Keep the original format" resolves per file, from the bytes ───────────
 * A browser can only write JPEG, PNG and WebP, so a GIF or a BMP cannot be kept
 * as it is; those become PNG, which is lossless and holds GIF transparency. The
 * rule is stated under the control rather than left as a surprise in the
 * downloads folder.
 *
 * ── Quality is disabled, not hidden, for PNG ──────────────────────────────
 * PNG is lossless and ignores the quality value entirely. A slider that moves
 * and changes nothing is worse than one that is visibly unavailable with a
 * sentence saying why.
 * ============================================================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { ImageBatchShell, type SniffedFile } from '@/components/tool/ImageBatchShell';
import { humanBytes } from '@/lib/files/bytes';
import type { ImagePlan, ImageBatchResult, PlanInput } from '@/lib/tools/image/batch';
import { canEncodeFormat, type EncodableFormat } from '@/lib/tools/image/codec';
import { estimateOutputBytes } from '@/lib/tools/image/dimensions';
import { mimeForFormat, outputFileName, savingsSummary } from '@/lib/tools/image/format';
import { RASTER_IMAGES } from '@/lib/tools/accepts';

const SLUG = 'image-compressor';

/** `keep` resolves per file; the other three are literal encoder targets. */
type FormatChoice = 'keep' | EncodableFormat;

const FORMAT_LABELS: Record<FormatChoice, string> = {
  keep: 'Keep the original format',
  jpeg: 'JPG — smallest for photographs',
  png: 'PNG — lossless, keeps transparency',
  webp: 'WebP — smaller than JPG at the same quality',
};

/**
 * What "keep" means for a file the browser cannot write back.
 *
 * GIF and BMP decode fine and cannot be encoded, so they become PNG: lossless,
 * and it preserves the transparency a GIF may carry. Anything already writable
 * keeps its own format.
 */
function resolveKeep(sniffedFormat: string): EncodableFormat {
  if (sniffedFormat === 'jpeg' || sniffedFormat === 'webp') return sniffedFormat;
  return 'png';
}

export function ImageCompressorTool() {
  const [format, setFormat] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState(80);

  /**
   * Which formats this engine can actually write. `null` while the probe is in
   * flight — the options are not disabled during that moment, because a control
   * that starts disabled and enables itself half a second later is worse than
   * one that briefly accepts a choice the probe then confirms.
   */
  const [encodable, setEncodable] = useState<Record<EncodableFormat, boolean> | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [jpeg, png, webp] = await Promise.all([
        canEncodeFormat('jpeg'),
        canEncodeFormat('png'),
        canEncodeFormat('webp'),
      ]);
      if (live) setEncodable({ jpeg, png, webp });
    })();
    return () => {
      live = false;
    };
  }, []);

  const lossless = format === 'png';

  const plan = useCallback(
    ({ file, image, sniffed }: PlanInput): ImagePlan => {
      const target: EncodableFormat = format === 'keep' ? resolveKeep(sniffed.format) : format;
      return {
        options: { format: target, quality: quality / 100 },
        name: outputFileName(file.name, target, { suffix: '-compressed' }),
        mime: mimeForFormat(target),
        // `image` is intentionally unused: compression keeps the source
        // dimensions, so there is nothing to compute from the decoded pixels.
        ...(image.width === 0 ? { skip: 'This image has no pixels to compress.' } : {}),
      };
    },
    [format, quality],
  );

  /**
   * The projected total, summed across the queue from the header dimensions.
   *
   * Explicitly a projection and labelled as one. Compressed size depends on
   * content — a photograph of gravel and a photograph of a clear sky end up
   * wildly different at the same quality — so the honest thing is a rough number
   * before the run and the real byte count after it.
   */
  const estimate = useCallback(
    (queue: SniffedFile[]): string | null => {
      let known = 0;
      let bytes = 0;
      for (const { file, sniffed } of queue) {
        if (!sniffed || sniffed.width === null || sniffed.height === null) continue;
        known += 1;
        const target: EncodableFormat = format === 'keep' ? resolveKeep(sniffed.format) : format;
        bytes += estimateOutputBytes(
          { width: sniffed.width, height: sniffed.height },
          target,
          quality / 100,
        );
        void file;
      }
      if (known === 0) return null;
      return `Roughly ${humanBytes(bytes)} in total, before encoding — the real figure depends on what is in the pictures.`;
    },
    [format, quality],
  );

  const controls = useCallback(
    (queue: SniffedFile[], busy: boolean) => (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Save as"
          htmlFor="compressor-format"
          hint={
            format === 'keep'
              ? 'A browser can write JPG, PNG and WebP. A GIF or BMP becomes PNG, which is lossless and keeps transparency.'
              : undefined
          }
        >
          <Select
            id="compressor-format"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value as FormatChoice)}
          >
            {(Object.keys(FORMAT_LABELS) as FormatChoice[]).map((choice) => {
              const unavailable =
                choice !== 'keep' && encodable !== null && !encodable[choice];
              return (
                <option key={choice} value={choice} disabled={unavailable}>
                  {FORMAT_LABELS[choice]}
                  {unavailable ? ' — this browser cannot write it' : ''}
                </option>
              );
            })}
          </Select>
        </Field>

        <Field
          label="Quality"
          htmlFor="compressor-quality"
          labelSuffix={<span className="tabular">{lossless ? '—' : `${quality}`}</span>}
          hint={
            lossless
              ? 'PNG is lossless, so there is no quality to set: it stores the exact pixels either way.'
              : (estimate(queue) ??
                'Below about 60 the damage starts to show. Pull it down until you can see it, then go back one step.')
          }
        >
          <Slider
            id="compressor-quality"
            min={1}
            max={100}
            step={1}
            value={quality}
            disabled={busy || lossless}
            onChange={(event) => setQuality(Number(event.target.value))}
          />
        </Field>
      </div>
    ),
    [encodable, estimate, format, lossless, quality],
  );

  const summary = useMemo(
    () => (result: ImageBatchResult) => {
      const saving = savingsSummary(result.totalBefore, result.totalAfter);
      const settings =
        format === 'keep'
          ? 'original formats'
          : (FORMAT_LABELS[format].split(' — ')[0] ?? String(format));
      return `${humanBytes(result.totalBefore)} → ${humanBytes(result.totalAfter)} · ${saving.sentence} · ${settings}${lossless ? '' : ` at quality ${quality}`}`;
    },
    [format, lossless, quality],
  );

  return (
    <ImageBatchShell
      slug={SLUG}
      label="Compress images"
      accept={RASTER_IMAGES}
      runLabel="Compress images"
      archiveLabel="compressed-images"
      controls={controls}
      plan={plan}
      title={(result) =>
        `${result.outputs.length} ${result.outputs.length === 1 ? 'image' : 'images'} compressed`
      }
      summary={summary}
      hint="Up to 20 images at a time, 30 MB each. Everything happens on your device."
      note={(_file, sniffed) =>
        sniffed && sniffed.width !== null && sniffed.height !== null
          ? `${sniffed.width} × ${sniffed.height} px`
          : null
      }
    />
  );
}
