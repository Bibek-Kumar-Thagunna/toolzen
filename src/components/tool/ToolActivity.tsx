'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import { AdActivity } from '@/components/ads/AdContext';

/**
 * ============================================================================
 * TOOL ACTIVITY
 * ============================================================================
 * The bridge between "an engine is running" and "no new ad may initialise".
 *
 * `AdActivity` has to wrap the whole page, because the slots that must hold off
 * — the sidebar rail, the unit below the article — live outside the workspace.
 * But the fact that work is in flight originates deep inside the tool, in a hook
 * three or four components down. Lifting that state by hand would mean every
 * tool passing a `busy` prop up through its own component tree, which is both
 * tedious and the kind of wiring that silently rots the first time someone adds
 * a second async step.
 *
 * So the provider owns a set of holds and any descendant can place one:
 *
 *   function Compressor() {
 *     const run = useToolRun('image-compressor');  // calls useWorkSignal itself
 *     …
 *   }
 *
 * ── Why a set of keys rather than a counter ─────────────────────────────────
 * A counter needs begin/end pairing, and a component that unmounts mid-job — a
 * user navigating away, a step being replaced — never runs its `end`. The
 * counter then stays above zero and ads never initialise again for the life of
 * the page. Keys make the operation idempotent and let React's own cleanup
 * release the hold: a `useEffect` return runs on unmount whether the job
 * finished or not.
 *
 * ── Why the default context is a no-op ─────────────────────────────────────
 * A tool component must render correctly outside this provider: in isolation, in
 * a future embed, in a test. Signalling into nothing is the right behaviour
 * there, not a thrown "missing provider" that turns a layout mistake into a
 * blank page.
 * ============================================================================
 */

interface WorkSignal {
  hold: (key: string) => void;
  release: (key: string) => void;
}

const NO_SIGNAL: WorkSignal = { hold: () => {}, release: () => {} };

const WorkSignalContext = createContext<WorkSignal>(NO_SIGNAL);

/**
 * Declares that this component is working. Pass a boolean; the hold is placed
 * while it is true and released when it goes false or the component unmounts.
 *
 * The key comes from `useId`, so two instances of the same tool — a page with
 * two converters on it, or a re-run started before the first finished — hold
 * independently.
 */
export function useWorkSignal(busy: boolean): void {
  const key = useId();
  const signal = useContext(WorkSignalContext);
  useEffect(() => {
    if (!busy) return;
    signal.hold(key);
    return () => {
      signal.release(key);
    };
  }, [busy, key, signal]);
}

/**
 * Wraps a tool page. Renders nothing of its own: the DOM stays exactly as the
 * page laid it out, and only the ad environment changes.
 */
export function ToolActivity({ children }: { children: ReactNode }) {
  const [holds, setHolds] = useState<readonly string[]>([]);

  const hold = useCallback((key: string) => {
    setHolds((previous) => (previous.includes(key) ? previous : [...previous, key]));
  }, []);

  const release = useCallback((key: string) => {
    setHolds((previous) => (previous.includes(key) ? previous.filter((k) => k !== key) : previous));
  }, []);

  // Both callbacks are stable, so this value changes only when it has to; a new
  // object every render would re-run every descendant's signal effect.
  const signal = useMemo<WorkSignal>(() => ({ hold, release }), [hold, release]);

  return (
    <WorkSignalContext.Provider value={signal}>
      <AdActivity busy={holds.length > 0}>{children}</AdActivity>
    </WorkSignalContext.Provider>
  );
}
