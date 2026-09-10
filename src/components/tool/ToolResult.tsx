'use client';

import { useState, type ReactNode } from 'react';

import { AdSlot } from '@/components/ads/AdSlot';
import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { toolTracker } from '@/lib/analytics';
import type { DeliveryResult } from '@/lib/files/download';
import { cn } from '@/lib/cn';

/**
 * ============================================================================
 * TOOL RESULT
 * ============================================================================
 * What a tool shows once the work is done: what happened, how to take it away,
 * and how to start again.
 *
 * ── Why the ad slot lives here, below the download control ─────────────────
 * The one advert a tool page shows near the workspace is the `afterResult`
 * placement, and the product rule is that it may never come between a user and
 * their file. Putting the slot inside this component makes that structural: it
 * is rendered after the action row in the DOM, so it is after it on screen, in
 * the tab order, and in the reading order of a screen reader. There is no prop
 * that moves it, and no tool can accidentally place it higher.
 *
 * It also means the slot only exists once there is a result. An `afterResult`
 * slot mounted on page load would be a reserved, empty 250-pixel band sitting in
 * the middle of the tool before the user has done anything — reserved space is
 * the fix for layout shift, not a licence to put an advert where the tool should
 * be. Mounting it with the result does move the page, but the Layout Instability
 * spec excludes shifts within 500ms of user input, and this shift is the direct
 * consequence of the button the user just pressed.
 *
 * ── Why `deliver` is synchronous ───────────────────────────────────────────
 * By the time this component renders, the bytes already exist — the run
 * finished. So the click handler does no work beyond handing them to the
 * browser, which keeps the download inside the user-activation window that
 * Safari and Firefox require for a programmatic download. A tool that needs to
 * build something on click should build it in the job, not here.
 *
 * ── Why a failed download is shown but not tracked ─────────────────────────
 * `download_clicked` is a success measure: it answers "did people get their
 * file". Firing it when the anchor never started would quietly inflate exactly
 * the number we would use to notice a broken download. The user still gets a
 * sentence, because a button that visibly does nothing is worse than an error.
 * ============================================================================
 */

/** The primary way a result leaves the page. */
export interface ResultDownload {
  label?: string;
  /** For `download_clicked`: a short format code such as `png` or `zip`. */
  format?: string;
  /** How many files this delivers, for the same event. */
  count?: number;
  /** Hands bytes to the browser. Synchronous by design — see the header. */
  deliver: () => DeliveryResult;
}

/** For tools whose result is text: a hash, a slug, a colour, a block of JSON. */
export interface ResultCopy {
  value: string | (() => string);
  label?: string;
  /** For `copy_clicked`: what was copied, e.g. `hex` or `result`. */
  target?: string;
}

export interface ToolResultProps {
  slug: string;
  /** What happened, in the user's terms: "20 images compressed". */
  title: string;
  /** One line of detail: "12.4 MB → 3.1 MB · 75% smaller". */
  summary?: ReactNode;
  download?: ResultDownload;
  copy?: ResultCopy;
  /** Extra controls — per-file downloads, a format switch. Placed after copy. */
  actions?: ReactNode;
  /** Usually `run.reset`. Omit to hide the control. */
  onUseAgain?: () => void;
  useAgainLabel?: string;
  /** The result itself: a preview grid, a table, a read-only textarea. */
  children?: ReactNode;
  className?: string;
}

export function ToolResult({
  slug,
  title,
  summary,
  download,
  copy,
  actions,
  onUseAgain,
  useAgainLabel = 'Use again',
  children,
  className,
}: ToolResultProps) {
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  function handleDownload(): void {
    if (!download) return;
    const outcome = download.deliver();
    if (!outcome.ok) {
      setDeliveryError(outcome.error);
      return;
    }
    setDeliveryError(null);
    toolTracker(slug).downloaded(download.format, download.count);
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Deliberately not an `Alert`, and deliberately not tinted. At this point
          the result *is* the content of the workspace, and wrapping it in a green
          band is the decorative noise the design rules warn against. The glyph
          and the sentence carry the state; the colour is only on the glyph, so
          nothing here depends on colour alone. */}
      <div>
        <h2 className="flex items-center gap-2 text-md font-semibold text-fg">
          <Icon name="check-circle" size={20} className="shrink-0 text-success" />
          {title}
        </h2>
        {summary ? <p className="mt-1 text-sm text-fg-muted">{summary}</p> : null}
      </div>

      {/* The action row comes before the detail below it: on a phone, a
          twenty-item preview between the heading and the download button means
          scrolling past the whole result to reach the one control that matters. */}
      <div className="flex flex-wrap items-center gap-2">
        {download ? (
          <Button
            variant="primary"
            size="lg"
            iconLeft="download"
            onClick={handleDownload}
            className="w-full sm:w-auto"
          >
            {download.label ?? 'Download'}
          </Button>
        ) : null}

        {copy ? (
          <CopyButton
            value={copy.value}
            label={copy.label ?? 'Copy'}
            size="md"
            onCopied={() => toolTracker(slug).copied(copy.target)}
          />
        ) : null}

        {actions}

        {onUseAgain ? (
          <Button variant="ghost" size="md" iconLeft="refresh" onClick={onUseAgain}>
            {useAgainLabel}
          </Button>
        ) : null}
      </div>

      {deliveryError ? <Alert variant="danger">{deliveryError}</Alert> : null}

      {children}

      {/* Last, always. See the header note: after the download control in the
          DOM, on screen, in the tab order, and in the reading order. */}
      <AdSlot placement="afterResult" />
    </div>
  );
}
