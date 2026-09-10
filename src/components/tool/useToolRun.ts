'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { toolTracker, type FailureReason } from '@/lib/analytics';
import { classifyFailure, isCancellation } from '@/lib/failure';
import { useWorkSignal } from './ToolActivity';

/**
 * ============================================================================
 * THE RUN LIFECYCLE
 * ============================================================================
 * Every tool on the site does the same five things around its engine call:
 * flip to a busy state, time the work, hold ad initialisation, translate the
 * outcome into something a person can read, and report a coarse event to
 * analytics. Written per tool, that is twenty-four chances to forget the ad hold,
 * mis-name an event, or let a raw exception message reach the interface.
 *
 * So it is written once, here, and each tool supplies only the part that is
 * actually its own — the job:
 *
 *   const run = useToolRun<CompressedImage[]>('image-compressor');
 *
 *   await run.start(async (ctx) => {
 *     const out: CompressedImage[] = [];
 *     for (const [i, file] of files.entries()) {
 *       await ctx.checkpoint();               // yields, and gives up if cancelled
 *       const encoded = await compress(file);
 *       if (!encoded.ok) return encoded;      // the engine's own sentence wins
 *       out.push(encoded.value);
 *       ctx.report(i + 1, files.length);
 *     }
 *     return { ok: true, value: out };
 *   }, { count: files.length });
 *
 * ── Two rules this hook exists to enforce ──────────────────────────────────
 * 1. The user is shown a sentence, never an exception. A thrown `TypeError` from
 *    a codec becomes a generic, honest line; only `error` strings that an engine
 *    deliberately wrote for a person are displayed. This is the "never expose
 *    technical errors" rule, implemented in the one place that sees exceptions.
 * 2. Analytics receives a `reason` code and nothing else. No message text, no
 *    file name, no exception detail — a failure reason is a category, and the
 *    category is all that is useful for finding a broken tool.
 *
 * Cancelling is not a failure the user needs told about: the interface returns
 * to idle with no error, and the only trace is a `processing_failed` event with
 * reason `cancelled`, which is how we distinguish "our bug" from "changed mind".
 * ============================================================================
 */

export type RunPhase = 'idle' | 'running' | 'done' | 'failed';

export interface RunProgress {
  done: number;
  total: number;
}

/** What a job is handed. */
export interface RunContext {
  signal: AbortSignal;
  /** Report progress through a batch. Ignored once the run is superseded. */
  report: (done: number, total: number) => void;
  /**
   * Hand the main thread back for one turn, and abandon the job if the user has
   * cancelled. A tight loop over twenty photos without this makes the tab
   * unresponsive — the spinner freezes, the cancel button does not respond, and
   * the browser may offer to kill the page.
   */
  checkpoint: () => Promise<void>;
}

/**
 * What a job returns. Engines already return this shape with their own field
 * names, so a tool's job function usually ends in one line of adaptation.
 * `reason` is optional only so that a trivially simple job can omit it; leaving
 * it out records the failure as `unknown`.
 */
export type RunOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; reason?: FailureReason };

export interface ToolRun<T> {
  phase: RunPhase;
  /** True while a job is in flight. Drives buttons, and the ad hold. */
  busy: boolean;
  result: T | null;
  /** A sentence for the user, or null. Never an exception message. */
  error: string | null;
  progress: RunProgress | null;
  start: (
    job: (ctx: RunContext) => Promise<RunOutcome<T>> | RunOutcome<T>,
    opts?: { count?: number },
  ) => Promise<void>;
  cancel: () => void;
  /** Back to idle, keeping nothing. This is what "Use again" calls. */
  reset: () => void;
}

/**
 * One turn of the event loop. A tight loop over twenty photos without this makes
 * the tab unresponsive: the spinner freezes, the cancel button does not answer,
 * and the browser may offer to kill the page.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function useToolRun<T>(slug: string): ToolRun<T> {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);

  const controller = useRef<AbortController | null>(null);
  // Every run gets a number. A late result from a superseded run is discarded
  // rather than overwriting the current one — the case where a user changes a
  // setting and re-runs before the first job has finished.
  const runId = useRef(0);
  const alive = useRef(true);

  const busy = phase === 'running';
  // Holding ad initialisation is not something a tool author should have to
  // remember, so it happens here, for every tool, automatically.
  useWorkSignal(busy);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Nobody is watching the result any more; stop the work.
      controller.current?.abort();
    };
  }, []);

  /** Abandon whatever is in flight and make its result unusable. */
  const abandon = useCallback((): boolean => {
    const wasRunning = controller.current !== null && !controller.current.signal.aborted;
    controller.current?.abort();
    controller.current = null;
    runId.current += 1;
    return wasRunning;
  }, []);

  const cancel = useCallback(() => {
    if (!abandon()) return;
    setPhase('idle');
    setProgress(null);
    setError(null);
    // Cancelling is recorded, because "users abandon this tool halfway" and
    // "this tool is broken" look identical without it.
    toolTracker(slug).processingFailed('cancelled');
  }, [abandon, slug]);

  const reset = useCallback(() => {
    if (abandon()) toolTracker(slug).processingFailed('cancelled');
    setPhase('idle');
    setResult(null);
    setError(null);
    setProgress(null);
  }, [abandon, slug]);

  const start = useCallback<ToolRun<T>['start']>(
    async (job, opts) => {
      const tracker = toolTracker(slug);
      // A run started while another is in flight supersedes it, and deliberately
      // reports nothing for the abandoned one: the user changed a setting and
      // re-ran, which is not a cancellation and not a failure. The new run will
      // report its own outcome.
      abandon();
      const id = runId.current;
      const local = new AbortController();
      controller.current = local;
      /** Is this still the run whose result anyone wants? */
      const current = () => alive.current && runId.current === id;

      const total = Math.max(1, opts?.count ?? 1);
      setPhase('running');
      setError(null);
      setResult(null);
      setProgress({ done: 0, total });
      tracker.processingStarted(opts?.count);
      const startedAt = performance.now();

      const fail = (message: string, reason: FailureReason) => {
        setPhase('failed');
        setProgress(null);
        setError(message);
        tracker.processingFailed(reason);
      };

      const ctx: RunContext = {
        signal: local.signal,
        report: (done, reportedTotal) => {
          if (current()) setProgress({ done, total: Math.max(done, reportedTotal) });
        },
        checkpoint: async () => {
          await yieldToBrowser();
          if (local.signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
        },
      };

      try {
        const outcome = await job(ctx);
        if (!current()) return;
        if (outcome.ok) {
          // Wrapped in a function because `T` may itself be a function type,
          // which React would otherwise treat as a state updater.
          setResult(() => outcome.value);
          setPhase('done');
          setProgress(null);
          tracker.processingCompleted(performance.now() - startedAt, opts?.count);
          return;
        }
        fail(outcome.error, outcome.reason ?? 'unknown');
      } catch (cause) {
        // A cancelled run has already been accounted for by `cancel`, and the
        // interface is already back at idle. Nothing to say.
        if (isCancellation(cause) || local.signal.aborted) return;
        if (!current()) return;
        const classified = classifyFailure(cause);
        fail(classified.error, classified.reason);
      } finally {
        if (controller.current === local) controller.current = null;
      }
    },
    [abandon, slug],
  );

  return { phase, busy, result, error, progress, start, cancel, reset };
}

/**
 * Fires `tool_started` once, on the first real interaction with a tool — the
 * first file added, the first character typed, the first control moved.
 *
 * Kept separate from `tool_view` (which the page fires on load) because the gap
 * between the two is the single most useful number the site produces: a tool with
 * many views and few starts has a copy or comprehension problem, and a tool with
 * many starts and few completions has a reliability problem. Neither is visible
 * from one event.
 *
 * Returns a function that is safe to call on every keystroke; only the first call
 * does anything.
 */
export function useToolStarted(slug: string): () => void {
  const fired = useRef(false);
  return useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    toolTracker(slug).started();
  }, [slug]);
}
