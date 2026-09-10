'use client';

/**
 * ============================================================================
 * PDF EDIT SHELL — the body of the page-level PDF tools
 * ============================================================================
 * "Rotate a PDF" and "Delete pages from a PDF" are the same tool wearing
 * different labels: open one document, show how many pages it has, take a page
 * selection, apply one `pdf-lib` operation, hand back a new file. The only
 * thing that differs is the operation and the controls above it.
 *
 * ── Why the original is never modified ────────────────────────────────────
 * Every operation here builds a *new* document and leaves the input untouched
 * in the queue. There is no undo in a browser tool and no version history, so
 * the safe default is that the thing you dropped in is still exactly what it
 * was — you can change the settings and run again as many times as you like.
 *
 * ── Why `pdf-lib` and not the writer in `src/lib/tools/pdf` ───────────────
 * That writer creates documents from images. These tools read documents other
 * software produced, which means following arbitrary object graphs and copying
 * pages with every resource they reference. `pdf-lib` already does it.
 *
 * ── Loaded on run, not on view ────────────────────────────────────────────
 * `import('pdf-lib')` happens inside the job. Somebody who lands here from a
 * search and reads the article without rotating anything never downloads it.
 *
 * ── Encryption is refused, never worked around ────────────────────────────
 * `ignoreEncryption` would produce a document that opens and contains garbage.
 * A password-protected file gets a sentence naming the problem and the fix.
 * ============================================================================
 */
import { useCallback, useState, type ReactNode } from 'react';

import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { PDF_ONE } from '@/lib/tools/accepts';
import { readPdfInfo } from '@/lib/tools/pdf/render';

/** What the loaded document looks like to a tool. */
export interface OpenedPdf {
  file: File;
  pageCount: number;
  baseName: string;
}

/** `PDFDocument` from pdf-lib, structurally. Avoids a top-level type import. */
type PdfLib = typeof import('pdf-lib');

export interface PdfEditShellProps {
  slug: string;
  /** Region label and run-button verb, e.g. "Rotate pages". */
  label: string;
  runLabel: string;
  /** Suffix added to the output name, e.g. '-rotated'. */
  suffix: string;
  /** Controls shown once a document is open. */
  controls: (opened: OpenedPdf, busy: boolean) => ReactNode;
  /** Blocks the run with this sentence when the settings are not usable yet. */
  blockedReason?: (opened: OpenedPdf) => string | null;
  /** The operation. Returns the bytes of a new document. */
  apply: (input: { lib: PdfLib; opened: OpenedPdf }) => Promise<
    { ok: true; bytes: Uint8Array; summary: string } | { ok: false; error: string }
  >;
  /** One line under the run button. */
  hint?: ReactNode;
}

function isEncrypted(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /encrypt|password/i.test(message);
}

interface Output {
  bytes: Uint8Array;
  summary: string;
  name: string;
}

export function PdfEditShell({
  slug,
  label,
  runLabel,
  suffix,
  controls,
  blockedReason,
  apply,
  hint,
}: PdfEditShellProps) {
  const [opened, setOpened] = useState<OpenedPdf | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const run = useToolRun<Output>(slug);
  const markStarted = useToolStarted(slug);

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
    void run.start(async (ctx) => {
      const lib = await import('pdf-lib');
      await ctx.checkpoint();
      try {
        const result = await apply({ lib, opened });
        if (!result.ok) return { ok: false, error: result.error, reason: 'invalid_input' as const };
        return {
          ok: true as const,
          value: {
            bytes: result.bytes,
            summary: result.summary,
            name: `${opened.baseName}${suffix}.pdf`,
          },
        };
      } catch (cause) {
        return {
          ok: false,
          error: isEncrypted(cause)
            ? 'This PDF is password-protected, so it cannot be changed. Save an unprotected copy from your PDF reader and use that instead.'
            : 'That document could not be read. It may be damaged, or not a PDF at all.',
          reason: isEncrypted(cause) ? ('password_protected' as const) : ('corrupt_input' as const),
        };
      }
    });
  }, [apply, markStarted, opened, run, suffix]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    run.reset();
  }, [run]);

  const blocked = opened && blockedReason ? blockedReason(opened) : null;
  const result = run.result;

  return (
    <ToolWorkspace
      label={label}
      error={run.error ?? openError}
      status={
        opening ? 'Reading the document' : run.busy ? runLabel : result ? 'Done — file ready' : null
      }
    >
      {!opened ? (
        <FileDropzone slug={slug} accept={PDF_ONE} disabled={opening} onFiles={onFiles} />
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

          {controls(opened, run.busy)}

          <ToolRunBar
            label={runLabel}
            busy={run.busy}
            disabled={blocked !== null}
            progress={run.progress}
            onRun={onRun}
            onCancel={run.cancel}
            hint={blocked ?? hint}
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={slug}
          title="Your PDF is ready"
          summary={`${result.summary} · ${humanBytes(result.bytes.length)}`}
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
          <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken p-3 text-sm text-fg-muted">
            <Icon name="file-pdf" size={18} className="shrink-0 text-fg-subtle" />
            {result.name}
          </p>
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}
