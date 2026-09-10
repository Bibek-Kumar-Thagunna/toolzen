'use client';

/**
 * ============================================================================
 * MERGE PDF
 * ============================================================================
 * Several documents become one, in the order shown, without leaving the tab.
 *
 * ── Why `pdf-lib` and not the writer in `src/lib/tools/pdf` ───────────────
 * That writer *creates* PDFs from images: it lays out pages and emits objects
 * we control from first principles. Merging is the opposite problem — it means
 * reading arbitrary documents somebody else produced, following their object
 * graphs, and copying pages along with every resource they transitively
 * reference: fonts, colour spaces, embedded files, annotations. Writing that
 * from scratch is a parser for the whole PDF specification, and getting it
 * subtly wrong loses a signature or a form field silently. `pdf-lib` already
 * does it, runs entirely in the browser, and `copyPages` is exactly this
 * operation.
 *
 * ── Loading is deferred until a file is added ─────────────────────────────
 * `import('pdf-lib')` inside the run, not at module scope. The library is a
 * few hundred kilobytes; somebody who lands on this page from a search and
 * reads the article without merging anything should never pay for it. By the
 * time the button is pressed they have already chosen files, so the download
 * overlaps with a decision they were making anyway.
 *
 * ── Encrypted documents fail with a sentence, not a stack trace ───────────
 * A password-protected PDF throws on load. That is the single most common
 * failure here — bank statements and payslips arrive encrypted as a matter of
 * course — so it is detected specifically and reported as what it is, with the
 * fix (remove the password in your PDF reader first). `ignoreEncryption` is
 * deliberately *not* used: it produces a merged file whose pages are garbage,
 * which is worse than a clear refusal.
 *
 * ── Order is the document ─────────────────────────────────────────────────
 * Same as images-to-PDF: the queue order is the output, so it is reorderable
 * with buttons that work on a phone and from a keyboard.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { PDF_MANY } from '@/lib/tools/accepts';

const SLUG = 'merge-pdf';

interface MergeOutput {
  bytes: Uint8Array;
  pages: number;
  sources: number;
}

/** Sentences for the two failures that actually happen, and one for the rest. */
function describeLoadFailure(name: string, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/encrypt|password/i.test(message)) {
    return `“${name}” is password-protected, so its pages cannot be read. Open it in your PDF reader, save an unprotected copy, and add that instead.`;
  }
  return `“${name}” could not be read as a PDF. It may be damaged, or it may not be a PDF despite the name.`;
}

export function MergePdfTool() {
  const [files, setFiles] = useState<File[]>([]);
  const run = useToolRun<MergeOutput>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const addFiles = useCallback(
    (incoming: File[]) => {
      markStarted();
      setFiles((previous) => [...previous, ...incoming].slice(0, PDF_MANY.maxFiles));
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
        const { PDFDocument } = await import('pdf-lib');
        await ctx.checkpoint();

        const merged = await PDFDocument.create();

        for (let index = 0; index < files.length; index += 1) {
          await ctx.checkpoint();
          const file = files[index];
          if (!file) continue;

          let source;
          try {
            source = await PDFDocument.load(await file.arrayBuffer());
          } catch (cause) {
            return {
              ok: false as const,
              error: describeLoadFailure(file.name, cause),
              reason: /encrypt|password/i.test(
                cause instanceof Error ? cause.message : String(cause),
              )
                ? ('password_protected' as const)
                : ('corrupt_input' as const),
            };
          }

          // `copyPages` walks each page's resource graph and brings the fonts,
          // images and colour spaces across with it. Pushing the page objects
          // over directly would produce a document with dangling references
          // that some readers render and others reject.
          const copied = await merged.copyPages(source, source.getPageIndices());
          for (const page of copied) merged.addPage(page);

          ctx.report(index + 1, files.length);
        }

        const pageCount = merged.getPageCount();
        if (pageCount === 0) {
          return {
            ok: false as const,
            error: 'None of those documents had any pages in them.',
            reason: 'corrupt_input' as const,
          };
        }

        return {
          ok: true as const,
          value: {
            // `useObjectStreams` off: the resulting file is slightly larger and
            // is readable by older tools that choke on cross-reference streams,
            // which is the right trade for a document somebody is about to send
            // to a bank or a government office.
            bytes: await merged.save({ useObjectStreams: false }),
            pages: pageCount,
            sources: files.length,
          },
        };
      },
      { count: files.length },
    );
  }, [files, markStarted, run]);

  return (
    <ToolWorkspace
      label="Merge PDF files"
      error={run.error}
      status={
        run.busy
          ? `Merging ${run.progress?.done ?? 0} of ${run.progress?.total ?? files.length}`
          : run.result
            ? `Done — ${run.result.pages} pages`
            : null
      }
    >
      <FileDropzone
        slug={SLUG}
        accept={PDF_MANY}
        existing={files.length}
        disabled={run.busy}
        onFiles={addFiles}
      />

      {files.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">
              {files.length} {files.length === 1 ? 'document' : 'documents'}, joined in this order
            </p>
            <Button variant="ghost" size="sm" iconLeft="trash" onClick={clear} disabled={run.busy}>
              Clear all
            </Button>
          </div>

          <ol className="divide-y divide-border rounded-lg border border-border">
            {files.map((file, index) => (
              <li
                key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                className="flex items-center gap-2 p-2.5"
              >
                <span className="w-6 shrink-0 text-center text-xs font-medium tabular-nums text-fg-muted">
                  {index + 1}
                </span>
                <Icon name="file-pdf" size={18} className="shrink-0 text-fg-subtle" />
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
        <ToolRunBar
          label={files.length < 2 ? 'Add another document to merge' : `Merge ${files.length} PDFs`}
          busy={run.busy}
          disabled={files.length < 2}
          progress={run.progress}
          progressLabel={(progress) => `${progress.done} of ${progress.total} added`}
          onRun={onRun}
          onCancel={run.cancel}
          hint="Up to 20 documents, 50 MB each. Bookmarks and form fields from the original files are not carried across."
        />
      ) : null}

      {run.result ? (
        <ToolResult
          slug={SLUG}
          title="Merged PDF ready"
          summary={`${run.result.pages} pages from ${run.result.sources} documents · ${humanBytes(run.result.bytes.length)}`}
          download={{
            label: 'Download merged PDF',
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
              return downloadBytes(output.bytes, 'merged.pdf', 'application/pdf');
            },
          }}
          onUseAgain={clear}
          useAgainLabel="Start over"
        />
      ) : null}
    </ToolWorkspace>
  );
}
