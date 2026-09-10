'use client';

import { useEffect } from 'react';

import { setAnalyticsSink, type AnalyticsEvent } from '@/lib/analytics';
import {
  analyticsProvider,
  plausibleDomain,
  umamiWebsiteId,
} from '@/lib/analytics-config';

/**
 * Connects the typed event vocabulary to whichever provider is configured.
 *
 * This is the only place a vendor's API surface appears. `track()` callers pass a
 * `AnalyticsEvent`; the translation to `plausible(name, {props})` or
 * `umami.track(name, props)` happens here, so swapping providers touches one
 * file and no tool.
 *
 * Renders nothing. It exists for its effect, and it installs the sink in an
 * effect rather than at module scope so nothing is collected during server
 * rendering — where `window` does not exist and there is no user to measure.
 */

type PlausibleFn = (event: string, options?: { props?: Record<string, string | number | boolean> }) => void;

declare global {
  interface Window {
    plausible?: PlausibleFn & { q?: unknown[] };
    umami?: { track: (event: string, data?: Record<string, unknown>) => void };
  }
}

/**
 * Flatten an event into provider props.
 *
 * `name` becomes the event name and everything else becomes a property. The
 * spread is safe because {@link AnalyticsEvent} admits only bounded scalars —
 * that closed union is what guarantees a file name or a pasted token cannot
 * reach a third party through this function.
 */
function toProps(event: AnalyticsEvent): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === 'name' || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      props[key] = value;
    }
  }
  return props;
}

export function AnalyticsSink() {
  useEffect(() => {
    if (analyticsProvider === 'plausible' && plausibleDomain !== undefined) {
      // Plausible's documented queue shim. Installed before the script loads so
      // an event fired during hydration is buffered instead of dropped, and
      // overwritten by the real function once the script arrives.
      if (window.plausible === undefined) {
        const queued: PlausibleFn & { q: unknown[] } = ((name, options) => {
          queued.q.push([name, options]);
        }) as PlausibleFn & { q: unknown[] };
        queued.q = [];
        window.plausible = queued;
      }
      setAnalyticsSink((event) => {
        window.plausible?.(event.name, { props: toProps(event) });
      });
    } else if (analyticsProvider === 'umami' && umamiWebsiteId !== undefined) {
      // Umami has no queue shim; an event before load is genuinely lost. That is
      // acceptable for aggregate counts and better than shipping a fake buffer
      // that silently changes event timestamps.
      setAnalyticsSink((event) => {
        window.umami?.track(event.name, toProps(event));
      });
    }

    // Restore the no-op on unmount so a stale closure can never outlive the
    // provider it was built for.
    return () => setAnalyticsSink(null);
  }, []);

  return null;
}

