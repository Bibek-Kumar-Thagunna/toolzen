'use client';

/**
 * ============================================================================
 * PDF TO POWERPOINT
 * ============================================================================
 * Every page becomes a slide — as a picture of the page.
 *
 * ── The honest framing, stated before the button ──────────────────────────
 * This is the tool most often oversold on the web. "PDF to PPTX" is usually
 * advertised as though it hands back editable slides, with the text in real
 * text boxes and the shapes as real shapes. Doing that means reverse-engineering
 * a layout back out of a page description — deciding which glyph runs are a
 * heading, which lines belong to one paragraph, which rectangles are a table —
 * and it goes wrong constantly, in ways you only discover halfway through
 * presenting.
 *
 * What this does instead is exact: each page is rendered and placed on its own
 * slide as an image. Nothing moves, nothing reflows, and the slide looks
 * precisely like the page. The text is not editable, and the page says so above
 * the button rather than in the small print afterwards.
 *
 * That is genuinely the job for the common case — someone handed a PDF who has
 * to present it, wants to reorder pages, drop a few, or draw on them while
 * talking.
 *
 * ── Why the DPI matters more here than for images ─────────────────────────
 * The rendered page is displayed at full screen size on a projector, so it is
 * enlarged far past its size on a laptop. 150 DPI is comfortable; below about
 * 110 the text starts to look soft in a large room.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import {
  SLIDE_SIZES,
  writePptx,
  type PptxImage,
  type SlideSizeName,
} from '@/lib/tools/office/pptx';
import { parsePageRanges } from '@/lib/tools/pdf/ranges';
import { readPdfInfo, renderPdfPages } from '@/lib/tools/pdf/render';

const SLUG = 'pdf-to-pptx';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Named for the outcome, not the number. See the header on why 150 is the floor. */
const QUALITY_LEVELS = [
  { dpi: 110, label: 'Smaller file — fine on a laptop screen' },
  { dpi: 150, label: 'Balanced — sharp on a projector' },
  { dpi: 220, label: 'Sharpest — for detailed diagrams and small print' },
];

interface Opened {
  file: File;
  pageCount: number;
  baseName: string;
}

interface Output {
  bytes: Uint8Array;
  name: string;
  slides: number;
}

export function PdfToPptxTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [size, setSize] = useState<SlideSizeName | 'page'>('page');
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
            fallback: 'presentation',
          }),
        });
        setOpening(false);
      })();
    },
    [markStarted, run],
  );

  const blocked = ((): string | null => {
    if (!opened || rangeText.trim() === '') return null;
    const parsed = parsePageRanges(rangeText, opened.pageCount);
    return parsed.ok ? null : parsed.error;
  })();

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();

    const pages =
      rangeText.trim() === ''
        ? undefined
        : (() => {
            const parsed = parsePageRanges(rangeText, opened.pageCount);
            return parsed.ok ? parsed.pages : undefined;
          })();

    void run.start(
      async (ctx) => {
        const rendered = await renderPdfPages(
          opened.file,
          { format: 'image/jpeg', quality: 0.85, dpi, ...(pages ? { pages } : {}) },
          ctx,
        );
        if (!rendered.ok) return { ok: false, error: rendered.error, reason: rendered.reason };

        const images: PptxImage[] = rendered.pages.map((page) => ({
          kind: 'jpeg' as const,
          bytes: page.bytes,
          width: page.width,
          height: page.height,
        }));

        const deck = writePptx(images, {
          // 'fit' shapes the deck to the first page, which is what keeps an A4
          // document from being letterboxed onto a 16:9 slide.
          ...(size === 'page' ? { fit: 'fit' as const } : { size, fit: 'contain' as const }),
        });
        if (!deck.ok) return { ok: false as const, error: deck.error, reason: 'unknown' as const };

        return {
          ok: true as const,
          value: {
            bytes: deck.bytes,
            name: `${opened.baseName}.pptx`,
            slides: images.length,
          },
        };
      },
      { count: pages?.length ?? opened.pageCount },
    );
  }, [dpi, markStarted, opened, rangeText, run, size]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    run.reset();
  }, [run]);

  const result = run.result;

  return (
    <ToolWorkspace
      label="PDF to PowerPoint"
      error={run.error ?? openError}
      status={
        opening
          ? 'Reading the document'
          : run.busy
            ? `Rendering page ${run.progress?.done ?? 0} of ${run.progress?.total ?? 0}`
            : result
              ? 'Done — presentation ready'
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Slide shape" htmlFor="pptx-shape">
              <Select
                id="pptx-shape"
                value={size}
                disabled={run.busy}
                onChange={(event) => setSize(event.target.value as SlideSizeName | 'page')}
              >
                <option value="page">Match the pages</option>
                {(Object.keys(SLIDE_SIZES) as SlideSizeName[]).map((name) => (
                  <option key={name} value={name}>
                    {SLIDE_SIZES[name].label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Sharpness" htmlFor="pptx-dpi" hint={`${dpi} DPI.`}>
              <Select
                id="pptx-dpi"
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
              label="Pages"
              htmlFor="pptx-pages"
              hint={`Blank for all ${opened.pageCount}. Or: 1-5, 9.`}
              error={blocked ?? undefined}
            >
              <Input
                id="pptx-pages"
                value={rangeText}
                disabled={run.busy}
                invalid={blocked !== null}
                placeholder="All pages"
                onChange={(event) => setRangeText(event.target.value)}
              />
            </Field>
          </div>

          {/* Above the button, not underneath the result. */}
          <Alert variant="info" title="Each slide is a picture of the page">
            The layout will be exactly right and the text will not be editable. Converting a PDF
            back into editable shapes and text boxes means guessing at the original layout, and
            that guess is wrong often enough that it is not worth the surprise mid-presentation.
          </Alert>

          <ToolRunBar
            label="Build presentation"
            busy={run.busy}
            disabled={blocked !== null}
            progress={run.progress}
            progressLabel={(p) => `Page ${p.done} of ${p.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint={blocked ?? 'Your document is never uploaded — the pages are drawn on your device.'}
          />
        </>
      )}

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
        />
      ) : null}
    </ToolWorkspace>
  );
}
