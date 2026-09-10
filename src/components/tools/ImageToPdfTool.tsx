'use client';

/**
 * ============================================================================
 * IMAGES TO PDF
 * ============================================================================
 * A stack of pictures becomes a document, in the order shown, on your device.
 *
 * ── A JPEG is copied in, not re-encoded ───────────────────────────────────
 * PDF can hold a JPEG bitstream verbatim inside a `/DCTDecode` stream, so a
 * photograph goes into the document as the exact bytes that arrived: no quality
 * loss, no re-encode time, and a file roughly the size of the originals added
 * together. Decoding to pixels and letting the writer deflate them would be
 * both slower and — for a photograph — several times larger, because lossless
 * compression on photographic data barely compresses.
 *
 * Everything else (PNG, GIF, BMP, WebP) is decoded to RGBA and handed over as
 * raw samples for the writer to deflate, which is the right trade in the other
 * direction: those are usually screenshots and line art, where deflate does
 * very well and where re-encoding to JPEG would put artefacts on crisp edges.
 *
 * ── Order is the document ─────────────────────────────────────────────────
 * Page order is queue order, and the queue is reorderable. This is the one tool
 * here where the sequence of the inputs *is* the output, so leaving people to
 * rename files into alphabetical order first would be the tool refusing to do
 * its job.
 *
 * ── Why "fit the image" is offered but not the default ────────────────────
 * A page sized to the picture makes a tidy screen document and a bad print: a
 * printer given a 4032pt-wide page scales it to whatever paper is loaded, and
 * the margins land wherever they land. A4 is the default because most of these
 * documents are eventually printed or emailed to somebody who will print them.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { Icon } from '@/components/icons';
import { brand } from '@/lib/brand';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { RASTER_IMAGES_MANY } from '@/lib/tools/accepts';
import { decodeImage, readPixels } from '@/lib/tools/image/codec';
import { sniffImage } from '@/lib/tools/image/format';
import { parseJpeg } from '@/lib/tools/pdf/jpeg';
import {
  PAGE_SIZES,
  placeImage,
  resolvePageSize,
  type ImageFit,
  type Orientation,
  type PageSizeName,
} from '@/lib/tools/pdf/pages';
import {
  browserDeflate,
  writePdf,
  type PdfImageSource,
  type PdfPageSpec,
} from '@/lib/tools/pdf/writer';

const SLUG = 'image-to-pdf';

const PAGE_CHOICES: { value: PageSizeName; label: string }[] = [
  { value: 'a4', label: 'A4 — 210 × 297 mm' },
  { value: 'letter', label: 'US Letter — 8.5 × 11 in' },
  { value: 'a3', label: 'A3 — 297 × 420 mm' },
  { value: 'a5', label: 'A5 — 148 × 210 mm' },
  { value: 'legal', label: 'US Legal — 8.5 × 14 in' },
  { value: 'tabloid', label: 'Tabloid — 11 × 17 in' },
  { value: 'fit', label: 'Fit each page to its image' },
];

const FIT_CHOICES: { value: ImageFit; label: string; note: string }[] = [
  { value: 'contain', label: 'Fit inside the page', note: 'The whole picture is visible. Nothing is cut off.' },
  { value: 'cover', label: 'Fill the page', note: 'No blank margins, but the edges of the picture run off the sheet.' },
  { value: 'actual', label: 'Actual size', note: 'One image pixel per point. A camera photo will be far wider than the page.' },
];

interface PdfOutput {
  bytes: Uint8Array;
  pages: number;
  name: string;
}

export function ImageToPdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeName>('a4');
  const [orientation, setOrientation] = useState<Orientation>('auto');
  const [fit, setFit] = useState<ImageFit>('contain');
  const [marginMm, setMarginMm] = useState(10);

  const run = useToolRun<PdfOutput>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const addFiles = useCallback(
    (incoming: File[]) => {
      markStarted();
      setFiles((previous) => [...previous, ...incoming].slice(0, RASTER_IMAGES_MANY.maxFiles));
      run.reset();
    },
    [markStarted, run],
  );

  const move = useCallback(
    (index: number, direction: -1 | 1) => {
      setFiles((previous) => {
        const target = index + direction;
        if (target < 0 || target >= previous.length) return previous;
        const next = [...previous];
        const [moved] = next.splice(index, 1);
        if (moved) next.splice(target, 0, moved);
        return next;
      });
      run.reset();
    },
    [run],
  );

  const removeAt = useCallback(
    (index: number) => {
      setFiles((previous) => previous.filter((_, i) => i !== index));
      run.reset();
    },
    [run],
  );

  const clear = useCallback(() => {
    setFiles([]);
    run.reset();
  }, [run]);

  const onRun = useCallback(() => {
    markStarted();
    void run.start(
      async (ctx) => {
        const specs: PdfPageSpec[] = [];
        // Points, from millimetres. `fit` pages get no margin: a page sized to
        // its own picture with a margin is a page that is not the size of its
        // picture, which is not what the option says.
        const marginPt = pageSize === 'fit' ? 0 : (marginMm * 72) / 25.4;

        for (let index = 0; index < files.length; index += 1) {
          await ctx.checkpoint();
          const file = files[index];
          if (!file) continue;

          const bytes = new Uint8Array(await file.arrayBuffer());
          const sniffed = sniffImage(bytes);

          let source: PdfImageSource | null = null;

          if (sniffed.format === 'jpeg') {
            // The whole point: the bitstream goes in untouched.
            const parsed = parseJpeg(bytes);
            if (parsed.ok) {
              source = {
                kind: 'jpeg',
                bytes,
                width: parsed.info.width,
                height: parsed.info.height,
              };
            }
            // A JPEG the parser declines falls through to the decode path
            // below rather than failing: the browser may still open it.
          }

          if (source === null) {
            const decoded = await decodeImage(file, { signal: ctx.signal });
            if (!decoded.ok) return { ok: false, error: decoded.error, reason: decoded.reason };
            try {
              const pixels = readPixels(decoded.image);
              if (!pixels.ok) return { ok: false, error: pixels.error, reason: pixels.reason };
              source = {
                kind: 'raw',
                // Copied out of the clamped array rather than aliasing its
                // buffer: `data` may be a view onto a larger canvas scratch
                // buffer, and handing the writer a view of the wrong length
                // produces a page of noise.
                bytes: new Uint8Array(pixels.data),
                width: pixels.size.width,
                height: pixels.size.height,
                components: 4,
                hasAlpha: true,
              };
            } finally {
              decoded.image.close();
            }
          }

          const size = resolvePageSize(pageSize, orientation, source);
          specs.push({
            size,
            image: source,
            placement: placeImage(source, size, { fit, marginPt }),
          });

          ctx.report(index + 1, files.length);
        }

        // `CompressionStream` rather than a bundled deflate implementation:
        // every current browser has one, and shipping ~30 KB of zlib to do what
        // the platform already does would be paid for by every visitor. The
        // guard is for the handful of engines that still lack it — a thrown
        // constructor error would surface as "something went wrong", which
        // tells the user nothing they can act on.
        let deflate;
        try {
          deflate = browserDeflate();
        } catch {
          return {
            ok: false as const,
            error:
              'This browser cannot compress PDF data. Chrome, Edge, Firefox and Safari 16.4 or newer all can — try one of those.',
            reason: 'encode_unsupported' as const,
          };
        }

        const result = await writePdf(specs, {
          deflate,
          meta: { creator: brand.name, title: pdfName(files) },
        });
        if (!result.ok) return { ok: false, error: result.error, reason: 'unknown' as const };

        return {
          ok: true as const,
          value: { bytes: result.bytes, pages: specs.length, name: pdfName(files) },
        };
      },
      { count: files.length },
    );
  }, [files, fit, marginMm, markStarted, orientation, pageSize, run]);

  const fitNote = useMemo(
    () => FIT_CHOICES.find((choice) => choice.value === fit)?.note,
    [fit],
  );

  return (
    <ToolWorkspace
      label="Convert images to PDF"
      error={run.error}
      status={
        run.busy
          ? `Building page ${run.progress?.done ?? 0} of ${run.progress?.total ?? files.length}`
          : run.result
            ? `Done — ${run.result.pages} pages`
            : null
      }
    >
      <FileDropzone
        slug={SLUG}
        accept={RASTER_IMAGES_MANY}
        existing={files.length}
        disabled={run.busy}
        onFiles={addFiles}
      />

      {files.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              {files.length} {files.length === 1 ? 'page' : 'pages'}, in this order
            </p>
            <Button variant="ghost" size="sm" iconLeft="trash" onClick={clear} disabled={run.busy}>
              Clear all
            </Button>
          </div>

          {/* An explicit ordered list with move controls rather than
              drag-and-drop reordering. Dragging needs a keyboard alternative to
              meet WCAG 2.5.7 anyway, and once the buttons exist they are the
              faster path on a phone as well. */}
          <ol className="divide-y divide-border rounded-lg border border-border">
            {files.map((file, index) => (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                className="flex items-center gap-2 p-2.5"
              >
                <span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-fg-muted">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-fg-muted">{humanBytes(file.size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  iconLeft="chevron-up"
                  aria-label={`Move ${file.name} earlier`}
                  disabled={run.busy || index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  iconLeft="chevron-down"
                  aria-label={`Move ${file.name} later`}
                  disabled={run.busy || index === files.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  iconLeft="x"
                  aria-label={`Remove ${file.name}`}
                  disabled={run.busy}
                  onClick={() => removeAt(index)}
                />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {files.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Page size" htmlFor="pdf-page-size">
              <Select
                id="pdf-page-size"
                value={pageSize}
                disabled={run.busy}
                onChange={(event) => setPageSize(event.target.value as PageSizeName)}
              >
                {PAGE_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Orientation"
              htmlFor="pdf-orientation"
              hint={
                orientation === 'auto'
                  ? 'A wide picture gets a landscape page, a tall one gets portrait.'
                  : undefined
              }
            >
              <Select
                id="pdf-orientation"
                value={orientation}
                disabled={run.busy || pageSize === 'fit'}
                onChange={(event) => setOrientation(event.target.value as Orientation)}
              >
                <option value="auto">Follow each image</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Select>
            </Field>

            <Field label="How the image sits" htmlFor="pdf-fit" hint={fitNote}>
              <Select
                id="pdf-fit"
                value={fit}
                disabled={run.busy}
                onChange={(event) => setFit(event.target.value as ImageFit)}
              >
                {FIT_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Margin"
              htmlFor="pdf-margin"
              labelSuffix={<span className="tabular">{pageSize === 'fit' ? '—' : `${marginMm} mm`}</span>}
              hint={
                pageSize === 'fit'
                  ? 'A page sized to its picture has no room for a margin.'
                  : 'White space around the picture on every side.'
              }
            >
              <Slider
                id="pdf-margin"
                min={0}
                max={40}
                step={1}
                value={marginMm}
                disabled={run.busy || pageSize === 'fit'}
                onChange={(event) => setMarginMm(Number(event.target.value))}
              />
            </Field>
          </div>

          <ToolRunBar
            label={`Build PDF (${files.length} ${files.length === 1 ? 'page' : 'pages'})`}
            busy={run.busy}
            disabled={files.length === 0}
            progress={run.progress}
            progressLabel={(progress) => `Page ${progress.done} of ${progress.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Up to 50 images. JPEGs are copied in without re-encoding, so photographs keep their quality exactly."
          />
        </>
      ) : null}

      {run.result ? (
        <ToolResult
          slug={SLUG}
          title="PDF ready"
          summary={
            <>
              {run.result.pages} {run.result.pages === 1 ? 'page' : 'pages'} ·{' '}
              {humanBytes(run.result.bytes.length)} ·{' '}
              {pageSize === 'fit' ? 'pages sized to each image' : PAGE_SIZES[pageSize] ? pageSize.toUpperCase() : ''}
            </>
          }
          download={{
            label: 'Download PDF',
            format: 'pdf',
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
              return downloadBytes(output.bytes, output.name, 'application/pdf');
            },
          }}
          onUseAgain={clear}
          useAgainLabel="Start over"
        >
          <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken p-3 text-sm text-fg-muted">
            <Icon name="file-pdf" size={18} className="shrink-0 text-fg-subtle" />
            {run.result.name}
          </p>
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}

/**
 * Name the document after the first image, so a folder of `scan-01.jpg`…
 * becomes `scan-01.pdf` rather than the anonymous `document.pdf` that every
 * other converter produces and that becomes `document (4).pdf` by Thursday.
 */
function pdfName(files: readonly File[]): string {
  const first = files[0];
  if (!first) return 'images.pdf';
  const dot = first.name.lastIndexOf('.');
  const base = dot > 0 ? first.name.slice(0, dot) : first.name;
  return `${safeBaseName(base, { fallback: 'images' })}.pdf`;
}
