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
import { Switch } from '@/components/ui/Switch';
import { ImageBatchShell, type SniffedFile } from '@/components/tool/ImageBatchShell';
import { humanBytes } from '@/lib/files/bytes';
import type {
  ImageBatchResult,
  ImageCandidate,
  ImagePlan,
  PlanInput,
} from '@/lib/tools/image/batch';
import { canEncodeFormat, type EncodableFormat } from '@/lib/tools/image/codec';
import { estimateOutputBytes } from '@/lib/tools/image/dimensions';
import { mimeForFormat, outputFileName, savingsSummary } from '@/lib/tools/image/format';
import { indexedPngEncoder } from '@/lib/tools/image/png';
import type { AcceptSpec } from '@/lib/registry/types';
import { RASTER_IMAGES } from '@/lib/tools/accepts';

const SLUG = 'image-compressor';

/**
 * The format-specific variants.
 *
 * "compress jpeg" and "compress png" are not the same job, and giving them one
 * page was hiding that. A JPEG shrinks by re-encoding at a lower quality and
 * the slider is the whole interface. A PNG cannot be compressed that way at
 * all — it is lossless, and the only real lever is reducing the number of
 * colours so it can be stored as an indexed image, which is a different
 * control answering a different question.
 *
 * So each variant accepts only its own format and opens on the setting that
 * actually helps it. Locking the format is a real narrowing, not a label: it
 * is what lets the page stop asking "which format do you want out?" when the
 * answer is already in the question the visitor typed.
 */
export interface ImageCompressorProps {
  slug?: string;
  accept?: AcceptSpec;
  /** Fixes the output format and hides the chooser. */
  lockFormat?: EncodableFormat;
  hint?: string;
}

/**
 * `smallest` tries the sensible formats and keeps whichever wins; `keep`
 * resolves per file from the header; the other three are literal targets.
 */
type FormatChoice = 'smallest' | 'keep' | EncodableFormat;

const FORMAT_LABELS: Record<FormatChoice, string> = {
  smallest: 'Smallest file — pick the best format for me',
  keep: 'Keep the original format',
  jpeg: 'JPG — for photographs',
  png: 'PNG — lossless, keeps transparency',
  webp: 'WebP — usually the smallest',
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

export function ImageCompressorTool({
  slug = SLUG,
  accept = RASTER_IMAGES,
  lockFormat,
  hint = 'Up to 20 images at a time, 30 MB each. Everything happens on your device.',
}: ImageCompressorProps = {}) {
  const [format, setFormat] = useState<FormatChoice>(lockFormat ?? 'smallest');
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

  /*
   * Colour reduction — the only thing that actually shrinks a PNG.
   *
   * A canvas can only rewrite a PNG's pixels losslessly, and a PNG that came out
   * of any competent encoder has no lossless saving left; that is why re-encoding
   * one routinely produces a *larger* file. The real saving is a palette: 256
   * colours and one index per pixel instead of four bytes per pixel, which is
   * what `indexedPngEncoder` writes and what the well-known PNG services do.
   *
   * On by default because this tool is called "compress" and the person pressing
   * the button asked for a smaller file. It is lossy, so it is a visible switch
   * with the trade-off written next to it, and it only ever *competes* — the
   * batch runner keeps whichever candidate is genuinely smallest.
   */
  const [reduceColors, setReduceColors] = useState(true);
  const [colors, setColors] = useState(128);

  const lossless = format === 'png';

  /**
   * Can a PNG actually come out of this run, given what is in the queue?
   *
   * `keep` and `smallest` both encode into each file's *own* format, so PNG is
   * only on the table when something queued is one — or is a GIF or BMP, which
   * `resolveKeep` turns into PNG. Asking only about the dropdown showed the
   * colour-reduction switch above a queue of JPEGs, where it changes nothing
   * at all: a control that is visibly on and provably inert, which is worse
   * than not offering it.
   */
  const pngPossible = useCallback(
    (queue: SniffedFile[]): boolean => {
      if (format === 'png') return true;
      if (format !== 'keep' && format !== 'smallest') return false;
      return queue.some(
        (entry) => entry.sniffed !== null && resolveKeep(entry.sniffed.format) === 'png',
      );
    },
    [format],
  );

  const plan = useCallback(
    ({ file, image, sniffed }: PlanInput): ImagePlan => {
      if (image.width === 0) return { skip: 'This image has no pixels to compress.' };

      const candidate = (target: EncodableFormat) => ({
        options: { format: target, quality: quality / 100 },
        name: outputFileName(file.name, target, { suffix: '-compressed' }),
        mime: mimeForFormat(target),
        format: target,
      });

      /*
       * In `smallest` mode the file's own format is tried alongside WebP, and
       * the winner is whichever is actually smaller.
       *
       * WebP is in the list for every input because it wins so often: a flat UI
       * screenshot re-encoded as PNG by a browser is routinely *larger* than the
       * optimised PNG it came from, while the same image as WebP is a fraction
       * of the size. Photographs it beats by roughly a third against JPEG. The
       * cost of being wrong is one extra encode.
       *
       * Transparency is why the source format is still tried: JPEG cannot carry
       * an alpha channel, so a transparent PNG must keep a candidate that can.
       */
      const own = resolveKeep(sniffed.format);
      const targets: EncodableFormat[] =
        format === 'smallest'
          ? own === 'webp'
            ? ['webp']
            : [own, 'webp']
          : [format === 'keep' ? own : format];

      const candidates: ImageCandidate[] = targets.map(candidate);

      // The indexed-PNG candidate, added whenever PNG is a possible output and
      // colour reduction is on. It is one more thing to try, not a replacement:
      // on a screenshot it wins by a wide margin, on a photograph WebP beats it
      // and it is discarded.
      if (reduceColors && targets.includes('png')) {
        candidates.push({
          // `options` is unused by a candidate that brings its own encoder; it
          // is filled in so the candidate is still describable in one shape.
          options: { format: 'png' as const, quality: 1 },
          name: outputFileName(file.name, 'png', { suffix: '-compressed' }),
          mime: mimeForFormat('png'),
          format: 'png',
          encode: indexedPngEncoder({
            colors,
            // Dither photographic material, where flat quantization bands are
            // obvious; leave flat graphics alone, where it would only add noise.
            dither: sniffed.format === 'jpeg',
          }),
        });
      }

      return {
        candidates,
        // The whole promise of the tool. See `runImageBatch`.
        neverInflate: true,
      };
    },
    [colors, format, quality, reduceColors],
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
        // `smallest` will most often land on WebP, so that is what the
        // projection assumes. It is labelled as an estimate either way.
        const target: EncodableFormat =
          format === 'smallest' ? 'webp' : format === 'keep' ? resolveKeep(sniffed.format) : format;
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
        {/* Hidden when the page is already the answer: a tool called "Compress
            PNG" asking which format you want out is asking a question the
            visitor answered before they arrived. */}
        {lockFormat ? null : (
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
                choice !== 'keep' &&
                choice !== 'smallest' &&
                encodable !== null &&
                !encodable[choice];
              return (
                <option key={choice} value={choice} disabled={unavailable}>
                  {FORMAT_LABELS[choice]}
                  {unavailable ? ' — this browser cannot write it' : ''}
                </option>
              );
            })}
          </Select>
        </Field>
        )}

        {/* Gone entirely on a page locked to a lossless format. A disabled
            slider explaining that it does nothing is still a slider, and this
            page's whole argument is that the quality control is not the one
            that compresses a PNG. */}
        {lockFormat === 'png' ? null : (
        <Field
          label="Quality"
          htmlFor="compressor-quality"
          labelSuffix={<span className="tabular">{lossless ? '—' : `${quality}`}</span>}
          hint={
            lossless
              ? 'PNG is lossless, so there is no quality to set: it stores the exact pixels either way.'
              : quality >= 95
                ? // The failure people actually hit. At 95+ a JPEG re-encode is
                  // usually the same size or larger than it started, the
                  // never-inflate rule hands the original straight back, and the
                  // tool looks like it did nothing. Say so before the button.
                  `At ${quality} there is almost nothing to save — a photo re-encoded this high normally comes out the same size or bigger, and you will get your original back. Try 75 to 85.`
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
        )}

        {/* Only shown when a PNG can actually come out of the run — on a
            JPG-to-JPG compression it would be a control that does nothing. */}
        {pngPossible(queue) ? (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-3 text-sm">
              <Switch
                checked={reduceColors}
                disabled={busy}
                label="Shrink PNGs by reducing colours"
                onCheckedChange={setReduceColors}
              />
              <span className="text-fg-muted">
                <span className="block font-medium text-fg">Shrink PNGs by reducing colours</span>
                The only thing that makes a PNG meaningfully smaller. Screenshots, logos and
                diagrams typically drop by 60–80% with no visible change; photographs lose real
                gradient detail. Turn it off to keep a PNG pixel-for-pixel identical.
              </span>
            </label>

            {reduceColors ? (
              <div className="mt-3">
                <Field
                  label="Colours to keep"
                  htmlFor="compressor-colors"
                  labelSuffix={<span className="tabular">{colors}</span>}
                  hint="Fewer colours means a smaller file. Below about 64, flat areas start to band."
                >
                  <Slider
                    id="compressor-colors"
                    min={8}
                    max={256}
                    step={8}
                    value={colors}
                    disabled={busy}
                    onChange={(event) => setColors(Number(event.target.value))}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ),
    [colors, encodable, estimate, format, lockFormat, lossless, pngPossible, quality, reduceColors],
  );

  const summary = useMemo(
    () => (result: ImageBatchResult) => {
      const saving = savingsSummary(result.totalBefore, result.totalAfter);
      const kept = result.outputs.filter((out) => out.keptOriginal).length;

      /*
       * Name the formats that actually won rather than the setting that was
       * chosen. In `smallest` mode the setting is "pick for me", so echoing it
       * back tells the user nothing; "as WebP" tells them what they now have.
       */
      const wonFormats = [
        ...new Set(result.outputs.filter((out) => !out.keptOriginal).map((out) => out.format)),
      ];
      const formatNote =
        wonFormats.length === 0
          ? ''
          : ` · as ${wonFormats.map((f) => (f === 'jpeg' ? 'JPG' : f.toUpperCase())).join(' and ')}`;

      const keptNote =
        kept === 0
          ? ''
          : ` · ${kept} already ${kept === 1 ? 'was' : 'were'} as small as possible, so your original ${kept === 1 ? 'file was' : 'files were'} kept`;

      return `${humanBytes(result.totalBefore)} → ${humanBytes(result.totalAfter)} · ${saving.sentence}${formatNote}${lossless ? '' : ` at quality ${quality}`}${keptNote}`;
    },
    [lossless, quality],
  );

  return (
    <ImageBatchShell
      slug={slug}
      label="Compress images"
      accept={accept}
      runLabel="Compress images"
      archiveLabel="compressed-images"
      controls={controls}
      plan={plan}
      title={(result) =>
        `${result.outputs.length} ${result.outputs.length === 1 ? 'image' : 'images'} compressed`
      }
      summary={summary}
      hint={hint}
      note={(_file, sniffed) =>
        sniffed && sniffed.width !== null && sniffed.height !== null
          ? `${sniffed.width} × ${sniffed.height} px`
          : null
      }
    />
  );
}
