'use client';

/**
 * ============================================================================
 * IMAGE CONVERTER — the shared body of the three format tools
 * ============================================================================
 * JPG→PNG, PNG→JPG and PNG→WebP are one conversion with three sets of copy.
 * Building them as three components would triple the surface for the same three
 * bugs; building them as one component with a `from`/`to` prop and no separate
 * pages would cost the three URLs that people actually search for. So: one
 * body, three thin pages, each with its own slug, title, prose and FAQ in the
 * registry.
 *
 * ── What differs between the three, and why each control exists ────────────
 * `quality` appears only when the target is lossy. PNG ignores it entirely, so
 * showing a slider on JPG→PNG would be a control that moves and changes
 * nothing.
 *
 * `background` appears only when the target has no alpha channel — which is
 * JPEG alone among the three. A transparent PNG encoded to JPEG without a fill
 * comes back with *black* where the transparency was, which reads as file
 * corruption to anyone who has not met the format before. The codec defaults to
 * white; this exposes the choice, because a logo destined for a dark page wants
 * a different answer and finding that out in the downloads folder is too late.
 *
 * ── Why the honest note is a first-class prop ─────────────────────────────
 * Each direction has one thing a user should know before they commit: a PNG of
 * a photograph will be *larger* than the JPG it came from, and no conversion
 * restores detail JPEG already discarded. Saying so above the button is the
 * difference between a tool people trust and one they use once.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Slider } from '@/components/ui/Slider';
import { ImageBatchShell, type SniffedFile } from '@/components/tool/ImageBatchShell';
import type { AcceptSpec } from '@/lib/registry/types';
import { humanBytes } from '@/lib/files/bytes';
import type { ImageBatchResult, ImagePlan, PlanInput } from '@/lib/tools/image/batch';
import type { EncodableFormat } from '@/lib/tools/image/codec';
import { estimateOutputBytes } from '@/lib/tools/image/dimensions';
import { mimeForFormat, outputFileName, savingsSummary } from '@/lib/tools/image/format';

export interface ImageConvertToolProps {
  slug: string;
  accept: AcceptSpec;
  /** The encoder target. Only these three can be written by a browser. */
  to: EncodableFormat;
  /** e.g. "Convert to PNG". Also the run button and the region label. */
  runLabel: string;
  archiveLabel: string;
  /** One sentence of honesty shown under the run button. */
  note: string;
  /** Default quality for the lossy targets. Ignored for PNG. */
  defaultQuality?: number;
}

/** JPEG is the only browser-writable format with no alpha channel. */
const HAS_ALPHA: Record<EncodableFormat, boolean> = { jpeg: false, png: true, webp: true };
const IS_LOSSY: Record<EncodableFormat, boolean> = { jpeg: true, png: false, webp: true };

export function ImageConvertTool({
  slug,
  accept,
  to,
  runLabel,
  archiveLabel,
  note,
  defaultQuality = 85,
}: ImageConvertToolProps) {
  const [quality, setQuality] = useState(defaultQuality);
  const [background, setBackground] = useState('#ffffff');

  const lossy = IS_LOSSY[to];
  const needsBackground = !HAS_ALPHA[to];

  const plan = useCallback(
    ({ file }: PlanInput): ImagePlan => ({
      options: {
        format: to,
        ...(lossy ? { quality: quality / 100 } : {}),
        ...(needsBackground ? { background } : {}),
      },
      name: outputFileName(file.name, to),
      mime: mimeForFormat(to),
    }),
    [background, lossy, needsBackground, quality, to],
  );

  const estimate = useCallback(
    (queue: SniffedFile[]): string | null => {
      let bytes = 0;
      let known = 0;
      for (const { sniffed } of queue) {
        if (!sniffed || sniffed.width === null || sniffed.height === null) continue;
        known += 1;
        bytes += estimateOutputBytes(
          { width: sniffed.width, height: sniffed.height },
          to,
          quality / 100,
        );
      }
      if (known === 0) return null;
      return `Roughly ${humanBytes(bytes)} in total — the real figure depends on what is in the pictures.`;
    },
    [quality, to],
  );

  const controls = useCallback(
    (queue: SniffedFile[], busy: boolean) => {
      if (!lossy && !needsBackground) {
        const projected = estimate(queue);
        return projected ? <p className="text-sm text-fg-muted">{projected}</p> : null;
      }

      /** Only worth asking about if something in the queue actually has alpha. */
      const anyTransparent = queue.some((entry) => entry.sniffed?.hasAlpha !== false);

      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {lossy ? (
            <Field
              label="Quality"
              htmlFor={`${slug}-quality`}
              labelSuffix={<span className="tabular">{quality}</span>}
              hint={estimate(queue) ?? 'Higher keeps more detail and costs more bytes.'}
            >
              <Slider
                id={`${slug}-quality`}
                min={1}
                max={100}
                step={1}
                value={quality}
                disabled={busy}
                onChange={(event) => setQuality(Number(event.target.value))}
              />
            </Field>
          ) : null}

          {needsBackground ? (
            <Field
              label="Fill transparent areas with"
              htmlFor={`${slug}-background`}
              hint={
                anyTransparent
                  ? 'JPG has no transparency. Without a fill, see-through areas come out black.'
                  : 'None of these files appear to have transparency, so this will not be used.'
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  id={`${slug}-background`}
                  type="color"
                  value={background}
                  disabled={busy}
                  onChange={(event) => setBackground(event.target.value)}
                  className="h-10 w-14 cursor-pointer p-1"
                />
                <Input
                  aria-label="Background colour as a hex value"
                  value={background}
                  disabled={busy}
                  onChange={(event) => setBackground(event.target.value)}
                  className="font-mono"
                />
              </div>
            </Field>
          ) : null}
        </div>
      );
    },
    [background, estimate, lossy, needsBackground, quality, slug],
  );

  const summary = useMemo(
    () => (result: ImageBatchResult) => {
      const saving = savingsSummary(result.totalBefore, result.totalAfter);
      return `${humanBytes(result.totalBefore)} → ${humanBytes(result.totalAfter)} · ${saving.sentence}${lossy ? ` · quality ${quality}` : ''}`;
    },
    [lossy, quality],
  );

  return (
    <ImageBatchShell
      slug={slug}
      label={runLabel}
      accept={accept}
      runLabel={runLabel}
      archiveLabel={archiveLabel}
      controls={controls}
      plan={plan}
      title={(result) =>
        `${result.outputs.length} ${result.outputs.length === 1 ? 'file' : 'files'} converted`
      }
      summary={summary}
      hint={note}
      note={(_file, sniffed) =>
        sniffed && sniffed.width !== null && sniffed.height !== null
          ? `${sniffed.width} × ${sniffed.height} px${sniffed.hasAlpha === true ? ' · has transparency' : ''}`
          : null
      }
    />
  );
}
