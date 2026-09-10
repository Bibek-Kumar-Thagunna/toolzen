'use client';

/**
 * ============================================================================
 * useToolSearch — one search behaviour, two surfaces
 * ============================================================================
 * The ranking engine lives in `@/lib/registry/search` and knows nothing about
 * React. This hook is the only place that turns it into interactive behaviour,
 * and it is shared by the command palette and the `/tools` filter box on
 * purpose: keyboard handling that is written twice drifts. The palette would
 * grow Home/End, the filter would not, and the two would disagree about what
 * Escape means within a release.
 *
 * What it owns:
 *   - the query string and the memoised hits for it;
 *   - the active index, reset to the top whenever the result set changes;
 *   - the full key map (ArrowUp/ArrowDown with wrap, Home/End, Enter, Escape);
 *   - the debounced `tool_search` report.
 *
 * What it deliberately does not own: focus, ARIA, ids and markup. Those differ
 * between a modal combobox and an inline page filter, so they belong to the
 * component. The hook never touches the DOM.
 *
 * Analytics note: the report is debounced by {@link REPORT_DELAY}, so typing
 * "image compress" is one event, not fourteen. Only the *length* of the query
 * is sent — `@/lib/analytics` forbids the text itself, and search boxes are
 * exactly where people paste things they would not want logged.
 * ============================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { track } from '@/lib/analytics';
import { searchTools, type SearchDoc, type SearchHit } from '@/lib/registry/search';

/**
 * Long enough that a whole word is one event, short enough that the number
 * still lands while the user is looking at the results they typed for.
 */
const REPORT_DELAY = 400;

export interface UseToolSearchOptions {
  /** The shipped projection of the registry. Never the registry itself. */
  docs: readonly SearchDoc[];
  /** Maximum hits. The engine defaults to 8, which is the palette's height. */
  limit?: number;
  /** What an empty query shows. The engine defaults to the `popular` tools. */
  fallback?: readonly SearchDoc[];
  /** Seed value, e.g. from `?q=`. Read once, on mount. */
  initialQuery?: string;
  /** Enter, or a click on a row. Without it, Enter is left to the browser. */
  onActivate?: (hit: SearchHit, index: number) => void;
  /** Escape on an already-empty query. Without it, Escape is not intercepted. */
  onDismiss?: () => void;
  /** Report `tool_search`. Default true. */
  report?: boolean;
}

export interface ToolSearchState {
  query: string;
  setQuery: (next: string) => void;
  /** Empties the query without touching focus — the caller owns focus. */
  clear: () => void;
  hits: SearchHit[];
  activeIndex: number;
  setActiveIndex: (next: number) => void;
  /** Attach to the input. Returns nothing; it only ever prevents defaults. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export function useToolSearch({
  docs,
  limit,
  fallback,
  initialQuery = '',
  onActivate,
  onDismiss,
  report = true,
}: UseToolSearchOptions): ToolSearchState {
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);

  const hits = useMemo(
    () => searchTools(docs, query, { limit, fallback }),
    [docs, query, limit, fallback],
  );

  /**
   * Reset the highlight when the result list changes.
   *
   * Compared by slug rather than by array identity: `useMemo` already gives a
   * new array for every keystroke, so identity would reset on a query change
   * that produced the same results and lose the user's place.
   *
   * Done during render, not in an effect. An effect would commit one frame in
   * which `aria-activedescendant` still points at a row from the previous
   * result set — briefly naming an option that is no longer there. Adjusting
   * state during render is React's documented answer to exactly this; it
   * re-renders before the browser sees anything.
   */
  const signature = hits.map((hit) => hit.doc.slug).join(' ');
  const previousSignature = useRef(signature);
  if (previousSignature.current !== signature) {
    previousSignature.current = signature;
    if (activeIndex !== 0) setActiveIndex(0);
  }

  const clear = useCallback(() => setQuery(''), []);

  const trimmedLength = query.trim().length;
  const resultCount = hits.length;

  useEffect(() => {
    if (!report || trimmedLength === 0) return;
    const timer = window.setTimeout(() => {
      track({ name: 'tool_search', queryLength: trimmedLength, resultCount });
    }, REPORT_DELAY);
    return () => window.clearTimeout(timer);
  }, [report, trimmedLength, resultCount]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Mid-composition, Enter and the arrows belong to the IME candidate window.
    if (event.nativeEvent.isComposing) return;

    const count = hits.length;

    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) return;
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % count);
        return;

      case 'ArrowUp':
        if (count === 0) return;
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + count) % count);
        return;

      // Home/End move the highlight, not the caret. The trade is deliberate:
      // the query is at most a few words, jumping the caret to either end of it
      // is rarely what anyone wants here, and both keys are released back to the
      // input the moment there is no list to navigate.
      case 'Home':
        if (count === 0) return;
        event.preventDefault();
        setActiveIndex(0);
        return;

      case 'End':
        if (count === 0) return;
        event.preventDefault();
        setActiveIndex(count - 1);
        return;

      case 'Enter': {
        const hit = hits.at(activeIndex);
        if (!hit || !onActivate) return;
        event.preventDefault();
        onActivate(hit, activeIndex);
        return;
      }

      case 'Escape':
        // Clear first, close second. Inside a native <dialog> the browser treats
        // Escape as a close request, so cancelling the keydown is the only way
        // the first press can mean "clear the box" instead of "throw the whole
        // thing away" — a user with a typed query almost always meant the former.
        if (query !== '') {
          event.preventDefault();
          setQuery('');
        } else if (onDismiss) {
          event.preventDefault();
          onDismiss();
        }
        return;

      default:
        return;
    }
  };

  return { query, setQuery, clear, hits, activeIndex, setActiveIndex, onKeyDown };
}

/**
 * Short display label for a `SearchDoc.category`.
 *
 * Why not `import { getCategory } from '@/lib/registry/categories'`: that module
 * carries every category's tagline, description, meta title and meta
 * description — server copy for category pages — and all we need on a search row
 * is one word in a badge. This is the same trade `SearchDoc` itself makes.
 *
 * The fallback returns the id, so an unmapped category shows something true
 * rather than something invented, and no label here can name a category that
 * does not exist.
 */
const CATEGORY_LABEL: Readonly<Record<string, string | undefined>> = {
  image: 'Image',
  pdf: 'PDF',
  text: 'Text',
  developer: 'Developer',
  calculators: 'Calculator',
  generators: 'Generator',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category.replace(/-/g, ' ');
}
