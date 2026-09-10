'use client';

/**
 * CopyButton — put a string on the clipboard and confirm that it happened.
 *
 * ── Failure never shows an exception ────────────────────────────────────────
 * `navigator.clipboard.writeText` rejects for reasons the user cannot act on:
 * an insecure origin, a denied permission, a browser that gates it behind a
 * user-activation rule we just failed, or no Clipboard API at all. A
 * `DOMException` string helps nobody. The only useful response is the shortcut
 * the platform guarantees, so a failure shows "Press Ctrl+C to copy" (⌘C on
 * Apple hardware) and nothing else. This is a product rule, not a nicety.
 *
 * ── Confirmation on three channels ──────────────────────────────────────────
 * The glyph swaps to `check`, the label swaps to `copiedLabel`, and a
 * `role="status"` region announces it. No channel is colour.
 *
 * The live region is rendered on every pass, empty when idle. A live region
 * inserted into the DOM at the same moment as its content is unreliable —
 * several screen readers only announce mutations to a region that already
 * existed — so the container ships from first paint and only its text changes.
 *
 * ── `value` may be a function ───────────────────────────────────────────────
 * A tool that would have to serialise a 5MB result to render this button should
 * not pay for that on every keystroke. Passing `() => buildOutput()` defers the
 * work to the click.
 *
 * Variant and size unions are declared locally rather than imported from
 * `./Button`, so this file depends on Button's *runtime* export and not on the
 * names of its exported types.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from './VisuallyHidden';
import { Button } from './Button';

type CopyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type CopyButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface Feedback {
  kind: 'copied' | 'manual';
  message: string;
}

/** Long enough to read, short enough that the button is never stuck. */
const RESET_MS = 1800;

function manualCopyHint(): string {
  // `userAgent` rather than the deprecated `navigator.platform`, and evaluated
  // at click time rather than at module load, so there is no server-rendered
  // guess to hydrate against.
  const isApple =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isApple ? 'Press ⌘C to copy' : 'Press Ctrl+C to copy';
}

export interface CopyButtonProps {
  /** The text, or a builder called on click for expensive strings. */
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  variant?: CopyButtonVariant;
  size?: CopyButtonSize;
  onCopied?: () => void;
  className?: string;
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'secondary',
  size = 'sm',
  onCopied,
  className,
}: CopyButtonProps) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = async () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);

    let copied = false;
    try {
      // The builder call is inside the `try` too: if a caller's serialiser
      // throws we still want the shortcut hint rather than an unhandled
      // rejection escaping into the console.
      const text = typeof value === 'function' ? value() : value;
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Intentionally swallowed. See the header note.
    }

    // `onCopied` runs outside the try so a throwing callback cannot be
    // misreported as a clipboard failure.
    if (copied) {
      setFeedback({ kind: 'copied', message: copiedLabel });
      onCopied?.();
    } else {
      setFeedback({ kind: 'manual', message: manualCopyHint() });
    }

    timeoutRef.current = setTimeout(() => setFeedback(null), RESET_MS);
  };

  const isCopied = feedback?.kind === 'copied';
  const currentLabel = isCopied ? copiedLabel : label;
  const glyph = isCopied ? 'check' : 'copy';
  const handleClick = () => {
    void copy();
  };

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {/* Two call sites rather than one with a spread: `ButtonProps` is a union
          discriminated on `size`, and only a literal `size="icon"` selects the
          member that requires `aria-label`. Comparing `size` inline is what
          narrows it for the other branch. */}
      {size === 'icon' ? (
        <Button
          variant={variant}
          size="icon"
          iconLeft={glyph}
          onClick={handleClick}
          // Tracks the copied state, so the accessible name of an icon-only
          // button never contradicts the glyph it is showing.
          aria-label={currentLabel}
        />
      ) : (
        <Button variant={variant} size={size} iconLeft={glyph} onClick={handleClick}>
          {currentLabel}
        </Button>
      )}

      {feedback?.kind === 'manual' ? (
        // `aria-hidden` because the live region below already announces it;
        // this copy is for the sighted user.
        <span aria-hidden="true" className="text-xs text-fg-muted">
          {feedback.message}
        </span>
      ) : null}

      <VisuallyHidden role="status" aria-live="polite">
        {feedback ? feedback.message : ''}
      </VisuallyHidden>
    </span>
  );
}
