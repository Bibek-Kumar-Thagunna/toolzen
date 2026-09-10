'use client';

/**
 * ============================================================================
 * SPLIT PDF
 * ============================================================================
 * Take pages out of a document, or break it into one file per page.
 *
 * ── Two modes, because people arrive wanting two different things ─────────
 * "Extract" is the common case: pages 3 to 7 of a scanned contract, as one new
 * PDF. "One file per page" is the other: a bundle that needs to become separate
 * documents. Offering only the first means somebody runs it twelve times by
 * hand; offering only the second is useless for the contract.
 *
 * ── The page count is read before anything is chosen ──────────────────────
 * The document is loaded on drop, not on run, so the range box can say "of 12
 * pages" and refuse `1-50` with a message that names the real number. A range
 * field with no idea how long the document is can only validate after the work,
 * which is the wrong moment to learn you opened the wrong file.
 *
 * ── Ranges are parsed by a tested module ──────────────────────────────────
 * `parsePageRanges` lives in `src/lib/tools/pdf/ranges.ts` with eighteen tests
 * beside it. It is the piece of this tool most likely to be quietly wrong —
 * users count from 1, arrays from 0 — and a mistake there hands somebody the
 * wrong page of a contract without ever looking like a failure.
 *
 * ── Encryption is refused rather than worked around ───────────────────────
 * Same as the merge tool: `ignoreEncryption` would produce output that looks
 * like a PDF and contains nothing usable. A password-protected file gets a
 * sentence naming the problem and the fix.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes, downloadZip } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import { describePages, parsePageRanges } from '@/lib/tools/pdf/ranges';

const SLUG = 'split-pdf';

type Mode = 'extract' | 'each';

const MODES = [
  { id: 'extract', label: 'Extract pages' },
  { id: 'each', label: 'One file per page' },
];

interface Opened {
  file: File;
  pageCount: number;
  baseName: string;
}

interface SplitPart {
  name: string;
  bytes: Uint8Array;
}

interface SplitOutput {
  parts: SplitPart[];
  pages: number;
}

function isEncrypted(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /encrypt|password/i.test(message);
}

export function SplitPdfTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<Mode>('extract');
  const [rangeText, setRangeText] = useState('1-1');

  const run = useToolRun<SplitOutput>(SLUG);
  const markStarted = useToolStarted(SLUG);

  /**
   * Read the page count on drop.
   *
   * This is the one place the library is loaded eagerly-ish — the moment a file
   * arrives rather than when the button is pressed — because everything the
   * range field says depends on knowing how long the document is, and the user
   * is about to need it anyway.
   */
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
        try {
          const { PDFDocument } = await import('pdf-lib');
          const document = await PDFDocument.load(await file.arrayBuffer());
          const pageCount = document.getPageCount();
          if (pageCount === 0) {
            setOpenError('That document has no pages in it.');
            return;
          }
          const dot = file.name.lastIndexOf('.');
          setOpened({
            file,
            pageCount,
            baseName: safeBaseName(dot > 0 ? file.name.slice(0, dot) : file.name, {
              fallback: 'document',
            }),
          });
          setRangeText(pageCount === 1 ? '1' : `1-${Math.min(pageCount, 1)}`);
        } catch (cause) {
          setOpenError(
            isEncrypted(cause)
              ? 'This PDF is password-protected, so its pages cannot be read. Open it in your PDF reader, save an unprotected copy, and use that instead.'
              : 'That file could not be read as a PDF. It may be damaged, or it may not be a PDF despite the name.',
          );
        } finally {
          setOpening(false);
        }
      })();
    },
    [markStarted, run],
  );

  /** Live validation, so the button and the readout agree with the box. */
  const selection = useMemo(() => {
    if (!opened || mode !== 'extract') return null;
    return parsePageRanges(rangeText, opened.pageCount);
  }, [mode, opened, rangeText]);

  const rangeError = selection && !selection.ok ? selection.error : null;
  const chosen = selection && selection.ok ? selection.pages : [];

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();

    void run.start(
      async (ctx) => {
        const { PDFDocument } = await import('pdf-lib');
        await ctx.checkpoint();

        let source;
        try {
          source = await PDFDocument.load(await opened.file.arrayBuffer());
        } catch (cause) {
          return {
            ok: false as const,
            error: isEncrypted(cause)
              ? 'This PDF is password-protected, so its pages cannot be read.'
              : 'That file could not be read as a PDF.',
            reason: isEncrypted(cause)
              ? ('password_protected' as const)
              : ('corrupt_input' as const),
          };
        }

        const pageNumbers =
          mode === 'each'
            ? Array.from({ length: opened.pageCount }, (_, i) => i + 1)
            : (() => {
                const parsed = parsePageRanges(rangeText, opened.pageCount);
                return parsed.ok ? parsed.pages : [];
              })();

        if (pageNumbers.length === 0) {
          return {
            ok: false as const,
            error: 'No pages were selected.',
            reason: 'invalid_input' as const,
          };
        }

        const parts: SplitPart[] = [];

        if (mode === 'extract') {
          const out = await PDFDocument.create();
          // Page numbers are 1-based everywhere the user can see them; the
          // conversion to indices happens here, once, deliberately.
          const copied = await out.copyPages(
            source,
            pageNumbers.map((page) => page - 1),
          );
          for (const page of copied) out.addPage(page);
          parts.push({
            name: `${opened.baseName}-pages-${describePages(pageNumbers).replace(/[,\s]+/g, '_')}.pdf`,
            bytes: await out.save({ useObjectStreams: false }),
          });
          ctx.report(1, 1);
        } else {
          const width = String(opened.pageCount).length;
          for (let index = 0; index < pageNumbers.length; index += 1) {
            await ctx.checkpoint();
            const page = pageNumbers[index] as number;
            const out = await PDFDocument.create();
            const [copied] = await out.copyPages(source, [page - 1]);
            if (copied) out.addPage(copied);
            parts.push({
              // Zero-padded so twelve files sort correctly in a file manager —
              // otherwise page 10 lands between 1 and 2.
              name: `${opened.baseName}-page-${String(page).padStart(width, '0')}.pdf`,
              bytes: await out.save({ useObjectStreams: false }),
            });
            ctx.report(index + 1, pageNumbers.length);
          }
        }

        return { ok: true as const, value: { parts, pages: pageNumbers.length } };
      },
      { count: mode === 'each' ? opened.pageCount : 1 },
    );
  }, [markStarted, mode, opened, rangeText, run]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    run.reset();
  }, [run]);

  const result = run.result;
  const many = (result?.parts.length ?? 0) > 1;

  return (
    <ToolWorkspace
      label="Split a PDF"
      error={run.error ?? openError}
      status={
        opening
          ? 'Reading the document'
          : run.busy
            ? `Extracting page ${run.progress?.done ?? 0} of ${run.progress?.total ?? 0}`
            : result
              ? `Done — ${result.parts.length} ${result.parts.length === 1 ? 'file' : 'files'} ready`
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
                · {opened.pageCount} {opened.pageCount === 1 ? 'page' : 'pages'}
              </span>
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different file
            </Button>
          </div>

          <Tabs
            tabs={MODES}
            value={mode}
            onValueChange={(id) => {
              setMode(id as Mode);
              run.reset();
            }}
            ariaLabel="What to do with the document"
          >
            {mode === 'extract' ? (
              <Field
                label="Pages to take"
                htmlFor="split-range"
                error={rangeError}
                hint={
                  rangeError
                    ? undefined
                    : chosen.length > 0
                      ? `${chosen.length} ${chosen.length === 1 ? 'page' : 'pages'}: ${describePages(chosen)}`
                      : `Single pages and ranges, separated by commas — 1-3, 5, 8- for page 8 onwards. This document has ${opened.pageCount}.`
                }
              >
                <Input
                  id="split-range"
                  value={rangeText}
                  disabled={run.busy}
                  invalid={rangeError !== null}
                  placeholder="1-3, 5"
                  onChange={(event) => setRangeText(event.target.value)}
                />
              </Field>
            ) : (
              <Alert variant="info">
                Every page becomes its own PDF — {opened.pageCount}{' '}
                {opened.pageCount === 1 ? 'file' : 'files'}, delivered as a single ZIP so your
                browser does not block them.
              </Alert>
            )}
          </Tabs>

          <ToolRunBar
            label={mode === 'extract' ? 'Extract pages' : `Split into ${opened.pageCount} files`}
            busy={run.busy}
            disabled={mode === 'extract' && (rangeError !== null || chosen.length === 0)}
            progress={run.progress}
            progressLabel={(progress) => `Page ${progress.done} of ${progress.total}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="The original file is not changed, and nothing is uploaded — the pages are copied on your device."
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={SLUG}
          title={
            result.parts.length === 1
              ? 'Pages extracted'
              : `${result.parts.length} files ready`
          }
          summary={`${result.pages} ${result.pages === 1 ? 'page' : 'pages'} · ${humanBytes(
            result.parts.reduce((sum, part) => sum + part.bytes.length, 0),
          )}`}
          download={{
            label: many ? `Download all ${result.parts.length} as ZIP` : 'Download PDF',
            format: many ? 'zip' : 'pdf',
            count: result.parts.length,
            deliver: () => {
              const first = result.parts[0];
              if (!many && first) return downloadBytes(first.bytes, first.name, 'application/pdf');
              return downloadZip(
                result.parts.map((part) => ({ name: part.name, data: part.bytes })),
                opened?.baseName ?? 'pages',
              );
            },
          }}
          onUseAgain={reset}
          useAgainLabel="Start over"
        >
          {many ? (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {result.parts.map((part) => (
                <li key={part.name} className="flex items-center gap-2 p-2.5">
                  <Icon name="file-pdf" size={16} className="shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg" title={part.name}>
                    {part.name}
                  </span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {humanBytes(part.bytes.length)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}
