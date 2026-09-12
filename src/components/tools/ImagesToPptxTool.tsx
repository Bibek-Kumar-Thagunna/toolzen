'use client';

/**
 * ============================================================================
 * IMAGES TO POWERPOINT
 * ============================================================================
 * A folder of pictures becomes a deck you can present: one image per slide.
 *
 * ── Why the pictures go in untouched ──────────────────────────────────────
 * A .pptx carries images as ordinary files inside its ZIP, so a JPEG can be
 * copied in byte for byte. Nothing is decoded and re-encoded on the way, which
 * means no second generation of compression loss and a deck that weighs
 * roughly what the photographs weighed.
 *
 * The exception is a format PowerPoint cannot display. That is checked from
 * the file's own header rather than its extension, and anything unusable is
 * named and skipped rather than silently producing an empty slide.
 *
 * ── Why the size is asked for and not guessed ─────────────────────────────
 * A PowerPoint file has exactly one slide size for the whole deck — the format
 * simply has no per-slide dimension — so a mixed set of portrait and landscape
 * pictures cannot each get their own shape. 16:9 is the default because it is
 * what every projector and screen share expects; "fit the first image" is
 * there for a set that is all one shape, such as scanned pages.
 *
 * ── Nothing is uploaded ───────────────────────────────────────────────────
 * The package is assembled in the tab, from the ZIP writer the site already
 * uses for its downloads. A deck of internal screenshots or customer
 * photographs never leaves the device.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { RASTER_IMAGES_MANY } from '@/lib/tools/accepts';
import { sniffImage } from '@/lib/tools/image/format';
import {
  SLIDE_SIZES,
  writePptx,
  type PptxFit,
  type PptxImage,
  type PptxImageKind,
  type SlideSizeName,
} from '@/lib/tools/office/pptx';

const SLUG = 'images-to-pptx';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** What a .pptx can display. WebP is not on the list — see `unsupported`. */
const DISPLAYABLE: Readonly<Record<string, PptxImageKind>> = {
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  bmp: 'bmp',
};

const FIT_LABELS: Record<PptxFit, string> = {
  contain: 'Fit the whole picture on the slide',
  cover: 'Fill the slide, cropping the edges',
  fit: 'Shape the slides to the first picture',
};

interface Output {
  bytes: Uint8Array;
  name: string;
  slides: number;
  skipped: string[];
}

export function ImagesToPptxTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [size, setSize] = useState<SlideSizeName>('16:9');
  const [fit, setFit] = useState<PptxFit>('contain');
  const [background, setBackground] = useState('#FFFFFF');

  const run = useToolRun<Output>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const onFiles = useCallback(
    (incoming: File[]) => {
      markStarted();
      run.reset();
      setFiles((current) => [...current, ...incoming]);
    },
    [markStarted, run],
  );

  const onRun = useCallback(() => {
    if (files.length === 0) return;
    markStarted();

    void run.start(
      async (ctx) => {
        const images: PptxImage[] = [];
        const skipped: string[] = [];

        for (const [index, file] of files.entries()) {
          await ctx.checkpoint();
          const bytes = new Uint8Array(await file.arrayBuffer());

          // The header decides, not the extension: a WebP renamed to .png is
          // still a WebP, and PowerPoint would show an empty frame for it.
          const sniffed = sniffImage(bytes);
          const kind = DISPLAYABLE[sniffed.format];
          if (kind === undefined) {
            skipped.push(
              `${file.name} — PowerPoint cannot display ${sniffed.format === 'unknown' ? 'this file' : sniffed.format.toUpperCase()}`,
            );
            ctx.report(index + 1, files.length);
            continue;
          }
          if (sniffed.width === null || sniffed.height === null) {
            skipped.push(`${file.name} — its size could not be read`);
            ctx.report(index + 1, files.length);
            continue;
          }

          images.push({ kind, bytes, width: sniffed.width, height: sniffed.height });
          ctx.report(index + 1, files.length);
        }

        if (images.length === 0) {
          return {
            ok: false as const,
            error:
              skipped.length > 0
                ? 'None of those files can go into a PowerPoint. JPG, PNG, GIF and BMP can.'
                : 'Add at least one image.',
            reason: 'invalid_input' as const,
          };
        }

        const deck = writePptx(images, { size, fit, background });
        if (!deck.ok) {
          return { ok: false as const, error: deck.error, reason: 'unknown' as const };
        }

        const first = files[0];
        const base = first ? safeBaseName(first.name.replace(/\.[^.]+$/, ''), { fallback: 'slides' }) : 'slides';
        return {
          ok: true as const,
          value: {
            bytes: deck.bytes,
            name: `${images.length === 1 ? base : 'presentation'}.pptx`,
            slides: images.length,
            skipped,
          },
        };
      },
      { count: files.length },
    );
  }, [background, files, fit, markStarted, run, size]);

  const reset = useCallback(() => {
    setFiles([]);
    run.reset();
  }, [run]);

  const result = run.result;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <ToolWorkspace
      label="Images to PowerPoint"
      error={run.error}
      status={run.busy ? 'Building the deck' : result ? 'Done — presentation ready' : null}
    >
      <FileDropzone
        slug={SLUG}
        accept={RASTER_IMAGES_MANY}
        existing={files.length}
        disabled={run.busy}
        onFiles={onFiles}
      />

      {files.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">
              {files.length} {files.length === 1 ? 'image' : 'images'} · {humanBytes(totalBytes)} ·{' '}
              {files.length} {files.length === 1 ? 'slide' : 'slides'}
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Start over
            </Button>
          </div>

          <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2 text-sm"
              >
                <span className="tabular w-8 shrink-0 text-fg-subtle">{index + 1}</span>
                <Icon name="image" size={16} className="shrink-0 text-fg-subtle" />
                <span className="truncate text-fg" title={file.name}>
                  {file.name}
                </span>
                <span className="ml-auto shrink-0 text-fg-muted">{humanBytes(file.size)}</span>
              </li>
            ))}
          </ul>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Slide size"
              htmlFor="pptx-size"
              hint={
                fit === 'fit'
                  ? 'Ignored: the first picture is setting the shape.'
                  : 'A PowerPoint file has one slide size for the whole deck.'
              }
            >
              <Select
                id="pptx-size"
                value={size}
                disabled={run.busy || fit === 'fit'}
                onChange={(event) => setSize(event.target.value as SlideSizeName)}
              >
                {(Object.keys(SLIDE_SIZES) as SlideSizeName[]).map((name) => (
                  <option key={name} value={name}>
                    {SLIDE_SIZES[name].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="How the picture sits"
              htmlFor="pptx-fit"
              hint={
                fit === 'cover'
                  ? 'Anything outside the slide is off the edge — it is still in the file, just not on screen.'
                  : undefined
              }
            >
              <Select
                id="pptx-fit"
                value={fit}
                disabled={run.busy}
                onChange={(event) => setFit(event.target.value as PptxFit)}
              >
                {(Object.keys(FIT_LABELS) as PptxFit[]).map((name) => (
                  <option key={name} value={name}>
                    {FIT_LABELS[name]}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Only visible where it can be seen: 'cover' and 'fit' leave no
                background showing. */}
            {fit === 'contain' ? (
              <Field
                label="Slide background"
                htmlFor="pptx-bg"
                hint="Seen on the sides when a picture does not match the slide shape."
              >
                <div className="flex items-center gap-2">
                  <input
                    id="pptx-bg"
                    type="color"
                    value={background}
                    disabled={run.busy}
                    onChange={(event) => setBackground(event.target.value)}
                    className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border-strong bg-surface p-1"
                  />
                  <span className="font-mono text-sm text-fg-muted">
                    {background.toUpperCase()}
                  </span>
                </div>
              </Field>
            ) : null}
          </div>

          <ToolRunBar
            label="Build presentation"
            busy={run.busy}
            progress={run.progress}
            progressLabel={(p) => `Slide ${p.done} of ${p.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Your pictures go in exactly as they are, and none of this leaves your device."
          />
        </>
      ) : null}

      {result ? (
        <ToolResult
          slug={SLUG}
          title="Your presentation is ready"
          summary={`${result.slides} ${result.slides === 1 ? 'slide' : 'slides'} · ${humanBytes(result.bytes.length)}`}
          download={{
            label: 'Download .pptx',
            format: 'pptx',
            count: 1,
            deliver: () => {
              const output = run.result;
              if (!output) {
                return {
                  ok: false as const,
                  reason: 'unknown' as const,
                  error: 'There is nothing to download yet.',
                };
              }
              return downloadBytes(output.bytes, output.name, PPTX_MIME);
            },
          }}
          onUseAgain={reset}
          useAgainLabel="Start over"
        >
          {result.skipped.length > 0 ? (
            <Alert variant="warning" title={`${result.skipped.length} left out`}>
              <ul className="list-inside list-disc space-y-1">
                {result.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}
