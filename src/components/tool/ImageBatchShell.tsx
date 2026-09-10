'use client';

/**
 * ============================================================================
 * IMAGE BATCH SHELL
 * ============================================================================
 * The complete interface for a tool that takes images in and gives images back:
 * drop zone, queue, controls, run button, progress, result, downloads.
 *
 * Six tools use it — compress, resize, crop, and the three converters — and
 * they differ only in the controls they render and the `EncodeOptions` they
 * produce per file. Everything else on the page is here, which is why the six
 * of them are a few hundred lines rather than a few thousand, and why a fix to
 * the download path or the queue is a fix in all six.
 *
 * ── Headers are read on drop, not on run ──────────────────────────────────
 * `useSniffedImages` reads the first 64 KB of each file the moment it arrives.
 * That is enough for JPEG's SOF, PNG's IHDR, GIF's screen descriptor and WebP's
 * VP8 header to state the pixel dimensions, so the queue can show "3024 × 4032"
 * and a resizer can offer a real percentage within milliseconds — without
 * decoding twenty photographs into hundreds of megabytes of bitmap to learn
 * something the first few bytes already said.
 *
 * ── Files and controls survive a run ──────────────────────────────────────
 * Nothing is cleared when a result arrives. That is what makes "move the
 * slider, look again" possible, and it is the single most useful behaviour in a
 * tool like this. The consequence is that a stale result must never be
 * mistakable for the current settings, which is why every tool passes a
 * `summary` that names the settings that produced what is on screen.
 *
 * ── One download control, whatever the count ──────────────────────────────
 * One file downloads as itself; several download as a ZIP. Twenty separate
 * programmatic downloads is not the alternative — browsers treat a burst of
 * them as an attack and silently drop all but the first, so the user gets one
 * file out of twenty and no explanation.
 *
 * The whole surface is inside `ToolWorkspace`, which is an `AdFreeZone`: no ad
 * can render among these controls, structurally, whatever anyone adds later.
 * ============================================================================
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/Alert';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes, downloadZip } from '@/lib/files/download';
import type { AcceptSpec } from '@/lib/registry/types';
import { sniffImage, type Sniffed } from '@/lib/tools/image/format';
import { runImageBatch, type ImageBatchResult, type ImagePlan, type PlanInput } from '@/lib/tools/image/batch';

import { FileDropzone } from './FileDropzone';
import { FilePreview } from './FilePreview';
import { ToolResult } from './ToolResult';
import { ToolRunBar } from './ToolRunBar';
import { ToolWorkspace } from './ToolWorkspace';
import { useToolRun, useToolStarted } from './useToolRun';

/** A file plus what its header said, keyed by identity so it survives reorders. */
export interface SniffedFile {
  file: File;
  sniffed: Sniffed | null;
}

/**
 * Read every queued file's header once.
 *
 * Keyed on name/size/lastModified rather than the `File` object: React may hand
 * back a new array on every render while the underlying files are the same, and
 * re-reading twenty headers per keystroke would be visible.
 */
function useSniffedImages(files: readonly File[]): Map<string, Sniffed> {
  const [map, setMap] = useState<Map<string, Sniffed>>(new Map());

  const keys = files.map(fileKey).join('|');

  useEffect(() => {
    let live = true;
    void (async () => {
      const next = new Map<string, Sniffed>();
      for (const file of files) {
        try {
          const head = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
          next.set(fileKey(file), sniffImage(head));
        } catch {
          // An unreadable header is not an error the queue should report: the
          // run itself will say something specific and useful about this file.
        }
      }
      if (live) setMap(next);
    })();
    return () => {
      live = false;
    };
    // `keys` is the real dependency; `files` is referenced inside and is stable
    // for a given `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  return map;
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export interface ImageBatchShellProps {
  slug: string;
  /** Names the region for assistive technology, e.g. "Compress images". */
  label: string;
  accept: AcceptSpec;
  /** The verb on the button. */
  runLabel: string;
  /** ZIP base name when several files come back. */
  archiveLabel: string;
  /**
   * The tool's own controls, rendered between the queue and the run button.
   * Receives the sniffed queue so a control can show a real estimate.
   */
  controls?: (queue: SniffedFile[], busy: boolean) => ReactNode;
  /** Per file: the encode options and output name, or a reason to skip. */
  plan: (input: PlanInput) => ImagePlan;
  /** Headline on the result panel, e.g. "20 images compressed". */
  title?: (result: ImageBatchResult) => string;
  /** One line naming the settings that produced this result. */
  summary?: (result: ImageBatchResult) => ReactNode;
  /** A short line under the run button: a limit, a caveat. */
  hint?: ReactNode;
  /** Extra rows under each queued file. */
  note?: (file: File, sniffed: Sniffed | null) => ReactNode;
  /** Blocks the run with this sentence — an invalid width, say. */
  blockedReason?: string | null;
}

export function ImageBatchShell({
  slug,
  label,
  accept,
  runLabel,
  archiveLabel,
  controls,
  plan,
  title,
  summary,
  hint,
  note,
  blockedReason = null,
}: ImageBatchShellProps) {
  const [files, setFiles] = useState<File[]>([]);
  const run = useToolRun<ImageBatchResult>(slug);
  const markStarted = useToolStarted(slug);
  const sniffs = useSniffedImages(files);

  const queue = useMemo<SniffedFile[]>(
    () => files.map((file) => ({ file, sniffed: sniffs.get(fileKey(file)) ?? null })),
    [files, sniffs],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      markStarted();
      setFiles((previous) => [...previous, ...incoming].slice(0, accept.maxFiles));
      // A queue change invalidates the result on screen. Keeping it would leave
      // "20 images compressed" above a queue of 21.
      run.reset();
    },
    [accept.maxFiles, markStarted, run],
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
    void run.start((ctx) => runImageBatch(files, ctx, plan), { count: files.length });
  }, [files, markStarted, plan, run]);

  const result = run.result;
  const many = (result?.outputs.length ?? 0) > 1;

  return (
    <ToolWorkspace
      label={label}
      error={run.error}
      status={
        run.busy
          ? `${runLabel} — ${run.progress?.done ?? 0} of ${run.progress?.total ?? files.length}`
          : result
            ? `Done — ${result.outputs.length} ${result.outputs.length === 1 ? 'file' : 'files'} ready`
            : null
      }
    >
      <FileDropzone
        slug={slug}
        accept={accept}
        existing={files.length}
        disabled={run.busy}
        onFiles={addFiles}
      />

      {files.length > 0 ? (
        <FilePreview
          files={files}
          onRemove={removeAt}
          onClear={clear}
          disabled={run.busy}
          note={note ? (file) => note(file, sniffs.get(fileKey(file)) ?? null) : undefined}
        />
      ) : null}

      {files.length > 0 && controls ? <div className="space-y-4">{controls(queue, run.busy)}</div> : null}

      {files.length > 0 ? (
        <>
          {blockedReason ? <Alert variant="warning">{blockedReason}</Alert> : null}
          <ToolRunBar
            label={runLabel}
            busy={run.busy}
            disabled={files.length === 0 || blockedReason !== null}
            progress={run.progress}
            progressLabel={(progress) => `${progress.done} of ${progress.total} done`}
            onRun={onRun}
            onCancel={run.cancel}
            hint={hint}
          />
        </>
      ) : null}

      {result ? (
        <ToolResult
          slug={slug}
          title={
            title?.(result) ??
            `${result.outputs.length} ${result.outputs.length === 1 ? 'image' : 'images'} ready`
          }
          summary={summary?.(result)}
          download={{
            label: many ? `Download all ${result.outputs.length} as ZIP` : 'Download',
            format: many ? 'zip' : (result.outputs[0]?.mime.split('/')[1] ?? 'image'),
            count: result.outputs.length,
            deliver: () => {
              const first = result.outputs[0];
              if (!many && first) return downloadBytes(first.bytes, first.name, first.mime);
              return downloadZip(
                result.outputs.map((out) => ({ name: out.name, data: out.bytes })),
                archiveLabel,
              );
            },
          }}
          onUseAgain={clear}
          useAgainLabel="Start over"
        >
          <OutputList result={result} />
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}

/**
 * The per-file breakdown under the download button.
 *
 * Each row carries its own download, because "I only wanted the third one" is a
 * real case and unzipping twenty files to get it is a poor answer. The rows are
 * a `<ul>` rather than a table: there are three facts per row and a table of
 * three columns on a 320px screen is a horizontal scroll for no gain.
 */
function OutputList({ result }: { result: ImageBatchResult }) {
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {result.outputs.map((out) => (
          <li key={out.name} className="flex items-center gap-3 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg" title={out.name}>
                {out.name}
              </p>
              <p className="text-xs text-fg-muted">
                {out.width} × {out.height} px · {humanBytes(out.originalSize)} →{' '}
                <span className="font-medium text-fg">{humanBytes(out.size)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const outcome = downloadBytes(out.bytes, out.name, out.mime);
                setFailed(outcome.ok ? null : outcome.error);
              }}
              className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-accent-fg transition-colors duration-fast hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Save
              {/* The name is in the accessible name, not just the row: twenty
                  buttons all called "Save" is twenty identical announcements. */}
              <span className="sr-only"> {out.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {failed ? <Alert variant="danger">{failed}</Alert> : null}

      {result.skipped.length > 0 ? (
        <Alert variant="warning" title={`${result.skipped.length} left out`}>
          <ul className="mt-1 space-y-1">
            {result.skipped.map((item) => (
              <li key={item.name}>
                <span className="font-medium">{item.name}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
