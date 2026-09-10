'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { RunProgress } from './useToolRun';

/**
 * ============================================================================
 * TOOL RUN BAR
 * ============================================================================
 * The one control that starts the work, and everything that belongs beside it
 * while the work is happening. Nine file tools need exactly this arrangement,
 * and writing it nine times is nine chances for the cancel button to go missing.
 *
 * ── Why cancel is a button and not a click on the progress bar ──────────────
 * Long client-side work on a phone is the case where a user changes their mind:
 * they picked twenty photos by accident, or the estimate is longer than they
 * expected. Without a cancel, their only exit is closing the tab, which loses
 * the queue. The bar therefore always offers it while busy, at full touch-target
 * size, and `useToolRun` treats the result as "returned to idle, nothing said" —
 * cancelling is not an error and is never reported as one.
 *
 * ── Why the label does not become a spinner ────────────────────────────────
 * `Button loading` keeps the text and swaps the left glyph, so the accessible
 * name is stable and the button does not change width mid-run. A control that
 * changes size while you are reaching for it is the classic mobile misclick.
 *
 * ── Why progress is optional ───────────────────────────────────────────────
 * A single-file job has nothing honest to show: a bar that animates to 90% and
 * waits is a lie about how far along the work is. Those tools pass no progress
 * and get the indeterminate bar, which claims only that something is happening.
 * ============================================================================
 */

export interface ToolRunBarProps {
  /** The verb, e.g. "Compress images". Also the accessible name. */
  label: string;
  busy: boolean;
  /** True when there is nothing to work on yet. */
  disabled?: boolean;
  progress: RunProgress | null;
  /** Sentence for the progress bar, e.g. `3 of 20 done`. */
  progressLabel?: (progress: RunProgress) => string;
  onRun: () => void;
  onCancel: () => void;
  /** A short line under the button: a limit, an estimate, a caveat. */
  hint?: ReactNode;
}

export function ToolRunBar({
  label,
  busy,
  disabled = false,
  progress,
  progressLabel,
  onRun,
  onCancel,
  hint,
}: ToolRunBarProps) {
  const percent =
    progress && progress.total > 0 ? (progress.done / progress.total) * 100 : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          loading={busy}
          disabled={disabled}
          onClick={onRun}
          className="w-full sm:w-auto"
        >
          {label}
        </Button>
        {busy ? (
          <Button variant="secondary" size="lg" iconLeft="x" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>

      {busy ? (
        <ProgressBar
          value={percent}
          label={progress && progressLabel ? progressLabel(progress) : `${label} — working`}
          showPercent={percent !== undefined}
        />
      ) : null}

      {hint && !busy ? <p className="text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
