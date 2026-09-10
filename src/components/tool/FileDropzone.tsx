'use client';

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { toolTracker } from '@/lib/analytics';
import { acceptAttribute, checkBatch } from '@/lib/files/accept';
import { humanLimit } from '@/lib/files/bytes';
import type { AcceptSpec } from '@/lib/registry/types';
import { cn } from '@/lib/cn';

/**
 * ============================================================================
 * FILE DROPZONE
 * ============================================================================
 * How files enter every file-based tool on the site.
 *
 * ── Why it is a label wrapped around a real file input ─────────────────────
 * The usual implementation is a `<div>` with `onClick`, `role="button"`,
 * `tabIndex={0}` and a hand-written Enter/Space handler that opens a hidden
 * input. Every part of that is a reimplementation of what `<label for>` already
 * does: the browser gives us click-to-open, Enter and Space, the correct role,
 * the accessible name, and the picker's own dialog semantics. Reimplementing it
 * means owning the bugs — a `role="button"` that does not respond to Space, a
 * focus ring that never appears, a name a screen reader reads as "clickable".
 *
 * So the input is real and focusable (`sr-only`, not `display: none`, which
 * would take it out of the tab order), and the visible panel is its label.
 * Drag-and-drop is layered on top as an enhancement: if it fails, or the user
 * cannot drag, the input is still right there. That is the §16 requirement for
 * an accessible alternative to drag-and-drop, met by not having a
 * drag-and-drop-only path in the first place.
 *
 * ── Why the dragging state is a counter ────────────────────────────────────
 * `dragenter` and `dragleave` both bubble, so moving the pointer from the panel
 * onto the icon inside it fires `dragleave` for the panel. Tracking a boolean
 * makes the highlight flicker; tracking depth does not.
 *
 * ── What it refuses, and what it says ──────────────────────────────────────
 * Validation is `checkBatch` from `src/lib/files/accept.ts`: a courtesy filter,
 * not a security boundary — the engines sniff the real bytes. A partly-rejected
 * drop keeps what fits and explains the rest in one sentence, because making
 * someone redo a twenty-file selection over two bad files is the kind of small
 * cruelty that loses a user. Nothing is reported to analytics here: the event
 * vocabulary is closed, and a rejected drop is not a `processing_failed`.
 * ============================================================================
 */

export interface FileDropzoneProps {
  /** For the `file_uploaded` event. */
  slug: string;
  accept: AcceptSpec;
  /** How many files the tool already holds, so the cap counts correctly. */
  existing?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}

export function FileDropzone({
  slug,
  accept,
  existing = 0,
  disabled = false,
  onFiles,
  className,
}: FileDropzoneProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const depth = useRef(0);
  const multiple = accept.maxFiles > 1;

  function handle(incoming: readonly File[]): void {
    if (disabled || incoming.length === 0) return;
    const checked = checkBatch(incoming, accept, { existing });
    setNotice(checked.message);
    if (checked.accepted.length === 0) return;
    toolTracker(slug).filesAdded(checked.accepted);
    onFiles(checked.accepted);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    handle(Array.from(event.target.files ?? []));
    // Clearing the value is what makes picking the same file twice in a row
    // fire `change` the second time. Without it, a user who removes a file and
    // re-adds it gets nothing and no explanation.
    event.target.value = '';
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    // Without both of these the browser navigates to the dropped file.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    depth.current += 1;
    if (!disabled) setDragging(true);
  }

  function onDragLeave(): void {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    handle(Array.from(event.dataTransfer?.files ?? []));
  }

  const remaining = Math.max(0, accept.maxFiles - existing);
  const hint = [
    accept.label,
    `up to ${humanLimit(accept.maxBytes)} each`,
    multiple ? `up to ${accept.maxFiles} files at a time` : 'one file at a time',
  ].join(' · ');

  return (
    <div className={cn('space-y-3', className)}>
      {/* The drag handlers sit on the wrapper, not the label: a label that is
          also a drop target swallows drops that land on its own children. */}
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          id={inputId}
          type="file"
          accept={acceptAttribute(accept)}
          multiple={multiple}
          disabled={disabled || remaining === 0}
          onChange={onChange}
          aria-describedby={hintId}
          // `sr-only`, not `hidden`: the input keeps its place in the tab order
          // and its own accessible name. `peer` lets the panel below show the
          // focus ring on its behalf.
          className="peer sr-only"
        />
        <label
          htmlFor={inputId}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors sm:py-10',
            // The ring is drawn here because the element that actually has focus
            // is visually hidden.
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas',
            disabled || remaining === 0
              ? 'cursor-not-allowed border-border bg-surface-sunken opacity-70'
              : 'cursor-pointer border-border-strong bg-surface-sunken hover:border-accent-border hover:bg-accent-subtle',
            dragging && 'border-accent bg-accent-subtle',
          )}
        >
          <Icon name="upload" size={24} className="text-fg-muted" />
          <span className="text-sm font-medium text-fg">
            {remaining === 0
              ? 'That is as many files as this tool takes at once'
              : multiple
                ? 'Drop files here, or choose files'
                : 'Drop a file here, or choose one'}
          </span>
          <span id={hintId} className="text-xs text-fg-muted">
            {hint}
          </span>
        </label>
      </div>

      {notice ? <Alert variant="warning">{notice}</Alert> : null}
    </div>
  );
}
