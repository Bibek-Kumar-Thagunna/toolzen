'use client';

/**
 * ============================================================================
 * ToolFilter — the `/tools` filter box
 * ============================================================================
 * The same engine as the command palette, on a page instead of in a dialog.
 *
 * ── Why the unfiltered grid is a `children` prop ────────────────────────────
 * `/tools` is the page most likely to be someone's entry point from a search
 * engine, so its content has to exist in the HTML. If this component rendered
 * the grid itself, all 24 cards would become client-rendered markup that a
 * crawler may or may not execute, that a reader with JavaScript blocked never
 * sees at all, and whose largest element cannot be painted until the bundle
 * arrives.
 *
 * So the page renders the grid on the server and passes it in. An empty box
 * shows exactly that markup — untouched, not re-created — and typing swaps it
 * for client-ranked results. The swap replaces the server grid rather than
 * hiding it: two copies in the DOM would mean every tool appearing twice to a
 * screen reader walking the page, and a duplicate set of links.
 *
 * ── Why this is not a combobox ──────────────────────────────────────────────
 * The palette owns a popup listbox and needs the full combobox pattern. This
 * does not: there is no popup, nothing overlays anything, and the results are
 * the page's own content. `role="combobox"` here would promise a widget that is
 * not present, and `aria-activedescendant` would name an option in a grid of
 * cards that are already real, tabbable links. A labelled search field plus a
 * `role="status"` count is the honest description of what this is.
 *
 * The keyboard map still comes from `useToolSearch` unchanged, including the
 * Home/End trade it documents. Its Escape behaviour — clear, and with nothing
 * to clear, hand the key back — is what a filter should do, and no `onDismiss`
 * is passed because there is nothing to dismiss.
 *
 * ── Why `history.replaceState` and not the router ────────────────────────────
 * `?q=` is here so a filtered view can be linked and survives a reload. It is
 * not a navigation. `router.push` per keystroke would stack one history entry
 * per character, so Back would walk the query backwards instead of leaving the
 * page; `router.replace` avoids that but still asks the server for a fresh RSC
 * payload for a page whose HTML does not depend on `q`. `replaceState` writes
 * the address bar and nothing else.
 *
 * Note for the caller: `useSearchParams` requires this component to sit inside
 * a `<Suspense>` boundary, or Next opts the whole route out of static
 * rendering. The `/tools` page wraps it.
 * ============================================================================
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';

import { Icon, isIconName, type IconName } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { track } from '@/lib/analytics';
import { groupByCategory, type SearchDoc, type SearchHit } from '@/lib/registry/search';
import { routes } from '@/lib/site';

import { categoryLabel, useToolSearch } from './useToolSearch';

/**
 * Long enough that a typed word is one address-bar rewrite. The URL is a
 * bookmark, not a live readout, so it can afford to lag the results slightly.
 */
const URL_DELAY = 300;

/**
 * A result card. A real `<a>` with a real `href`, so ⌘-click, middle-click and
 * "copy link address" all work; `next/link` upgrades the plain click to a
 * client navigation. Nothing is prevented, so the report is fired on the way
 * out and the browser does the rest.
 */
function ResultCard({ hit, position }: { hit: SearchHit; position: number }) {
  const { doc } = hit;
  // `icon` crosses the boundary as a plain string; an unknown one falls back
  // rather than rendering an empty box.
  const icon: IconName = isIconName(doc.icon) ? doc.icon : 'search';

  return (
    <Link
      href={routes.tool(doc.slug)}
      onClick={() => {
        track({ name: 'tool_search_result_clicked', slug: doc.slug, position });
      }}
      className="card flex h-full flex-col gap-1 p-4 no-underline transition-colors duration-fast ease-out hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon name={icon} size={18} className="shrink-0 text-fg-subtle" />
        <span className="truncate text-sm font-medium text-fg">{doc.name}</span>
      </span>
      <span className="line-clamp-2 text-xs text-fg-muted">{doc.tagline}</span>
    </Link>
  );
}

export interface ToolFilterProps {
  /** The shipped projection. Never `@/lib/registry`, which is server-only. */
  docs: SearchDoc[];
  /** The server-rendered, unfiltered grid. Shown whenever the box is empty. */
  children: ReactNode;
}

export function ToolFilter({ docs, children }: ToolFilterProps) {
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const base = useId();
  const inputId = `${base}-input`;

  /**
   * `?q=` seeds the box. Read on every render but only consumed once, because
   * `useToolSearch` hands it to `useState` as an initial value — the effect
   * below is the only thing that writes the URL afterwards, so re-reading it
   * would have the field fighting its own address bar.
   */
  const initialQuery = searchParams.get('q') ?? '';

  const { query, setQuery, clear, hits, onKeyDown } = useToolSearch({
    docs,
    // Every match, not a palette's worth: this is the page that exists to show
    // the whole catalogue.
    limit: docs.length,
    fallback: docs,
    initialQuery,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const trimmed = query.trim();
      if (trimmed === '') url.searchParams.delete('q');
      else url.searchParams.set('q', trimmed);

      const next = `${url.pathname}${url.search}${url.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next === current) return;

      // The existing state object is passed through deliberately: the App
      // Router keeps its own routing data there, and replacing it with `null`
      // leaves Back and Forward with nothing to restore.
      window.history.replaceState(window.history.state, '', next);
    }, URL_DELAY);
    return () => window.clearTimeout(timer);
  }, [query]);

  const handleClear = () => {
    clear();
    // Focus is the caller's job everywhere in this feature, and here the caller
    // is this component: a cleared box that has lost focus makes the next
    // keystroke go nowhere.
    inputRef.current?.focus();
  };

  const isFiltering = query.trim() !== '';

  /**
   * Buckets in the order the ranking produced them, each bucket internally still
   * in rank order — that is `groupByCategory`'s contract. `positions` keeps the
   * flat rank alongside, so a click in the third group still reports where the
   * card actually sat in the ranking rather than where it sits on screen.
   */
  const groups = useMemo(
    () => (isFiltering ? [...groupByCategory(hits)] : []),
    [hits, isFiltering],
  );
  const positions = useMemo(
    () => new Map(hits.map((hit, index) => [hit.doc.slug, index])),
    [hits],
  );

  const total = docs.length;
  const noun = total === 1 ? 'tool' : 'tools';
  const countLabel = isFiltering ? `${hits.length} of ${total} ${noun}` : `${total} ${noun}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <VisuallyHidden>
            <label htmlFor={inputId}>Filter tools</label>
          </VisuallyHidden>
          <Input
            ref={inputRef}
            id={inputId}
            // `search` gets the right on-screen keyboard and lets a UA offer its
            // own history. Its unlabelled ~12px cancel glyph is suppressed for
            // the same reason Input drops number spinners: it fails target size,
            // and the labelled Clear button beside it is the real control.
            type="search"
            inputSize="lg"
            iconLeft="search"
            placeholder="Filter tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            className="[&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
        {isFiltering ? (
          <Button variant="secondary" size="lg" iconLeft="x" onClick={handleClear}>
            Clear
          </Button>
        ) : null}
      </div>

      {/* Visible and announced by the same element. `role="status"` is polite
          and atomic by definition, so it never interrupts and it re-reads the
          whole sentence; what a user hears is the count as it stood when they
          stopped typing, not one reading per keystroke. */}
      <p role="status" className="text-sm text-fg-muted">
        {countLabel}
      </p>

      {!isFiltering ? (
        children
      ) : groups.length === 0 ? (
        <EmptyState
          icon="search"
          title="No tools match that filter"
          description="Try a shorter word, or clear the filter to see everything."
          action={
            <Button variant="secondary" onClick={handleClear}>
              Clear filter
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([category, categoryHits]) => (
            // A plain `<div>`, not a `<section aria-labelledby>`: a named section
            // is a landmark, and six category landmarks would bury the page's
            // real ones. The heading is the structure; naming the list from it
            // gets the label announced without inventing a region.
            <div key={category}>
              <h2
                id={`${base}-${category}`}
                className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted"
              >
                {categoryLabel(category)}
              </h2>
              <ul
                aria-labelledby={`${base}-${category}`}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {categoryHits.map((hit) => (
                  <li key={hit.doc.slug}>
                    <ResultCard hit={hit} position={positions.get(hit.doc.slug) ?? 0} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
