'use client';

import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Textarea } from '@/components/ui/Textarea';
import { toolTracker } from '@/lib/analytics';
import { downloadText } from '@/lib/files/download';
import { cn } from '@/lib/cn';

/**
 * ============================================================================
 * TEXT OUTPUT
 * ============================================================================
 * The read-only half of a text tool: the converted text, a way to copy it, and
 * — for the tools whose output is a list rather than a phrase — a way to save it
 * as a file.
 *
 * ── Why a textarea rather than a `<pre>` ───────────────────────────────────
 * The output has to be selectable with a caret, scrollable in both axes without
 * breaking the page, and reachable by keyboard so that Ctrl+A / Ctrl+C works
 * when the clipboard API is blocked. A read-only textarea is all three for free.
 * A `<pre>` is not focusable, so a keyboard user cannot select its contents
 * without a mouse, and `user-select` alone does not fix that.
 *
 * ── Why the actions vanish when the box is empty ───────────────────────────
 * `navigator.clipboard.writeText('')` succeeds, so a Copy button on an empty
 * result reports "Copied" and puts nothing on the clipboard — a control that
 * lies. There is nothing to disable-and-explain here either: an empty output box
 * beside a filled input box is self-explanatory, so the row simply is not there
 * until there is something to act on.
 * ============================================================================
 */

export interface TextOutputProps {
  slug: string;
  /** The textarea's id, so the label and a deep link can both find it. */
  id: string;
  label: string;
  value: string;
  /** For `copy_clicked`: what was copied, e.g. `slug` or `result`. */
  copyTarget?: string;
  /** File name for the optional .txt download. Omit to hide the control. */
  downloadName?: string;
  rows?: number;
  /** For code, hashes, base64 and anything where column alignment matters. */
  monospace?: boolean;
  /** Under the box: a count, a caveat, a warning list. */
  footer?: ReactNode;
  placeholder?: string;
  className?: string;
}

export function TextOutput({
  slug,
  id,
  label,
  value,
  copyTarget = 'result',
  downloadName,
  rows = 8,
  monospace = false,
  footer,
  placeholder,
  className,
}: TextOutputProps) {
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const empty = value === '';

  function handleDownload(): void {
    if (downloadName === undefined) return;
    const outcome = downloadText(value, downloadName);
    if (!outcome.ok) {
      setDeliveryError(outcome.error);
      return;
    }
    setDeliveryError(null);
    toolTracker(slug).downloaded('txt', 1);
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {empty ? null : (
          <div className="flex items-center gap-2">
            <CopyButton
              value={value}
              size="sm"
              onCopied={() => toolTracker(slug).copied(copyTarget)}
            />
            {downloadName === undefined ? null : (
              <Button variant="ghost" size="sm" iconLeft="download" onClick={handleDownload}>
                Save .txt
              </Button>
            )}
          </div>
        )}
      </div>

      {/* `readOnly` rather than `disabled`: a disabled textarea is greyed out,
          unfocusable and unselectable, which would take the keyboard copy path
          away from exactly the users who need it most. */}
      <Textarea
        id={id}
        value={value}
        readOnly
        rows={rows}
        monospace={monospace}
        placeholder={placeholder}
        className="bg-surface-sunken"
      />

      {deliveryError ? <Alert variant="danger">{deliveryError}</Alert> : null}

      {footer ? <div className="text-xs text-fg-muted">{footer}</div> : null}
    </div>
  );
}
