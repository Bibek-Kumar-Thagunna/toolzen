'use client';

/**
 * ============================================================================
 * EXTRACT TEXT FROM A PDF
 * ============================================================================
 * Get the words out of a document so they can go somewhere a PDF cannot.
 *
 * ── The failure this tool has to explain, not hide ────────────────────────
 * Roughly half the PDFs people bring to a text extractor are scans, and a scan
 * contains no text at all — only a picture of text. Every glyph a person can
 * see is invisible to any extractor, and the honest result is nothing.
 *
 * A tool that returns an empty box there looks broken. So an empty result is
 * treated as a finding rather than a failure: the run succeeds, the page count
 * with no text layer is reported, and the message says the document is a scan
 * and needs OCR — which this tool does not pretend to do.
 *
 * ── Why page markers are optional and off by default ──────────────────────
 * Someone pasting a paragraph into an email wants the paragraph. Someone
 * pulling a forty-page report into a notes app wants to know where page 12
 * started. Both are common, neither is right for the other, and the setting is
 * one checkbox rather than a mode.
 *
 * ── Why the preview is a real textarea ────────────────────────────────────
 * The extracted text is the deliverable, and people edit it before using it —
 * dropping a header, fixing a hyphenated break. A read-only pre block forces a
 * round trip through another app to do that. The box is editable, and both Copy
 * and Download read the edited value rather than the original extraction.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadText } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import { parsePageRanges } from '@/lib/tools/pdf/ranges';
import { extractPdfText, readPdfInfo, type ExtractedPage } from '@/lib/tools/pdf/render';

const SLUG = 'extract-pdf-text';

interface Opened {
  file: File;
  pageCount: number;
  baseName: string;
}

interface Output {
  pages: ExtractedPage[];
  /** Pages that came back with nothing on them. */
  empty: number;
  text: string;
}

/** Join the pages into one document, with or without page markers. */
function assemble(pages: readonly ExtractedPage[], markers: boolean): string {
  return pages
    .map((page) => (markers ? `--- Page ${page.pageNumber} ---\n${page.text}` : page.text))
    .filter((block) => block.trim() !== '')
    .join('\n\n')
    .trim();
}

export function ExtractPdfTextTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [rangeText, setRangeText] = useState('');
  const [markers, setMarkers] = useState(false);
  // The edited value. Seeded from the extraction, then owned by the user.
  const [draft, setDraft] = useState('');

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
      setDraft('');
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

  const selection = (): number[] | undefined => {
    if (!opened || rangeText.trim() === '') return undefined;
    const parsed = parsePageRanges(rangeText, opened.pageCount);
    return parsed.ok ? parsed.pages : undefined;
  };

  const blocked = ((): string | null => {
    if (!opened || rangeText.trim() === '') return null;
    const parsed = parsePageRanges(rangeText, opened.pageCount);
    return parsed.ok ? null : parsed.error;
  })();

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();
    const pages = selection();

    void run.start(
      async (ctx) => {
        const extracted = await extractPdfText(opened.file, ctx, pages ? { pages } : {});
        if (!extracted.ok) {
          return { ok: false as const, error: extracted.error, reason: extracted.reason };
        }
        const text = assemble(extracted.pages, markers);
        setDraft(text);
        return {
          ok: true as const,
          value: {
            pages: extracted.pages,
            empty: extracted.pages.filter((page) => page.text === '').length,
            text,
          },
        };
      },
      { count: pages?.length ?? opened.pageCount },
    );
    // `selection` reads current state on every call; listing it would need a
    // memo that buys nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markStarted, markers, opened, rangeText, run]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    setDraft('');
    run.reset();
  }, [run]);

  const result = run.result;
  const nothingFound = result !== null && result.empty === result.pages.length;
  const words = draft.trim() === '' ? 0 : draft.trim().split(/\s+/).length;

  return (
    <ToolWorkspace
      label="Extract text from a PDF"
      error={run.error ?? openError}
      status={
        opening
          ? 'Reading the document'
          : run.busy
            ? 'Reading the text layer'
            : result
              ? nothingFound
                ? 'No text layer found'
                : 'Done'
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Pages"
              htmlFor="extract-range"
              hint={`Leave blank for all ${opened.pageCount}. Or: 1-3, 7.`}
              error={blocked ?? undefined}
            >
              <Input
                id="extract-range"
                value={rangeText}
                disabled={run.busy}
                invalid={blocked !== null}
                placeholder="All pages"
                onChange={(event) => setRangeText(event.target.value)}
              />
            </Field>

            <Field
              label="Mark where each page starts"
              htmlFor="extract-markers"
              hint="Adds a — Page 3 — line between pages. Useful for long reports."
            >
              <div className="flex h-10 items-center">
                <Switch
                  id="extract-markers"
                  label="Mark where each page starts"
                  checked={markers}
                  disabled={run.busy}
                  onCheckedChange={setMarkers}
                />
              </div>
            </Field>
          </div>

          <ToolRunBar
            label="Extract text"
            busy={run.busy}
            disabled={blocked !== null}
            progress={run.progress}
            progressLabel={(p) => `Page ${p.done} of ${p.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Your document is read on your device — nothing is uploaded."
          />
        </>
      )}

      {result ? (
        nothingFound ? (
          // Not an error: the run worked, and this is what the document is.
          <Alert variant="warning" title="This document has no text in it">
            Every page came back empty, which means the pages are pictures — a scan or a photograph
            of paper. The words you can see are part of the image, so there is nothing for an
            extractor to read. Getting them out needs OCR, which recognises characters in an image;
            this tool does not do that.
          </Alert>
        ) : (
          <ToolResult
            slug={SLUG}
            title="Text extracted"
            summary={`${result.pages.length} ${result.pages.length === 1 ? 'page' : 'pages'} read · ${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}${result.empty > 0 ? ` · ${result.empty} ${result.empty === 1 ? 'page had' : 'pages had'} no text` : ''}`}
            copy={{ value: () => draft, label: 'Copy text', target: 'text' }}
            download={{
              label: 'Download .txt',
              format: 'txt',
              count: 1,
              deliver: () => downloadText(draft, `${opened?.baseName ?? 'document'}.txt`),
            }}
            onUseAgain={reset}
            useAgainLabel="Start over"
          >
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={16}
              monospace
              aria-label="Extracted text"
              className="min-h-64"
            />
            {result.empty > 0 ? (
              <Alert variant="info">
                {result.empty} {result.empty === 1 ? 'page' : 'pages'} had no text layer. Those are
                almost certainly scanned or image-only pages, and their words cannot be read without
                OCR.
              </Alert>
            ) : null}
          </ToolResult>
        )
      ) : null}
    </ToolWorkspace>
  );
}
