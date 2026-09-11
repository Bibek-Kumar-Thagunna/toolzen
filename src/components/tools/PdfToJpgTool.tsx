'use client';

/**
 * ============================================================================
 * PDF TO JPG
 * ============================================================================
 * Every page of a document, as a picture, without the document leaving the tab.
 *
 * ── DPI is the whole tool ─────────────────────────────────────────────────
 * Everything else here is a wrapper around one number. 150 DPI is the default
 * because it is the point where printed text stops looking soft on screen and
 * a page is still a sensible size to email; 72 is fine for a thumbnail and
 * hopeless for reading; 300 is what you want if the page is going to be printed
 * or run through OCR, and costs roughly four times the bytes.
 *
 * Rather than offer a slider of meaningless numbers, each option says what it
 * is *for*, and the estimated page size sits under it.
 *
 * ── Why JPEG is the default and PNG is offered ────────────────────────────
 * A scanned page is a photograph of paper: JPEG is right, and PNG of the same
 * page is routinely five times larger for no visible gain. A page of vector
 * text and line art is the opposite — PNG keeps the edges crisp where JPEG
 * puts a halo around every letter. The default matches the common case and the
 * note says when to switch.
 *
 * ── Pages come back as a ZIP ──────────────────────────────────────────────
 * Twenty separate downloads is not an alternative: browsers treat a burst of
 * programmatic downloads as an attack and drop all but the first. Each page
 * also gets its own Save button, because "I only wanted page 3" is the other
 * half of the use case.
 * ============================================================================
 */
import { useCallback, useEffect, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes, downloadZip } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import { parsePageRanges } from '@/lib/tools/pdf/ranges';
import { readPdfInfo, renderPdfPages, type RenderedPage } from '@/lib/tools/pdf/render';

const SLUG = 'pdf-to-jpg';

/** Named for the job, not the number. See the header. */
const QUALITY_LEVELS = [
  { dpi: 96, label: 'Screen — small files, fine for viewing' },
  { dpi: 150, label: 'Standard — sharp on screen, sensible size' },
  { dpi: 300, label: 'Print / OCR — large files, maximum detail' },
];

const FORMATS = [
  { value: 'image/jpeg', label: 'JPG — best for scans and photos', ext: 'jpg' },
  { value: 'image/png', label: 'PNG — best for text and line art', ext: 'png' },
  { value: 'image/webp', label: 'WebP — smallest, for the web', ext: 'webp' },
] as const;

type FormatValue = (typeof FORMATS)[number]['value'];

interface Opened {
  file: File;
  pageCount: number;
  baseName: string;
}

interface Output {
  pages: RenderedPage[];
  ext: string;
}

export function PdfToJpgTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [format, setFormat] = useState<FormatValue>('image/jpeg');
  const [quality, setQuality] = useState(85);
  const [rangeText, setRangeText] = useState('');

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
        setRangeText('');
        setOpening(false);
      })();
    },
    [markStarted, run],
  );

  /** Blank means every page, which is what somebody who ignores the box wants. */
  const selection =
    opened && rangeText.trim() !== '' ? parsePageRanges(rangeText, opened.pageCount) : null;
  const rangeError = selection && !selection.ok ? selection.error : null;

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();
    const chosen = FORMATS.find((f) => f.value === format);

    void run.start(
      async (ctx) => {
        const pages =
          rangeText.trim() === ''
            ? undefined
            : (() => {
                const parsed = parsePageRanges(rangeText, opened.pageCount);
                return parsed.ok ? parsed.pages : undefined;
              })();

        const result = await renderPdfPages(
          opened.file,
          {
            format,
            quality: format === 'image/png' ? undefined : quality / 100,
            dpi,
            pages,
          },
          ctx,
        );
        if (!result.ok) return { ok: false, error: result.error, reason: result.reason };
        return { ok: true as const, value: { pages: result.pages, ext: chosen?.ext ?? 'jpg' } };
      },
      { count: opened.pageCount },
    );
  }, [dpi, format, markStarted, opened, quality, rangeText, run]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    run.reset();
  }, [run]);

  const result = run.result;
  const many = (result?.pages.length ?? 0) > 1;
  const width = opened ? String(opened.pageCount).length : 1;
  const nameFor = (page: RenderedPage, ext: string) =>
    `${opened?.baseName ?? 'page'}-${String(page.pageNumber).padStart(width, '0')}.${ext}`;

  return (
    <ToolWorkspace
      label="Convert a PDF to images"
      error={run.error ?? openError}
      status={
        opening
          ? 'Reading the document'
          : run.busy
            ? `Rendering page ${run.progress?.done ?? 0} of ${run.progress?.total ?? 0}`
            : result
              ? `Done — ${result.pages.length} images ready`
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
              <span className="shrink-0">· {opened.pageCount} pages</span>
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different file
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Quality"
              htmlFor="pdfimg-dpi"
              hint={`${dpi} DPI. Higher is sharper and larger; 150 suits almost everything.`}
            >
              <Select
                id="pdfimg-dpi"
                value={String(dpi)}
                disabled={run.busy}
                onChange={(event) => setDpi(Number(event.target.value))}
              >
                {QUALITY_LEVELS.map((level) => (
                  <option key={level.dpi} value={level.dpi}>
                    {level.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Save as"
              htmlFor="pdfimg-format"
              hint={
                format === 'image/jpeg'
                  ? 'Right for scanned pages. Switch to PNG if the pages are mostly text or diagrams.'
                  : format === 'image/png'
                    ? 'Lossless and crisp on text, but several times larger than JPG on a scan.'
                    : 'Smallest of the three. Every current browser opens WebP; a few older apps do not.'
              }
            >
              <Select
                id="pdfimg-format"
                value={format}
                disabled={run.busy}
                onChange={(event) => setFormat(event.target.value as FormatValue)}
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>

            {format !== 'image/png' ? (
              <Field
                label="Image quality"
                htmlFor="pdfimg-quality"
                labelSuffix={<span className="tabular">{quality}</span>}
              >
                <Slider
                  id="pdfimg-quality"
                  min={40}
                  max={100}
                  step={1}
                  value={quality}
                  disabled={run.busy}
                  onChange={(event) => setQuality(Number(event.target.value))}
                />
              </Field>
            ) : null}

            <Field
              label="Pages"
              htmlFor="pdfimg-range"
              error={rangeError}
              hint={rangeError ? undefined : `Blank converts all ${opened.pageCount}. Or 1-3, 7.`}
            >
              <Input
                id="pdfimg-range"
                value={rangeText}
                disabled={run.busy}
                invalid={rangeError !== null}
                placeholder="all pages"
                onChange={(event) => setRangeText(event.target.value)}
              />
            </Field>
          </div>

          <ToolRunBar
            label="Convert to images"
            busy={run.busy}
            disabled={rangeError !== null}
            progress={run.progress}
            progressLabel={(p) => `Page ${p.done} of ${p.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Each page is drawn by your own browser. The document is never uploaded."
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={SLUG}
          title={`${result.pages.length} ${result.pages.length === 1 ? 'image' : 'images'} ready`}
          summary={`${humanBytes(result.pages.reduce((sum, p) => sum + p.bytes.length, 0))} in total · ${dpi} DPI`}
          download={{
            label: many ? `Download all ${result.pages.length} as ZIP` : 'Download image',
            format: many ? 'zip' : result.ext,
            count: result.pages.length,
            deliver: () => {
              const first = result.pages[0];
              if (!many && first) {
                return downloadBytes(first.bytes, nameFor(first, result.ext), first.mime);
              }
              return downloadZip(
                result.pages.map((p) => ({ name: nameFor(p, result.ext), data: p.bytes })),
                opened?.baseName ?? 'pages',
              );
            },
          }}
          onUseAgain={reset}
          useAgainLabel="Start over"
        >
          <PagePreviews pages={result.pages} ext={result.ext} nameFor={nameFor} />
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}

/**
 * A thumbnail grid with a Save control on each page.
 *
 * The object URLs are created in an effect and revoked in its cleanup, not
 * derived with `useMemo`. Creating one is a side effect that allocates, and it
 * has to be released: a fifty-page document at 300 DPI left with un-revoked
 * URLs pins every rendered page in memory for the life of the tab.
 */
function PagePreviews({
  pages,
  ext,
  nameFor,
}: {
  pages: RenderedPage[];
  ext: string;
  nameFor: (page: RenderedPage, ext: string) => string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const made = pages.map((page) =>
      URL.createObjectURL(new Blob([page.bytes.slice()], { type: page.mime })),
    );
    setUrls(made);
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [pages]);

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((page, index) => {
          const url = urls[index];
          return (
            <li
              key={page.pageNumber}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="flex aspect-[3/4] items-center justify-center bg-surface-sunken">
                {url === undefined ? null : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={`Page ${page.pageNumber}`}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-2.5 py-2">
                <span className="text-xs text-fg-muted">
                  Page {page.pageNumber} · {humanBytes(page.bytes.length)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const outcome = downloadBytes(page.bytes, nameFor(page, ext), page.mime);
                    setFailed(outcome.ok ? null : outcome.error);
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-accent-fg transition-colors duration-fast hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Save<span className="sr-only"> page {page.pageNumber}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {failed ? <Alert variant="danger">{failed}</Alert> : null}
    </div>
  );
}
