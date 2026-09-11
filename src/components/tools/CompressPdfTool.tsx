'use client';

/**
 * ============================================================================
 * COMPRESS PDF
 * ============================================================================
 * The most-searched PDF operation and the one most often done dishonestly.
 *
 * ── There are two different jobs behind one word ──────────────────────────
 * "Compress a PDF" means two incompatible things depending on what is inside
 * the file, and a tool that offers one slider for both is lying to half its
 * users.
 *
 * A document produced by a word processor is text: glyph positions, font
 * subsets, vector drawing. There is very little to squeeze, and the only safe
 * savings come from repacking the file's internal structure — worth a few per
 * cent, occasionally twenty, and it never changes a pixel.
 *
 * A scan is a photograph of paper wrapped in a PDF. It is usually enormous
 * because it holds full-resolution images, and re-encoding those at a sensible
 * DPI routinely takes 20 MB to under 2 MB. But doing that means redrawing each
 * page as a picture, which destroys the text layer if there was one.
 *
 * So the tool asks which kind of document it is holding, in those terms, and
 * says plainly what each choice costs. "Rebuild" is not offered as a default,
 * and its consequence is stated above the button rather than in a footnote.
 *
 * ── It never returns a larger file ────────────────────────────────────────
 * Same guarantee as the image compressor, for the same reason: a tool called
 * "compress" that hands back something bigger has damaged the input. If neither
 * mode wins, the original is returned untouched and the result says so.
 *
 * ── Physical page size is preserved through a rebuild ─────────────────────
 * Rendering produces pixels; a PDF page is measured in points. Passing the
 * render DPI to `resolvePageSize('fit', …)` converts back, so an A4 page comes
 * out A4 rather than becoming a poster because it was rendered at 150 DPI.
 * Getting this wrong is the classic rebuild bug — the document looks right on
 * screen and prints at the wrong size.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { cn } from '@/lib/cn';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import { savingsSummary } from '@/lib/tools/image/format';
import { placeImage, resolvePageSize } from '@/lib/tools/pdf/pages';
import { readPdfInfo, renderPdfPages } from '@/lib/tools/pdf/render';
import { browserDeflate, writePdf, type PdfPageSpec } from '@/lib/tools/pdf/writer';

const SLUG = 'compress-pdf';

type Mode = 'lossless' | 'rebuild';

/** DPI options for a rebuild, named for the outcome rather than the number. */
const REBUILD_LEVELS = [
  { dpi: 96, label: 'Smallest — fine for reading on screen' },
  { dpi: 150, label: 'Balanced — still sharp, much smaller' },
  { dpi: 220, label: 'Careful — close to the original, modest saving' },
];

interface Opened {
  file: File;
  pageCount: number;
  baseName: string;
}

interface Output {
  bytes: Uint8Array;
  name: string;
  before: number;
  after: number;
  mode: Mode;
  keptOriginal: boolean;
}

export function CompressPdfTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<Mode>('lossless');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(72);

  const run = useToolRun<Output>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const onFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      markStarted();
      run.reset();
      setOpenError(null);
      setOpened(null);
      setOpening(true);

      void (async () => {
        const info = await readPdfInfo(file);
        if (!info.ok) {
          setOpenError(info.error);
          setOpening(false);
          return;
        }
        const dot = file.name.lastIndexOf('.');
        setOpened({
          file,
          pageCount: info.pageCount,
          baseName: safeBaseName(dot > 0 ? file.name.slice(0, dot) : file.name, {
            fallback: 'document',
          }),
        });
        setOpening(false);
      })();
    },
    [markStarted, run],
  );

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();

    void run.start(
      async (ctx) => {
        const before = opened.file.size;

        /* ── Lossless: repack the file, change nothing on any page ───────── */
        if (mode === 'lossless') {
          const { PDFDocument } = await import('pdf-lib');
          await ctx.checkpoint();
          const doc = await PDFDocument.load(await opened.file.arrayBuffer());

          // Producer metadata is the one thing safe to drop: it names whatever
          // wrote the file and is worth a few hundred bytes.
          doc.setProducer('');
          doc.setCreator('');

          // `useObjectStreams` is where the saving comes from — it packs many
          // small objects into one compressed stream. It is off elsewhere in
          // this codebase for maximum reader compatibility; here it is the
          // entire point, and every reader from the last fifteen years is fine.
          const bytes = await doc.save({ useObjectStreams: true });
          ctx.report(1, 1);

          const kept = bytes.length >= before;
          return {
            ok: true as const,
            value: {
              bytes: kept ? new Uint8Array(await opened.file.arrayBuffer()) : bytes,
              name: kept ? opened.file.name : `${opened.baseName}-compressed.pdf`,
              before,
              after: kept ? before : bytes.length,
              mode,
              keptOriginal: kept,
            },
          };
        }

        /* ── Rebuild: draw every page and re-encode it as a JPEG ─────────── */
        const rendered = await renderPdfPages(
          opened.file,
          { format: 'image/jpeg', quality: quality / 100, dpi },
          ctx,
        );
        if (!rendered.ok) return { ok: false, error: rendered.error, reason: rendered.reason };

        let deflate;
        try {
          deflate = browserDeflate();
        } catch {
          return {
            ok: false as const,
            error:
              'This browser cannot compress PDF data. Chrome, Edge, Firefox and Safari 16.4 or newer all can.',
            reason: 'encode_unsupported' as const,
          };
        }

        const specs: PdfPageSpec[] = rendered.pages.map((page) => {
          const image = {
            kind: 'jpeg' as const,
            bytes: page.bytes,
            width: page.width,
            height: page.height,
          };
          // The DPI conversion that keeps an A4 page A4. See the header.
          const size = resolvePageSize('fit', 'auto', { ...image, dpi });
          return { size, image, placement: placeImage(image, size, { fit: 'contain', marginPt: 0 }) };
        });

        const built = await writePdf(specs, { deflate, meta: { title: opened.baseName } });
        if (!built.ok) return { ok: false, error: built.error, reason: 'unknown' as const };

        const kept = built.bytes.length >= before;
        return {
          ok: true as const,
          value: {
            bytes: kept ? new Uint8Array(await opened.file.arrayBuffer()) : built.bytes,
            name: kept ? opened.file.name : `${opened.baseName}-compressed.pdf`,
            before,
            after: kept ? before : built.bytes.length,
            mode,
            keptOriginal: kept,
          },
        };
      },
      { count: mode === 'rebuild' ? opened.pageCount : 1 },
    );
  }, [dpi, markStarted, mode, opened, quality, run]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    run.reset();
  }, [run]);

  const result = run.result;

  return (
    <ToolWorkspace
      label="Compress a PDF"
      error={run.error ?? openError}
      status={
        opening
          ? 'Reading the document'
          : run.busy
            ? mode === 'rebuild'
              ? `Rebuilding page ${run.progress?.done ?? 0} of ${run.progress?.total ?? 0}`
              : 'Repacking the document'
            : result
              ? 'Done'
              : null
      }
    >
      {!opened ? (
        <FileDropzone slug={SLUG} accept={PDF_ONE} disabled={opening} onFiles={onFiles} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
              <Icon name="file-pdf" size={18} className="shrink-0 text-fg-subtle" />
              <span className="truncate" title={opened.file.name}>
                {opened.file.name}
              </span>
              <span className="shrink-0">
                · {opened.pageCount} {opened.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                {humanBytes(opened.file.size)}
              </span>
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different file
            </Button>
          </div>

          {/* The choice is framed as "what kind of document is this", because
              that is the question the user can actually answer. */}
          <fieldset disabled={run.busy} className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium text-fg">What is in this PDF?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    id: 'lossless' as const,
                    title: 'Text, or I am not sure',
                    body: 'Repacks the file without touching a single page. Nothing is lost. Savings are usually modest.',
                  },
                  {
                    id: 'rebuild' as const,
                    title: 'Scanned pages or photos',
                    body: 'Redraws each page as an image at a lower resolution. Very large savings — and any selectable text is lost.',
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={mode === option.id}
                  onClick={() => setMode(option.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                    mode === option.id
                      ? 'border-accent-border bg-accent-subtle'
                      : 'border-border bg-surface hover:bg-surface-hover',
                  )}
                >
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      mode === option.id ? 'text-accent-fg' : 'text-fg',
                    )}
                  >
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{option.body}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {mode === 'rebuild' ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="How much detail to keep" htmlFor="cpdf-dpi" hint={`${dpi} DPI.`}>
                  <Select
                    id="cpdf-dpi"
                    value={String(dpi)}
                    disabled={run.busy}
                    onChange={(event) => setDpi(Number(event.target.value))}
                  >
                    {REBUILD_LEVELS.map((level) => (
                      <option key={level.dpi} value={level.dpi}>
                        {level.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Image quality"
                  htmlFor="cpdf-quality"
                  labelSuffix={<span className="tabular">{quality}</span>}
                  hint="Lower is smaller. Below about 60, text in a scan starts to look furry."
                >
                  <Slider
                    id="cpdf-quality"
                    min={40}
                    max={95}
                    step={1}
                    value={quality}
                    disabled={run.busy}
                    onChange={(event) => setQuality(Number(event.target.value))}
                  />
                </Field>
              </div>

              {/* Above the button, not in a footnote. */}
              <Alert variant="warning" title="This changes the document">
                Every page becomes a picture. Text stops being selectable and searchable, and the
                change cannot be undone from the result — keep your original.
              </Alert>
            </>
          ) : null}

          <ToolRunBar
            label="Compress PDF"
            busy={run.busy}
            progress={run.progress}
            progressLabel={(p) => `Page ${p.done} of ${p.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Your document is never uploaded — all of this happens on your device."
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={SLUG}
          title={result.keptOriginal ? 'Already as small as it gets' : 'Compressed PDF ready'}
          summary={
            result.keptOriginal
              ? `${humanBytes(result.before)} — nothing beat the original, so your file was returned unchanged.`
              : `${humanBytes(result.before)} → ${humanBytes(result.after)} · ${savingsSummary(result.before, result.after).sentence}`
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
          onUseAgain={reset}
          useAgainLabel="Start over"
        >
          {result.keptOriginal && result.mode === 'lossless' ? (
            <Alert variant="info">
              This document is mostly text, which leaves very little to squeeze. If it is a scan,
              try &ldquo;Scanned pages or photos&rdquo; instead — that is where the large savings
              are.
            </Alert>
          ) : null}
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}
