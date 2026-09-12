import Script from 'next/script';

import {
  analyticsHasCustomEvents,
  analyticsProvider,
  analyticsScriptSrc,
  cloudflareBeaconToken,
  plausibleDomain,
  umamiWebsiteId,
} from '@/lib/analytics-config';
import { AnalyticsSink } from './AnalyticsSink';

/**
 * Mounts analytics, or nothing.
 *
 * `afterInteractive` rather than `lazyOnload`: unlike the ad loader this is a few
 * kilobytes, and loading it late means losing the pageview of anyone who bounces
 * quickly — which is exactly the cohort worth understanding.
 *
 * `data-*` attributes carry the site identity, so the script needs no inline
 * configuration and the CSP can stay free of `'unsafe-inline'` for scripts.
 */
export function Analytics() {
  const src = analyticsScriptSrc();
  if (src === undefined) return null;

  return (
    <>
      {analyticsProvider === 'cloudflare' ? (
        // The token travels as JSON in a data attribute, which is the shape
        // Cloudflare's loader reads. Only needed on the manual path — a proxied
        // domain can have this injected at the edge instead, with no script of
        // ours on the page at all.
        <Script
          id="analytics"
          src={src}
          strategy="afterInteractive"
          data-cf-beacon={JSON.stringify({ token: cloudflareBeaconToken })}
          defer
        />
      ) : analyticsProvider === 'plausible' ? (
        <Script
          id="analytics"
          src={src}
          strategy="afterInteractive"
          data-domain={plausibleDomain}
          defer
        />
      ) : (
        <Script
          id="analytics"
          src={src}
          strategy="afterInteractive"
          data-website-id={umamiWebsiteId}
          defer
        />
      )}
      {/* Not mounted for a provider with no custom-event API: see
          `analyticsHasCustomEvents`. */}
      {analyticsHasCustomEvents ? <AnalyticsSink /> : null}
    </>
  );
}
