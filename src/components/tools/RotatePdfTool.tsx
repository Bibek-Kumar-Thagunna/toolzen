'use client';

/**
 * ROTATE PDF
 *
 * Turn every page, or just some of them, by a quarter turn.
 *
 * ── Rotation is metadata, not pixels ──────────────────────────────────────
 * A PDF page carries a `/Rotate` entry that says which way up a reader should
 * display it. Setting that is lossless and instant: no page is re-drawn, no
 * text stops being selectable, and the file barely changes size. That is why
 * this tool is separate from anything that touches the page content — the
 * naive alternative, rasterising each page and rotating the picture, would
 * destroy the text layer to achieve the same visible result.
 *
 * ── Why existing rotation is added to, not replaced ───────────────────────
 * A scanner often writes pages that are already marked as rotated. Setting the
 * angle absolutely would silently undo that on some pages and not others, so a
 * mixed document would come out inconsistent. Adding a quarter turn to whatever
 * each page already declares is what "rotate this document" means.
 */
import { useState } from 'react';

import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { describePages, parsePageRanges } from '@/lib/tools/pdf/ranges';
import { PdfEditShell, type OpenedPdf } from './PdfEditShell';

const SLUG = 'rotate-pdf';

const TURNS = [
  { value: 90, label: 'Right 90°' },
  { value: 180, label: 'Upside down' },
  { value: 270, label: 'Left 90°' },
];

export function RotatePdfTool() {
  const [turn, setTurn] = useState(90);
  const [rangeText, setRangeText] = useState('');

  const pagesFor = (opened: OpenedPdf): number[] | null => {
    if (rangeText.trim() === '') return null;
    const parsed = parsePageRanges(rangeText, opened.pageCount);
    return parsed.ok ? parsed.pages : [];
  };

  return (
    <PdfEditShell
      slug={SLUG}
      label="Rotate a PDF"
      runLabel="Rotate pages"
      suffix="-rotated"
      hint="Rotation is stored as a property of each page, so nothing is re-drawn and no text stops being selectable."
      blockedReason={(opened) => {
        if (rangeText.trim() === '') return null;
        const parsed = parsePageRanges(rangeText, opened.pageCount);
        return parsed.ok ? null : parsed.error;
      }}
      controls={(opened, busy) => {
        const chosen = pagesFor(opened);
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <fieldset disabled={busy}>
              <legend className="mb-1.5 text-sm font-medium text-fg">Turn</legend>
              <div className="flex flex-wrap gap-1.5">
                {TURNS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={turn === option.value}
                    onClick={() => setTurn(option.value)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-sm transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                      turn === option.value
                        ? 'border-accent-border bg-accent-subtle font-medium text-accent-fg'
                        : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <Field
              label="Pages"
              htmlFor="rotate-range"
              hint={
                chosen === null
                  ? `Blank rotates all ${opened.pageCount}. Or 1-3, 7.`
                  : chosen.length > 0
                    ? `${chosen.length} of ${opened.pageCount}: ${describePages(chosen)}`
                    : undefined
              }
            >
              <Input
                id="rotate-range"
                value={rangeText}
                disabled={busy}
                placeholder="all pages"
                onChange={(event) => setRangeText(event.target.value)}
              />
            </Field>
          </div>
        );
      }}
      apply={async ({ lib, opened }) => {
        const doc = await lib.PDFDocument.load(await opened.file.arrayBuffer());
        const pages = doc.getPages();
        const wanted = pagesFor(opened);
        const targets = wanted === null ? pages.map((_, i) => i + 1) : wanted;

        for (const pageNumber of targets) {
          const page = pages[pageNumber - 1];
          if (!page) continue;
          // Added to whatever the page already declares — see the header.
          const current = page.getRotation().angle;
          page.setRotation(lib.degrees((current + turn) % 360));
        }

        return {
          ok: true,
          bytes: await doc.save({ useObjectStreams: false }),
          summary: `${targets.length} ${targets.length === 1 ? 'page' : 'pages'} turned ${turn}°`,
        };
      }}
    />
  );
}
