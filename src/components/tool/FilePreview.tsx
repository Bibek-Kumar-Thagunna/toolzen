'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { humanBytes } from '@/lib/files/bytes';
import { cn } from '@/lib/cn';

/**
 * ============================================================================
 * FILE PREVIEW
 * ============================================================================
 * The list of files a tool is holding, before anything has been done to them.
 *
 * ── Why the thumbnail is its own component ─────────────────────────────────
 * Each thumbnail is an object URL, and an object URL that is never revoked keeps
 * the entire file alive in memory. Twenty photos at thirty megabytes is six
 * hundred megabytes of retained blobs on a device that may only have a couple of
 * gigabytes, and the tab is killed with no error anyone can see. Creating and
 * revoking the URL inside a per-file component means React's own unmount cleanup
 * does the accounting: remove a file from the list and its memory goes with it,
 * with no bookkeeping in the parent to get wrong.
 *
 * ── Why a plain `<img>` ────────────────────────────────────────────────────
 * `next/image` exists to serve resized, cached copies from a URL the server can
 * fetch. A `blob:` URL is local to this tab and this second; there is nothing to
 * optimise and nothing to cache. The lint rule that prefers `next/image` is
 * suppressed for that reason and only here.
 *
 * ── Why the remove button names the file ───────────────────────────────────
 * Twenty rows of "Remove" is twenty identical accessible names, and a screen
 * reader user cannot tell which one they are on. The visible label stays an icon
 * and the accessible name carries the file name.
 * ============================================================================
 */

const iconForType = (type: string): IconName => {
  if (type.startsWith('image/')) return 'file-image';
  if (type === 'application/pdf') return 'file-pdf';
  if (type.startsWith('text/')) return 'file-text';
  return 'file';
};

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [file]);

  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken">
      {url === null ? (
        <Icon name={iconForType(file.type)} size={18} className="text-fg-muted" />
      ) : (
        // A blob: URL is local to this tab; there is nothing for the image
        // optimiser to fetch, and next/image cannot process one.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" decoding="async" />
      )}
    </span>
  );
}

export interface FilePreviewProps {
  files: readonly File[];
  /** Omit for a read-only list — the remove control disappears with it. */
  onRemove?: (index: number) => void;
  /** Clears everything. The control only appears when there are two or more. */
  onClear?: () => void;
  /** True while a job is running: the queue cannot be edited mid-run. */
  disabled?: boolean;
  /** A trailing detail per row, e.g. image dimensions or a page count. */
  note?: (file: File, index: number) => ReactNode;
  className?: string;
}

export function FilePreview({
  files,
  onRemove,
  onClear,
  disabled = false,
  note,
  className,
}: FilePreviewProps) {
  if (files.length === 0) return null;

  const total = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {files.length === 1 ? '1 file' : `${files.length} files`} · {humanBytes(total)}
        </p>
        {onClear && files.length > 1 ? (
          <Button variant="ghost" size="sm" iconLeft="trash" onClick={onClear} disabled={disabled}>
            Clear all
          </Button>
        ) : null}
      </div>

      <ul aria-label="Selected files" className="divide-y divide-border rounded-lg border border-border">
        {files.map((file, index) => (
          <li
            key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
            className="flex items-center gap-3 p-2.5"
          >
            <Thumbnail file={file} />
            {/* `min-w-0` is what allows the truncation below to happen at all:
                a flex child defaults to `min-width: auto`, so a long file name
                pushes the row wider than the card instead of clipping. */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg" title={file.name}>
                {file.name}
              </p>
              <p className="text-xs text-fg-muted">
                {humanBytes(file.size)}
                {note ? <> · {note(file, index)}</> : null}
              </p>
            </div>
            {onRemove ? (
              <Button
                variant="ghost"
                size="icon"
                iconLeft="x"
                // The visible label is a glyph; the accessible name has to
                // carry the file name, or twenty rows read as twenty
                // identical "Remove" buttons.
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
                disabled={disabled}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
