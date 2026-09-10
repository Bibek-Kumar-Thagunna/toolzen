'use client';

/**
 * ============================================================================
 * COMMAND PALETTE
 * ============================================================================
 * ⌘K over the whole site: type two or three characters, hit Enter, land on the
 * tool. Ranking comes from `@/lib/registry/search`; interaction comes from
 * `./useToolSearch`, which the `/tools` filter shares so the two cannot drift.
 *
 * ── Native <dialog>, not src/components/ui/Dialog.tsx ───────────────────────
 * Dialog.tsx is the right primitive for a modal with a title, a body and a
 * footer, and its reasoning about the platform is reused verbatim below: top
 * layer so no z-index arithmetic, a real ::backdrop, a browser-implemented focus
 * trap, the rest of the document marked inert, Esc handled, layout classes
 * behind `open:` so they cannot defeat the UA's `dialog:not([open])
 * { display: none }`, `p-0` so the backdrop hit-test stays honest, and only the
 * `close` event listened to so Esc does not fire `onClose` twice.
 *
 * A palette is not that shape. It has no heading and no close button — the input
 * is the first thing in the box — it needs zero padding around a flush result
 * list, and it must sit near the top of the viewport rather than centred. That
 * last one is decisive: Dialog is positioned by `m-auto`, and moving it would
 * mean shipping a competing margin class and hoping stylesheet order resolves
 * it, which src/lib/cn.ts explicitly refuses to underwrite. So this file calls
 * `showModal()` on its own `<dialog>` and reuses the technique rather than the
 * markup.
 *
 * Two conscious departures from Dialog.tsx:
 *   - No scroll lock. Dialog's lock is reference-counted at module scope and not
 *     exported; a second, independent counter here would be two owners writing
 *     one `documentElement.style.overflow`, which is the exact bug that counter
 *     exists to prevent. `showModal()` already makes the page inert, and the
 *     palette is open for a few seconds.
 *   - Children are not gated on `open`. Dialog gates them because a modal body
 *     can boot workers and fetch; this one renders an input and at most eight
 *     rows. Keeping them mounted is what lets the live region below exist,
 *     empty, from first paint instead of being created alongside its content.
 *
 * ── Real <a> rows *and* aria-activedescendant ───────────────────────────────
 * Both, with no compromise on either, because they operate on different layers:
 *
 *   - For the browser each row is a genuine `<a href>`, so middle-click and
 *     ⌘/Ctrl-click open a new tab, Shift opens a window, the status bar previews
 *     the destination and "Copy link address" works. A plain primary click is
 *     the only one we intercept — every modified click is handed straight back.
 *   - For assistive technology `role="option"` reclassifies that same element,
 *     so the input is a combobox controlling a listbox of options, which is what
 *     ARIA actually has a pattern for. There is no "listbox of links".
 *   - Focus never moves. Rows carry `tabIndex={-1}` and the highlight travels by
 *     `aria-activedescendant`, so the caret, the typed text and every keystroke
 *     stay with the input. Enter is intercepted there and routed to the active
 *     index — the anchor's own activation is never used, which is precisely why
 *     it is free to keep behaving like an anchor for the pointer.
 *
 * The one thing given up is Tab-to-a-row, which the combobox pattern forbids
 * anyway.
 * ============================================================================
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Icon, isIconName, type IconName } from '@/components/icons';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import type { SearchDoc, SearchHit } from '@/lib/registry/search';
import { routes } from '@/lib/site';

import { categoryLabel, useToolSearch } from './useToolSearch';

/** Eight rows is what fits above the fold on a short laptop without scrolling. */
const PALETTE_LIMIT = 8;

/**
 * Announcement delay. Longer than the search debounce: a screen reader
 * interrupted on every keystroke is unusable, and the count is only worth
 * hearing once the typing has stopped.
 */
const ANNOUNCE_DELAY = 550;

/** Stable empty default, so a missing prop does not invalidate a useMemo. */
const NO_SLUGS: readonly string[] = [];

/**
 * True when the key event came from somewhere a keystroke means a character.
 * Without this, `/` is unusable in any tool's textarea and ⌘K is stolen from a
 * field that may have its own use for it.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** `userAgentData` is not in TypeScript's DOM lib yet; this avoids `any`. */
type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

function detectApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav: NavigatorWithUAData = navigator;
  // `userAgentData.platform` is the supported reading; `navigator.platform` is
  // deprecated but is the only one Safari and Firefox answer.
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Whether to write ⌘ or Ctrl. Resolved in an effect and never during render:
 * the server has no `navigator`, so branching on it while rendering would
 * produce HTML that disagrees with the first client render. The first paint says
 * Ctrl, then corrects itself — a shortcut hint is the right place to absorb one
 * frame of that.
 */
export function useApplePlatform(): boolean {
  const [isApple, setIsApple] = useState(false);
  useEffect(() => {
    setIsApple(detectApplePlatform());
  }, []);
  return isApple;
}

/** A key cap. `font-sans` because the UA renders `<kbd>` monospace. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-xs border border-border bg-surface px-1.5 py-0.5 font-sans text-2xs font-medium text-fg-muted">
      {children}
    </kbd>
  );
}

/**
 * The UA sheet paints `<mark>` with `background: Mark; color: MarkText` — a
 * yellow that knows nothing about either theme and is unreadable on the dark
 * one. Both properties are replaced here, so the default is never relied on;
 * emphasis that must not paint at all would pass `bg-transparent` instead.
 * Measured: 4.7:1 light, 6.2:1 dark.
 */
const MARK_CLASS = 'rounded-sm bg-accent-subtle px-0.5 text-accent';

/** Ranges arrive sorted and merged from the engine, so one pass is enough. */
function Highlight({ text, ranges }: { text: string; ranges: readonly [number, number][] }) {
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`${start}-${end}`} className={MARK_CLASS}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}

interface SuggestionGroup {
  label: string;
  docs: SearchDoc[];
}

/**
 * What the palette offers before a single character is typed: your favorites,
 * then what you used last, then what everyone uses. Capped at the same eight
 * rows as a result list, so the box never changes height on the first keystroke.
 *
 * Every slug is resolved through `docs`. A favorite left over from a tool that
 * has since been renamed or removed simply does not appear — the list can only
 * ever name a tool that exists, which is the other half of the promise that
 * `src/lib/storage.ts` makes when it shape-checks what it reads.
 */
function suggestionGroups(
  docs: readonly SearchDoc[],
  favorites: readonly string[],
  recents: readonly string[],
): SuggestionGroup[] {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const taken = new Set<string>();
  let budget = PALETTE_LIMIT;

  const pick = (slugs: readonly string[]): SearchDoc[] => {
    const out: SearchDoc[] = [];
    for (const slug of slugs) {
      if (budget === 0) break;
      const doc = bySlug.get(slug);
      if (!doc || taken.has(slug)) continue;
      taken.add(slug);
      out.push(doc);
      budget -= 1;
    }
    return out;
  };

  const groups: SuggestionGroup[] = [];
  const add = (label: string, picked: SearchDoc[]) => {
    if (picked.length > 0) groups.push({ label, docs: picked });
  };

  add('Favorites', pick(favorites));
  add('Recent', pick(recents));
  add(
    'Popular',
    pick(docs.filter((doc) => doc.popular).map((doc) => doc.slug)),
  );
  return groups;
}

interface PaletteRowProps {
  hit: SearchHit;
  /** Position in the flat hit list — the number the keyboard and analytics use. */
  index: number;
  active: boolean;
  optionId: string;
  onActivate: (hit: SearchHit, index: number) => void;
  onHover: (index: number) => void;
}

function PaletteRow({ hit, index, active, optionId, onActivate, onHover }: PaletteRowProps) {
  const { doc } = hit;
  // `SearchDoc.icon` is a plain string across the boundary; anything unknown
  // falls back rather than throwing on a missing path.
  const icon: IconName = isIconName(doc.icon) ? doc.icon : 'search';

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    // Modified clicks belong to the browser: ⌘/Ctrl for a tab, Shift for a
    // window, Alt for a download. Only a plain primary click is ours to take.
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onActivate(hit, index);
  };

  return (
    <a
      id={optionId}
      role="option"
      aria-selected={active}
      href={routes.tool(doc.slug)}
      tabIndex={-1}
      onClick={handleClick}
      onPointerMove={(event) => {
        // Mouse only: on touch, a scroll should not repaint a row as active.
        if (event.pointerType === 'mouse') onHover(index);
      }}
      className={cn(
        'relative flex min-h-11 items-center gap-3 py-2 pl-4 pr-3 no-underline',
        active ? 'bg-surface-hover' : 'bg-transparent',
      )}
    >
      {/* Two cues that are not colour: a bar appears at the left edge and the
          chevron appears at the right. Both are shape changes, so the active row
          is still identifiable in a high-contrast or monochrome rendering. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1.5 left-0 w-[3px] rounded-r-sm bg-accent',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      <Icon
        name={icon}
        size={18}
        className={cn('shrink-0', active ? 'text-accent' : 'text-fg-subtle')}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">
          <Highlight text={doc.name} ranges={hit.ranges} />
        </span>
        <span className="block truncate text-xs text-fg-muted">{doc.tagline}</span>
      </span>
      <Badge variant={active ? 'accent' : 'neutral'} className="shrink-0">
        {categoryLabel(doc.category)}
      </Badge>
      <Icon
        name="chevron-right"
        size={16}
        className={cn('shrink-0 text-accent', active ? 'opacity-100' : 'opacity-0')}
      />
    </a>
  );
}

export interface CommandPaletteProps {
  /** The shipped search projection. Never `@/lib/registry`, which is server-only. */
  docs: SearchDoc[];
  open: boolean;
  onClose: () => void;
  /**
   * Supplied by whoever owns `open`. The ⌘K / `/` listener lives here rather
   * than in the trigger because the shortcut is a property of the palette, and a
   * page that renders the palette without a header button should still have it.
   */
  onOpen?: () => void;
  /** Slugs, most recent first. Read from `@/lib/storage` by the owner. */
  recents?: readonly string[];
  favorites?: readonly string[];
}

export function CommandPalette({
  docs,
  open,
  onClose,
  onOpen,
  recents = NO_SLUGS,
  favorites = NO_SLUGS,
}: CommandPaletteProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const isApple = useApplePlatform();

  const base = useId();
  const inputId = `${base}-input`;
  const listboxId = `${base}-listbox`;
  const optionId = (index: number) => `${base}-option-${index}`;
  const groupId = (label: string) => `${base}-group-${label}`;

  const groups = useMemo(
    () => suggestionGroups(docs, favorites, recents),
    [docs, favorites, recents],
  );
  const fallback = useMemo(() => groups.flatMap((group) => group.docs), [groups]);

  const activate = useCallback(
    (hit: SearchHit, index: number) => {
      track({ name: 'tool_search_result_clicked', slug: hit.doc.slug, position: index });
      // Close before navigating: it releases the top layer and the browser's
      // focus trap first, so focus lands on the incoming page instead of being
      // restored into a dialog that is unmounting.
      onClose();
      router.push(routes.tool(hit.doc.slug));
    },
    [onClose, router],
  );

  const { query, setQuery, clear, hits, activeIndex, setActiveIndex, onKeyDown } = useToolSearch({
    docs,
    limit: PALETTE_LIMIT,
    fallback,
    onActivate: activate,
    onDismiss: onClose,
  });

  // `node.open` is tested both ways: `showModal()` on an open dialog throws, and
  // `close()` on a closed one fires a spurious `close` event.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open) {
      if (!node.open) node.showModal();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (node.open) {
      node.close();
    }
  }, [open]);

  // A palette that reopens with the last query already in it looks broken.
  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  useEffect(() => {
    if (!onOpen) return;

    const handler = (event: KeyboardEvent) => {
      const isToggle =
        (event.key === 'k' || event.key === 'K') &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey;
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isToggle && !isSlash) return;

      if (open) {
        // `/` while open is a character the input should receive.
        if (!isToggle) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (isTypingTarget(event.target)) return;

      // preventDefault only now that we know we are handling it. Claiming it
      // earlier would swallow the browser's own ⌘K, and every ⌘/Ctrl chord that
      // merely starts with a different key, on every page of the site.
      event.preventDefault();
      onOpen();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen, onClose, open]);

  // Keep the highlighted row on screen. `block: 'nearest'` is what makes this a
  // no-op when the row is already visible, so hovering never yanks the list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, hits]);

  /**
   * The result count, announced politely.
   *
   * The region itself is rendered unconditionally and starts empty, because a
   * live region created in the same paint as its content is ignored by several
   * screen readers — they have nothing to compare against. Clearing it on every
   * query change is also deliberate: it is what makes "8 tools" announce again
   * after a different query happens to return eight.
   */
  useEffect(() => {
    if (!open || query.trim() === '') {
      setAnnouncement('');
      return;
    }
    setAnnouncement('');
    const timer = window.setTimeout(() => {
      setAnnouncement(
        hits.length === 0
          ? 'No tools match that search.'
          : `${hits.length} ${hits.length === 1 ? 'tool' : 'tools'} found.`,
      );
    }, ANNOUNCE_DELAY);
    return () => window.clearTimeout(timer);
  }, [open, query, hits.length]);

  /**
   * Suggestions are shown in labelled groups; results are one flat list. The
   * flat index is carried through either way, because that is what the keyboard,
   * `aria-activedescendant` and the click position all agree on.
   */
  const groupedRows = useMemo(() => {
    if (query.trim() !== '') return null;
    let cursor = 0;
    return groups
      .map((group) => {
        const start = cursor;
        cursor += group.docs.length;
        return { label: group.label, start, rows: hits.slice(start, cursor) };
      })
      .filter((group) => group.rows.length > 0);
  }, [groups, hits, query]);

  const handleClose = () => {
    // Fires for every closing path, including the `close()` above, which the
    // owner already knows about — hence the guard.
    if (open) onClose();
  };

  // Clicking the shaded area reports the `<dialog>` itself as the target,
  // because the backdrop is that element's own pseudo-element.
  const handleBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose();
  };

  const renderRow = (hit: SearchHit, index: number) => (
    <PaletteRow
      key={hit.doc.slug}
      hit={hit}
      index={index}
      active={index === activeIndex}
      optionId={optionId(index)}
      onActivate={activate}
      onHover={setActiveIndex}
    />
  );

  // Named from `docs`, so the empty state can never recommend a tool we do not
  // have. A search box that dead-ends is the worst outcome there is.
  const popularNames = docs
    .filter((doc) => doc.popular)
    .slice(0, 3)
    .map((doc) => doc.name)
    .join(', ');
  const noResultsHint =
    popularNames === ''
      ? 'Try fewer words, or browse the full list.'
      : `Try fewer words. The most-used ones are ${popularNames}.`;

  const hasResults = hits.length > 0;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search tools"
      onClose={handleClose}
      onClick={handleBackdropClick}
      className={cn(
        // `p-0` is load-bearing for the backdrop hit-test, not cosmetic.
        // Underscores become spaces, which `calc()` needs around the `-`.
        'mt-[10vh] max-h-[70dvh] w-[calc(100%_-_1.5rem)] max-w-xl overflow-hidden rounded-lg border border-border bg-surface p-0 text-fg shadow-lg sm:mt-[15vh]',
        // Near the top rather than centred: it is where every palette users have
        // met before appears, and on a phone it keeps the list clear of the
        // on-screen keyboard. One margin class, so nothing has to out-specify
        // the UA's `margin: auto` on more than the side we mean.
        'open:flex open:flex-col open:animate-scale-in',
        'backdrop:bg-fg/40 backdrop:backdrop-blur-none',
      )}
    >
      {/* py-2 keeps the input's box clear of the dialog's clipping edge, so the
          global :focus-visible ring is never sliced off. */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2">
        <Icon name="search" size={18} className="shrink-0 text-fg-subtle" />
        <VisuallyHidden>
          <label htmlFor={inputId}>Search tools</label>
        </VisuallyHidden>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={hasResults}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={hasResults ? optionId(activeIndex) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Search tools"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-md text-fg placeholder:text-fg-subtle"
        />
      </div>

      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-1.5">
        {/* Always rendered so `aria-controls` always resolves. A listbox may only
            contain options and groups, which is why the empty state is a
            sibling and the group headings are role="presentation" — a heading
            exposed as an option is a row users can arrow onto and not open. */}
        <div id={listboxId} role="listbox" aria-label="Tools">
          {groupedRows
            ? groupedRows.map((group) => (
                <div key={group.label} role="group" aria-labelledby={groupId(group.label)}>
                  <div
                    id={groupId(group.label)}
                    role="presentation"
                    className="px-4 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-fg-muted"
                  >
                    {group.label}
                  </div>
                  {group.rows.map((hit, offset) => renderRow(hit, group.start + offset))}
                </div>
              ))
            : hits.map((hit, index) => renderRow(hit, index))}
        </div>

        {hasResults ? null : (
          <EmptyState
            icon="search"
            size="sm"
            title="No tools match that search"
            description={noResultsHint}
            action={
              <Link
                href={routes.tools}
                onClick={onClose}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              >
                Browse all tools
              </Link>
            }
          />
        )}
      </div>

      <VisuallyHidden as="div" role="status">
        {announcement}
      </VisuallyHidden>

      <div className="hidden items-center justify-between gap-3 border-t border-border-subtle bg-surface-sunken px-4 py-2 text-2xs text-fg-muted sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>
            <VisuallyHidden>Arrow keys</VisuallyHidden>
            <span aria-hidden="true">↑↓</span>
          </Kbd>
          Move
          <Kbd>Enter</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>{isApple ? '⌘K' : 'Ctrl K'}</Kbd>
          Close
        </span>
      </div>
    </dialog>
  );
}
