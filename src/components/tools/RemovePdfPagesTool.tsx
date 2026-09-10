'use client';

/**
 * DELETE PAGES FROM A PDF
 *
 * ── Why the box says which pages to *remove*, not which to keep ───────────
 * "Delete pages 4 and 9" is how people describe this job, so that is what the
 * control asks for. The inverse — "keep 1-3, 5-8, 10-" — is the same operation
 * expressed as arithmetic the user has to do in their head, and getting it
 * wrong deletes the wrong thing.
 *
 * The readout underneath states what will survive, so the arithmetic is shown
 * rather than assumed. `split-pdf` is the tool for the other framing.
 *
 * ── Pages are removed from the end backwards ──────────────────────────────
 * `removePage` shifts every later index down by one. Walking the selection in
 * ascending order therefore deletes the wrong pages after the first, and the
 * damage is silent — the file is valid, it is just missing the wrong content.
 * Descending order means no index moves before it has been used.
 */
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { describePages, parsePageRanges } from '@/lib/tools/pdf/ranges';
import { PdfEditShell, type OpenedPdf } from './PdfEditShell';

const SLUG = 'remove-pdf-pages';

export function RemovePdfPagesTool() {
  const [rangeText, setRangeText] = useState('');

  const doomed = (opened: OpenedPdf): number[] => {
    if (rangeText.trim() === '') return [];
    const parsed = parsePageRanges(rangeText, opened.pageCount);
    return parsed.ok ? parsed.pages : [];
  };

  const survivors = (opened: OpenedPdf): number[] => {
    const remove = new Set(doomed(opened));
    return Array.from({ length: opened.pageCount }, (_, i) => i + 1).filter((n) => !remove.has(n));
  };

  return (
    <PdfEditShell
      slug={SLUG}
      label="Delete pages from a PDF"
      runLabel="Delete pages"
      suffix="-pages-removed"
      hint="Your original file is not changed — this builds a new document."
      blockedReason={(opened) => {
        if (rangeText.trim() === '') return 'Enter the pages you want removed.';
        const parsed = parsePageRanges(rangeText, opened.pageCount);
        if (!parsed.ok) return parsed.error;
        if (parsed.pages.length >= opened.pageCount) {
          return 'That would remove every page, and a PDF with no pages cannot be saved.';
        }
        return null;
      }}
      controls={(opened, busy) => {
        const remove = doomed(opened);
        const keep = survivors(opened);
        return (
          <div className="space-y-3">
            <Field
              label="Pages to remove"
              htmlFor="remove-range"
              hint={`This document has ${opened.pageCount}. Single pages and ranges: 4, 9, 12-14.`}
            >
              <Input
                id="remove-range"
                value={rangeText}
                disabled={busy}
                placeholder="4, 9, 12-14"
                onChange={(event) => setRangeText(event.target.value)}
              />
            </Field>

            {remove.length > 0 && keep.length > 0 ? (
              // The arithmetic, shown rather than left to the user.
              <Alert variant="info">
                Removing {remove.length} {remove.length === 1 ? 'page' : 'pages'} (
                {describePages(remove)}). You will be left with {keep.length}:{' '}
                {describePages(keep)}.
              </Alert>
            ) : null}
          </div>
        );
      }}
      apply={async ({ lib, opened }) => {
        const doc = await lib.PDFDocument.load(await opened.file.arrayBuffer());
        const remove = doomed(opened);
        if (remove.length === 0) return { ok: false, error: 'No pages were selected.' };

        // Descending: see the header. Ascending silently removes the wrong pages.
        for (const pageNumber of [...remove].sort((a, b) => b - a)) {
          doc.removePage(pageNumber - 1);
        }

        const left = doc.getPageCount();
        return {
          ok: true,
          bytes: await doc.save({ useObjectStreams: false }),
          summary: `${remove.length} removed · ${left} ${left === 1 ? 'page' : 'pages'} left`,
        };
      }}
    />
  );
}
