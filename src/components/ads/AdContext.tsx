'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * ============================================================================
 * AD ENVIRONMENT
 * ============================================================================
 * Two flags that let a region of the page refuse ads, expressed as context so an
 * `<AdSlot>` nested at any depth obeys without every intermediate component
 * having to pass a prop down. Prop-drilling this would work exactly until
 * someone added a slot inside a subcomponent and forgot.
 *
 * `adFree` — a hard exclusion. Inside an {@link AdFreeZone} an `AdSlot` renders
 * `null`, no reservation, no markup. This is what wraps the interactive
 * workspace: the drop zone, the controls, the progress indicator, the result and
 * the download button. No ad can appear among them even by mistake, because the
 * component that would render one has been told to render nothing.
 *
 * `busy` — a temporary hold. While a tool is processing, existing ads stay
 * exactly where they are and no *new* ad is initialised. A unit that arrives
 * mid-conversion is the worst possible moment for one: the user is watching a
 * progress bar, an iframe expands, and the download button they were about to
 * press has moved. Holding initialisation until the work finishes costs a second
 * of impression and removes the entire class of misclick.
 * ============================================================================
 */

export interface AdEnvironment {
  adFree: boolean;
  busy: boolean;
}

const AdEnvironmentContext = createContext<AdEnvironment>({ adFree: false, busy: false });

export function useAdEnvironment(): AdEnvironment {
  return useContext(AdEnvironmentContext);
}

/**
 * Marks a region as permanently ad-free. Nesting is safe and additive: once
 * inside a zone, a child cannot opt back in, because there is no prop that would
 * let it. That asymmetry is deliberate.
 */
export function AdFreeZone({ children }: { children: ReactNode }) {
  const outer = useAdEnvironment();
  const value = useMemo<AdEnvironment>(() => ({ adFree: true, busy: outer.busy }), [outer.busy]);
  return <AdEnvironmentContext.Provider value={value}>{children}</AdEnvironmentContext.Provider>;
}

/**
 * Announces that work is in flight. The tool shell wraps the whole page in this
 * and flips `busy` while an engine runs, so slots *outside* the workspace — the
 * rail, the unit below the article — also hold off. A page that is quiet
 * everywhere except the progress bar is the goal.
 */
export function AdActivity({ busy, children }: { busy: boolean; children: ReactNode }) {
  const outer = useAdEnvironment();
  const value = useMemo<AdEnvironment>(
    () => ({ adFree: outer.adFree, busy: busy || outer.busy }),
    [outer.adFree, outer.busy, busy],
  );
  return <AdEnvironmentContext.Provider value={value}>{children}</AdEnvironmentContext.Provider>;
}
