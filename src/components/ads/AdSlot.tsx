'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import {
  adPlacements,
  adSlotId,
  adsDebug,
  adsEnabled,
  adsenseClient,
  type AdPlacement,
} from '@/lib/ads/config';
import { useAdEnvironment } from './AdContext';

/**
 * ============================================================================
 * AD SLOT
 * ============================================================================
 * The only component in the codebase permitted to render an advertisement.
 *
 * It renders nothing at all — not an empty box, not a reservation — unless a
 * real unit is going to fill it. The four ways it declines:
 *
 *   1. Inside an `AdFreeZone` (the whole interactive workspace).
 *   2. Ads not configured: no provider, no publisher id, or the flag is off.
 *   3. No slot id for this placement, so a half-configured account shows fewer
 *      ads rather than empty voids.
 *   4. `prefers-reduced-data`, where the polite thing is to skip 300KB of
 *      third-party JavaScript.
 *
 * When it does render, the box is the right size *before* the ad arrives, which
 * is the entire reason placements carry a `reservedClass`. Nothing below an ad
 * ever moves.
 * ============================================================================
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export interface AdSlotProps {
  placement: AdPlacement;
  /** Outer spacing only. The reservation itself is not overridable. */
  className?: string;
}

export function AdSlot({ placement, className }: AdSlotProps) {
  const spec = adPlacements[placement];
  const { adFree, busy } = useAdEnvironment();
  const slot = adSlotId(placement);

  const insRef = useRef<HTMLModElement | null>(null);
  const pushed = useRef(false);
  const [inView, setInView] = useState(!spec.lazy);

  // A user who has asked their OS to save data gets no ad script. The revenue
  // from that cohort is not worth the megabyte, and the request is explicit.
  const [reducedData, setReducedData] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-data: reduce)');
    setReducedData(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedData(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Load a little before the slot arrives, so the unit is filled by the time it
  // is looked at, but not so early that every page view requests four units.
  useEffect(() => {
    if (!spec.lazy || inView) return;
    const node = insRef.current;
    if (!node || typeof IntersectionObserver !== 'function') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [spec.lazy, inView]);

  /**
   * Hand the slot to the provider. Exactly once, and never while the tool is
   * working.
   *
   * `pushed` guards against React's development double-invoke: pushing the same
   * `<ins>` twice makes AdSense throw "already have ads in them" and leaves the
   * slot blank. `busy` is checked here rather than at render, so an in-flight
   * conversion delays the ad instead of unmounting a reservation and shifting the
   * page — the effect simply re-runs when `busy` clears.
   */
  useEffect(() => {
    if (!adsEnabled || adsDebug || reducedData) return;
    if (!inView || busy || pushed.current || slot === undefined) return;
    try {
      window.adsbygoogle = window.adsbygoogle ?? [];
      window.adsbygoogle.push({});
      pushed.current = true;
    } catch {
      // A blocked or failed ad script must never surface to the user or break
      // the tool. The reservation stays empty; that is the whole cost.
    }
  }, [inView, busy, reducedData, slot]);

  if (adFree) return null;
  if (reducedData) return null;
  if (!adsEnabled && !adsDebug) return null;
  if (adsEnabled && (slot === undefined || adsenseClient === undefined)) return null;

  return (
    <aside
      aria-label="Advertisement"
      className={cn('flex flex-col items-center gap-1', spec.visibilityClass, className)}
    >
      {/*
        Labelled so nobody can mistake the unit for part of the tool. This is
        also the honest version of the AdSense clarity requirement: the label
        says what the thing is, in the page's own type, above it rather than
        buried inside the creative.
      */}
      <span className="text-2xs font-medium uppercase tracking-wide text-fg-muted">Advertisement</span>
      {adsDebug ? <DebugReservation placement={placement} /> : null}
      {!adsDebug ? (
        <ins
          ref={insRef}
          className={cn('adsbygoogle block', spec.reservedClass)}
          style={{ display: 'block' }}
          data-ad-client={adsenseClient}
          data-ad-slot={slot}
          data-ad-format={spec.format}
          /*
           * `false` on purpose. Full-width-responsive lets the provider grow the
           * unit past the box we reserved, which is precisely the layout shift
           * this component exists to prevent.
           */
          data-full-width-responsive="false"
        />
      ) : null}
    </aside>
  );
}

/**
 * What `NEXT_PUBLIC_ADS_DEBUG=true` draws: the exact reserved box, outlined, with
 * its placement name and dimensions.
 *
 * Deliberately ugly. It is a measuring tool for reviewing layout at every
 * breakpoint without a live account, and it must never be confusable with an
 * advertisement. It has no image, no headline, no call to action and no click
 * target — `pointer-events-none` means it cannot even be clicked by accident. A
 * placeholder that looked like a plausible ad would be a deceptive pattern, and a
 * placeholder that looked like a button would be the single worst thing in this
 * codebase.
 */
function DebugReservation({ placement }: { placement: AdPlacement }) {
  const spec = adPlacements[placement];
  return (
    <div
      className={cn(
        'pointer-events-none flex w-full max-w-full flex-col items-center justify-center gap-0.5',
        'rounded-md border border-dashed border-border-strong bg-surface-sunken',
        'text-center text-2xs text-fg-muted',
        spec.reservedClass,
      )}
    >
      <span className="font-semibold">Reserved ad space</span>
      <span>
        {spec.label} · {spec.reservedSizes}
      </span>
      <span className="px-2">{spec.lazy ? 'loads near viewport' : 'loads immediately'}</span>
    </div>
  );
}


