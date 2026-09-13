'use client';

/**
 * ============================================================================
 * COMPRESS TO A TARGET SIZE
 * ============================================================================
 * "Make this fit under 20 KB", the way an application portal means it.
 *
 * ── Why this is a different tool and not a preset on the compressor ───────
 * The image compressor answers "make this smaller, I will judge the result".
 * Its interface is a quality slider, which is the right control for that
 * question and the wrong one for this: nobody uploading to an exam portal
 * wants quality 62, they want *under the ceiling the form enforces*, and they
 * do not care what quality it took.
 *
 * Inverting which of the two is the input changes the whole surface. There is
 * no quality slider here, because quality is an output. There is a size box,
 * because size is the requirement. And the engine has to search rather than
 * encode once, which means it can also fail in a way the compressor never
 * does — "this cannot reach 20 KB" — and that failure has to be explained
 * rather than shrugged at.
 *
 * ── The thing every competing tool gets wrong ─────────────────────────────
 * A quality search alone cannot reach a small target from a large photograph.
 * Most "compress to 20KB" pages discover this at the floor and tell the user
 * to go and resize the image first — which is the remaining work handed back
 * to the person who came here to avoid doing it. `encodeToTargetSize` keeps
 * going: quality first at full resolution, then progressively fewer pixels,
 * and it reports which it had to use so nothing happens silently.
 *
 * ── Why the signature mode crops before it compresses ─────────────────────
 * A signature is photographed on A4. Eight percent of the frame is ink and the
 * rest is paper, and paper costs exactly as many bytes as ink. Spending a
 * 20 KB budget mostly on blank sheet is why these uploads come out unreadable.
 * Trimming to the ink first spends the budget on the part that has to survive.
 * That is a real behavioural difference, which is the bar FormatVariants.tsx
 * sets for a variant page — a preset in a box would not have cleared it.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { ImageBatchShell, type SniffedFile } from '@/components/tool/ImageBatchShell';
import { humanBytes } from '@/lib/files/bytes';
import type { ImageBatchResult, ImagePlan, PlanInput } from '@/lib/tools/image/batch';
import { encodeToTargetSize, readPixels, type EncodableFormat } from '@/lib/tools/image/codec';
import { contentBounds, isWorthCropping } from '@/lib/tools/image/trim';
import { outputFileName } from '@/lib/tools/image/format';
import { mimeForFormat } from '@/lib/tools/image/format';
import type { AcceptSpec } from '@/lib/registry/types';
import { RASTER_IMAGES } from '@/lib/tools/accepts';

/**
 * The ceilings that actually appear on forms, rather than a tidy power-of-two
 * ladder. 20 KB is the near-universal signature limit and 50 KB the near-
 * universal photograph limit on Indian examination portals; 100 KB and 200 KB
 * are the common document and general-upload ceilings; 500 KB and 1 MB cover
 * email and web use.
 */
const PRESETS = [20, 50, 100, 200, 500, 1024] as const;

/** Below this a scan stops being legible, whatever the byte count says. */
const LEGIBILITY_FLOOR_PX = 120;

export type TargetMode = 'generic' | 'signature';

export interface CompressToSizeProps {
  slug?: string;
  accept?: AcceptSpec;
  mode?: TargetMode;
  /** Pre-selected ceiling in KB. */
  defaultKb?: number;
  label?: string;
  hint?: string;
}

export function CompressToSizeTool({
  slug = 'compress-image-to-size',
  accept = RASTER_IMAGES,
  mode = 'generic',
  defaultKb = 100,
  label = 'Compress images to a target size',
  hint = 'Up to 20 images at a time, 30 MB each. Everything happens on your device.',
}: CompressToSizeProps = {}) {
  const [kb, setKb] = useState(defaultKb);
  const [format, setFormat] = useState<EncodableFormat>('jpeg');
  const [trim, setTrim] = useState(mode === 'signature');

  const maxBytes = Math.max(1, Math.round(kb)) * 1024;

  /**
   * One candidate, encoded by hand.
   *
   * The batch runner's normal path encodes `options` once. This tool cannot
   * use it: hitting a byte ceiling takes a search, and the search needs the
   * decoded image rather than a set of options. `CustomEncoder` is the hook
   * the runner provides for exactly this, and it keeps the runner in charge of
   * naming, the never-inflate rule and the per-file summary.
   */
  const plan = useCallback(
    ({ file, image, sniffed }: PlanInput): ImagePlan => {
      const name = outputFileName(file.name, format);

      return {
        candidates: [
          {
            options: { format },
            name,
            mime: mimeForFormat(format),
            format,
            encode: async (decoded, signal) => {
              // Trim first, so the byte budget is spent on the content rather
              // than on the paper around it. Reading pixels costs an extra
              // canvas pass, so it is skipped unless it would actually save
              // something worth having.
              let region: { x: number; y: number; width: number; height: number } | undefined;
              if (trim) {
                const pixels = readPixels(decoded);
                if (pixels.ok) {
                  const bounds = contentBounds(pixels.data, pixels.size);
                  if (isWorthCropping(bounds, pixels.size)) {
                    // `readPixels` may have clamped to fit the canvas ceiling,
                    // so the bounds are in its coordinate space, not the
                    // source's. Scaling back is what keeps a 40-megapixel
                    // phone photo cropping in the right place.
                    const scale = decoded.width / pixels.size.width;
                    region = {
                      x: Math.round(bounds.x * scale),
                      y: Math.round(bounds.y * scale),
                      width: Math.round(bounds.width * scale),
                      height: Math.round(bounds.height * scale),
                    };
                  }
                }
              }

              const result = await encodeToTargetSize(decoded, {
                format,
                maxBytes,
                region,
                signal,
              });
              if (!result.ok) return result;

              const bytes = new Uint8Array(await result.blob.arrayBuffer());
              return {
                ok: true,
                bytes,
                width: result.size.width,
                height: result.size.height,
              };
            },
          },
        ],
        // A file already under the ceiling is already correct, and re-encoding
        // it would throw away quality to meet a requirement it already meets.
        neverInflate: true,
      };
    },
    [format, maxBytes, trim],
  );

  const controls = useCallback(
    (queue: SniffedFile[], busy: boolean) => (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Maximum file size"
          htmlFor="target-kb"
          hint={
            kb <= 20
              ? 'A 20 KB ceiling is the usual signature limit. Very small targets may need the picture to shrink as well as lose quality — the result says if it did.'
              : 'Every file comes out at or under this. Pick the number the form asks for.'
          }
        >
          <div className="flex items-center gap-2">
            <Input
              id="target-kb"
              type="number"
              inputMode="numeric"
              min={1}
              max={20480}
              value={kb}
              disabled={busy}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setKb(Math.min(20480, Math.max(1, next)));
              }}
              className="w-28"
            />
            <span className="text-sm text-fg-muted">KB</span>
            <Select
              aria-label="Common size limits"
              value={PRESETS.includes(kb as (typeof PRESETS)[number]) ? String(kb) : ''}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value !== '') setKb(Number(event.target.value));
              }}
            >
              <option value="">Common limits…</option>
              {PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset >= 1024 ? '1 MB' : `${preset} KB`}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        <Field
          label="Save as"
          htmlFor="target-format"
          hint={
            format === 'webp'
              ? 'WebP reaches a small target at higher quality than JPG, but a few older upload forms reject it.'
              : 'JPG is accepted by every form. Choose WebP only if you know the destination takes it.'
          }
        >
          <Select
            id="target-format"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value as EncodableFormat)}
          >
            <option value="jpeg">JPG — accepted everywhere</option>
            <option value="webp">WebP — smaller, less widely accepted</option>
          </Select>
        </Field>

        {/* Offered on every page, defaulted on for signatures. A photograph of
            a document benefits from it too, and hiding it on the general page
            would mean the better result is only available to people who
            happened to land on the narrower one. */}
        <div className="sm:col-span-2 space-y-2">
          <div className="flex items-center gap-3">
            <Switch
              checked={trim}
              disabled={busy}
              onCheckedChange={setTrim}
              label="Trim the blank border first"
            />
            <span className="text-sm">Trim the blank border first</span>
          </div>
          <p className="text-sm text-fg-muted">
            Finds the edge of the writing and crops to it, so the size budget is spent on the
            content instead of the paper around it. Leave this off for a photograph with a plain
            background you want to keep.
          </p>
        </div>

        {queue.length > 0 ? (
          <p className="text-sm text-fg-muted sm:col-span-2">
            {queue.length === 1
              ? `One file, ${humanBytes(queue[0]?.file.size ?? 0)} now, target ${kb} KB.`
              : `${queue.length} files, each brought under ${kb} KB.`}
          </p>
        ) : null}
      </div>
    ),
    [format, kb, trim],
  );

  const summary = useCallback(
    (result: ImageBatchResult) => {
      const largest = result.outputs.reduce((most, output) => Math.max(most, output.size), 0);
      const shrunk = result.outputs.filter(
        (output) => output.width < LEGIBILITY_FLOOR_PX || output.height < LEGIBILITY_FLOOR_PX,
      ).length;

      return (
        <>
          Every file is at or under {kb} KB — the largest came out at {humanBytes(largest)}.
          {shrunk > 0
            ? ` ${shrunk === 1 ? 'One file is' : `${shrunk} files are`} now under ${LEGIBILITY_FLOOR_PX} pixels on one side, which some forms reject as too small. Check the requirement before uploading.`
            : ''}
        </>
      );
    },
    [kb],
  );

  const title = useMemo(
    () => (result: ImageBatchResult) =>
      result.outputs.length === 1
        ? `1 image brought under ${kb} KB`
        : `${result.outputs.length} images brought under ${kb} KB`,
    [kb],
  );

  return (
    <ImageBatchShell
      slug={slug}
      label={label}
      accept={accept}
      runLabel={`Compress to ${kb} KB`}
      archiveLabel={`under-${kb}kb`}
      controls={controls}
      plan={plan}
      title={title}
      summary={summary}
      hint={hint}
    />
  );
}

/**
 * Signatures, which are the reason this tool exists.
 *
 * Two real differences from the general page, not a pre-filled number: the
 * border trim is on, because a photographed signature is mostly paper; and the
 * copy and the default ceiling are built around the 20 KB limit that
 * examination portals enforce.
 */
export function SignatureResizerTool() {
  return (
    <CompressToSizeTool
      slug="resize-signature"
      mode="signature"
      defaultKb={20}
      label="Resize a signature to fit an upload limit"
      hint="One signature at a time is usual. Nothing is uploaded — the crop and the compression both happen on your device."
    />
  );
}
