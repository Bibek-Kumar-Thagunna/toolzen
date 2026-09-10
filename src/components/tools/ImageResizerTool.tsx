'use client';

/**
 * ============================================================================
 * IMAGE RESIZER
 * ============================================================================
 * Three ways to say what size you want — exact pixels, a percentage, or a named
 * preset — over the same engine.
 *
 * ── Why a large reduction is not one draw call ────────────────────────────
 * `encodeImage` walks the chain from `resizeSteps` rather than scaling in a
 * single pass. A browser's one-shot downscale samples roughly one source pixel
 * in ten and discards the rest, so fine detail turns to shimmer; halving
 * repeatedly averages the pixels that are being thrown away. That is most of
 * why output from this tool looks sharp, and it costs nothing here because the
 * codec already does it.
 *
 * ── Upscaling is allowed and labelled, not blocked ────────────────────────
 * Enlarging cannot add detail that was never captured, and every "AI upscale"
 * is a guess. This tool does not guess — but somebody who genuinely needs a
 * 400px logo at 800px for a print layout is not making a mistake, so the
 * enlargement happens and the interface says what it is rather than refusing.
 *
 * ── The aspect lock computes the missing side ─────────────────────────────
 * With the lock on, one number is enough and the other is derived per file,
 * which matters for a mixed batch: a landscape photo and a portrait one both
 * given "width 1080" should keep their own shapes, not be forced into a shared
 * height. That is why the target is resolved inside `plan`, per image, rather
 * than once for the whole queue.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Tabs } from '@/components/ui/Tabs';
import { ImageBatchShell, type SniffedFile } from '@/components/tool/ImageBatchShell';
import { humanBytes } from '@/lib/files/bytes';
import type { ImageBatchResult, ImagePlan, PlanInput } from '@/lib/tools/image/batch';
import type { EncodableFormat } from '@/lib/tools/image/codec';
import {
  PRESETS,
  scaleByPercent,
  validateTarget,
  type Size,
} from '@/lib/tools/image/dimensions';
import { mimeForFormat, outputFileName } from '@/lib/tools/image/format';
import { RASTER_IMAGES } from '@/lib/tools/accepts';

const SLUG = 'image-resizer';

type Mode = 'pixels' | 'percent' | 'preset';

const MODES = [
  { id: 'pixels', label: 'Exact size' },
  { id: 'percent', label: 'Percentage' },
  { id: 'preset', label: 'Preset' },
];

type FormatChoice = 'keep' | EncodableFormat;

const FORMAT_LABELS: Record<FormatChoice, string> = {
  keep: 'Keep the original format',
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
};

function resolveKeep(sniffedFormat: string): EncodableFormat {
  if (sniffedFormat === 'jpeg' || sniffedFormat === 'webp') return sniffedFormat;
  return 'png';
}

/** Parsed as a whole number, or `undefined` for "not specified". */
function parseDimension(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value) : Number.NaN;
}

export function ImageResizerTool() {
  const [mode, setMode] = useState<Mode>('pixels');
  const [widthText, setWidthText] = useState('1080');
  const [heightText, setHeightText] = useState('');
  const [lockAspect, setLockAspect] = useState(true);
  const [percent, setPercent] = useState('50');
  const [presetName, setPresetName] = useState(PRESETS[0]?.name ?? '');
  const [format, setFormat] = useState<FormatChoice>('keep');
  const [quality, setQuality] = useState(85);

  const preset = useMemo(() => PRESETS.find((entry) => entry.name === presetName), [presetName]);

  /**
   * Validate the *inputs*, not a specific image — the per-file check happens in
   * `plan`. This is what disables the run button with a sentence rather than
   * letting somebody press it and get twenty identical errors.
   */
  const blockedReason = useMemo<string | null>(() => {
    if (mode === 'percent') {
      const value = Number(percent);
      if (!Number.isFinite(value) || value <= 0) return 'Enter a percentage above zero.';
      if (value > 1000) return 'The largest enlargement here is 1000%. Past that, browsers start refusing to draw.';
      return null;
    }
    if (mode === 'preset') {
      return preset ? null : 'Choose a preset size.';
    }
    const width = parseDimension(widthText);
    const height = parseDimension(heightText);
    if (Number.isNaN(width) || Number.isNaN(height)) return 'Width and height have to be numbers.';
    if (width === undefined && height === undefined) {
      return 'Enter a width or a height so we know what size you want.';
    }
    // Both sides given with the lock on would distort; `validateTarget` pulls
    // it back to the largest matching size and warns, so it is allowed.
    return null;
  }, [heightText, mode, percent, preset, widthText]);

  const plan = useCallback(
    ({ file, image, sniffed }: PlanInput): ImagePlan => {
      const source: Size = { width: image.width, height: image.height };

      let target: Size;
      if (mode === 'percent') {
        target = scaleByPercent(source, Number(percent));
      } else if (mode === 'preset') {
        if (!preset) return { skip: 'No preset was chosen.' };
        target = preset.size;
      } else {
        const checked = validateTarget(
          source,
          { width: parseDimension(widthText), height: parseDimension(heightText) },
          { lockAspect, allowUpscale: true },
        );
        if (!checked.ok) return { skip: checked.error };
        target = checked.size;
      }

      const outFormat: EncodableFormat = format === 'keep' ? resolveKeep(sniffed.format) : format;

      return {
        options: { format: outFormat, quality: quality / 100, target },
        name: outputFileName(file.name, outFormat, { suffix: `-${target.width}x${target.height}` }),
        mime: mimeForFormat(outFormat),
      };
    },
    [format, heightText, lockAspect, mode, percent, preset, quality, widthText],
  );

  const controls = useCallback(
    (queue: SniffedFile[], busy: boolean) => {
      const first = queue.find((entry) => entry.sniffed?.width && entry.sniffed?.height);
      const sourceNote =
        first?.sniffed?.width && first.sniffed.height
          ? `First image is ${first.sniffed.width} × ${first.sniffed.height} px.`
          : undefined;

      return (
        <div className="space-y-4">
          <Tabs
            tabs={MODES}
            value={mode}
            onValueChange={(id) => setMode(id as Mode)}
            ariaLabel="How to choose the new size"
          >
            {mode === 'pixels' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Width"
                  htmlFor="resize-width"
                  hint={lockAspect ? 'Leave one side blank and it is worked out for you.' : sourceNote}
                >
                  <Input
                    id="resize-width"
                    numeric
                    inputMode="numeric"
                    value={widthText}
                    disabled={busy}
                    suffix="px"
                    placeholder="auto"
                    onChange={(event) => setWidthText(event.target.value)}
                  />
                </Field>
                <Field label="Height" htmlFor="resize-height" hint={sourceNote}>
                  <Input
                    id="resize-height"
                    numeric
                    inputMode="numeric"
                    value={heightText}
                    disabled={busy}
                    suffix="px"
                    placeholder="auto"
                    onChange={(event) => setHeightText(event.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Switch
                    checked={lockAspect}
                    onCheckedChange={setLockAspect}
                    disabled={busy}
                    label="Keep the original proportions"
                  />
                  <p className="mt-1 text-xs text-fg-muted">
                    On, a picture keeps its shape and is never stretched. Off, it is forced into
                    exactly the width and height you type.
                  </p>
                </div>
              </div>
            ) : null}

            {mode === 'percent' ? (
              <Field
                label="Scale to"
                htmlFor="resize-percent"
                hint="Halving both sides quarters the pixel count, and file size follows the pixel count closely."
              >
                <Input
                  id="resize-percent"
                  numeric
                  inputMode="numeric"
                  value={percent}
                  disabled={busy}
                  suffix="%"
                  onChange={(event) => setPercent(event.target.value)}
                />
              </Field>
            ) : null}

            {mode === 'preset' ? (
              <Field
                label="Preset"
                htmlFor="resize-preset"
                hint={
                  preset?.note ??
                  'Sizes that get silently cropped or rejected if you guess them.'
                }
              >
                <Select
                  id="resize-preset"
                  value={presetName}
                  disabled={busy}
                  onChange={(event) => setPresetName(event.target.value)}
                >
                  {PRESETS.map((entry) => (
                    <option key={`${entry.group}:${entry.name}`} value={entry.name}>
                      {entry.name} — {entry.size.width} × {entry.size.height}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </Tabs>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Save as" htmlFor="resize-format">
              <Select
                id="resize-format"
                value={format}
                disabled={busy}
                onChange={(event) => setFormat(event.target.value as FormatChoice)}
              >
                {(Object.keys(FORMAT_LABELS) as FormatChoice[]).map((choice) => (
                  <option key={choice} value={choice}>
                    {FORMAT_LABELS[choice]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Quality"
              htmlFor="resize-quality"
              labelSuffix={<span className="tabular">{format === 'png' ? '—' : quality}</span>}
              hint={
                format === 'png'
                  ? 'PNG is lossless and ignores this.'
                  : 'Applies to JPG and WebP output.'
              }
            >
              <Input
                id="resize-quality"
                type="range"
                min={1}
                max={100}
                step={1}
                value={quality}
                disabled={busy || format === 'png'}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </Field>
          </div>
        </div>
      );
    },
    [format, heightText, lockAspect, mode, percent, preset, presetName, quality, widthText],
  );

  const summary = useCallback(
    (result: ImageBatchResult) => {
      const how =
        mode === 'percent'
          ? `${percent}% of the original`
          : mode === 'preset'
            ? (preset ? `${preset.name} (${preset.size.width} × ${preset.size.height})` : 'preset')
            : lockAspect
              ? 'proportions kept'
              : 'exact size, proportions ignored';
      return `${humanBytes(result.totalBefore)} → ${humanBytes(result.totalAfter)} · ${how}`;
    },
    [lockAspect, mode, percent, preset],
  );

  return (
    <ImageBatchShell
      slug={SLUG}
      label="Resize images"
      accept={RASTER_IMAGES}
      runLabel="Resize images"
      archiveLabel="resized-images"
      controls={controls}
      plan={plan}
      blockedReason={blockedReason}
      title={(result) =>
        `${result.outputs.length} ${result.outputs.length === 1 ? 'image' : 'images'} resized`
      }
      summary={summary}
      hint="Up to 20 images at a time, 30 MB each. Large reductions are done in steps so detail survives."
      note={(_file, sniffed) =>
        sniffed && sniffed.width !== null && sniffed.height !== null
          ? `${sniffed.width} × ${sniffed.height} px`
          : null
      }
    />
  );
}
