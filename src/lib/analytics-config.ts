/**
 * ============================================================================
 * ANALYTICS PROVIDER CONFIGURATION
 * ============================================================================
 * Which measurement backend, if any, `src/lib/analytics.ts` sends its typed
 * events to. Separate from `analytics.ts` on purpose: that module is the event
 * vocabulary and must stay free of vendor detail, so the vocabulary survives a
 * change of provider.
 *
 * ── Why Plausible or Umami and not Google Analytics ──
 * Both are cookieless and store no per-visitor identifier, which means the
 * privacy claim on the site stays true and no consent banner is needed to make it
 * true. GA4 would contradict the product's entire position, and a cookie banner
 * on a page whose selling point is "your file never leaves your device" would be
 * an own goal. Both can also be self-hosted on the same VPS later, so this is not
 * a dependency that has to stay third-party.
 *
 * ── Default is none ──
 * Unconfigured means no script, no requests, no collection. "Analytics are off
 * unless someone turns them on" is then a property of the build rather than a
 * promise in a privacy policy.
 * ============================================================================
 */

export type AnalyticsProvider = 'none' | 'plausible' | 'umami' | 'cloudflare';

function readProvider(): AnalyticsProvider {
  const value = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  if (value === 'plausible' || value === 'umami' || value === 'cloudflare') return value;
  return 'none';
}

export const analyticsProvider: AnalyticsProvider = readProvider();

/** Self-hosted instance, or the vendor's default host. */
export const plausibleHost: string =
  process.env.NEXT_PUBLIC_PLAUSIBLE_HOST?.trim().replace(/\/+$/, '') || 'https://plausible.io';

/** The site identifier registered with the provider, not our own domain constant. */
export const plausibleDomain: string | undefined =
  process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim() || undefined;

export const umamiHost: string | undefined =
  process.env.NEXT_PUBLIC_UMAMI_HOST?.trim().replace(/\/+$/, '') || undefined;

export const umamiWebsiteId: string | undefined =
  process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim() || undefined;

/**
 * Cloudflare Web Analytics.
 *
 * Free, cookieless, and sets no per-visitor identifier, so it keeps the privacy
 * page true without a consent banner — the same test the other two providers
 * had to pass.
 *
 * ── The trade it makes, which is not obvious ──────────────────────────────
 * It records page views and Core Web Vitals and **nothing else**. There is no
 * custom-event API, so the typed vocabulary in `analytics.ts` — which tool was
 * started, which run failed and why, what people searched for — has nowhere to
 * go. `Analytics.tsx` therefore does not mount the event sink for this
 * provider, rather than mounting a sink that silently drops everything.
 *
 * That is the right starting choice for a site with no revenue: it costs
 * nothing, needs no code to deploy (Cloudflare can inject the beacon at the
 * edge for a proxied domain), and page popularity plus Search Console queries
 * answer most of what tool-level events would. Switch the variable to
 * `plausible` or `umami` when knowing *which* tools get finished is worth
 * paying for.
 *
 * This constant is only needed for the manual path. If the beacon is injected
 * automatically by the proxy, leave the provider unset and nothing here runs.
 */
export const cloudflareBeaconToken: string | undefined =
  process.env.NEXT_PUBLIC_CF_BEACON_TOKEN?.trim() || undefined;

/** Where the Cloudflare beacon is served from. Fixed by the vendor. */
export const CLOUDFLARE_BEACON_HOST = 'https://static.cloudflareinsights.com';

/**
 * The script URL, or `undefined` when analytics are off or half-configured.
 *
 * `script.tagged-events.js` is the Plausible build that also honours declarative
 * event attributes; the custom-event API this codebase uses is included in it.
 */
export function analyticsScriptSrc(): string | undefined {
  if (analyticsProvider === 'plausible' && plausibleDomain !== undefined) {
    return `${plausibleHost}/js/script.tagged-events.js`;
  }
  if (analyticsProvider === 'umami' && umamiHost !== undefined && umamiWebsiteId !== undefined) {
    return `${umamiHost}/script.js`;
  }
  if (analyticsProvider === 'cloudflare' && cloudflareBeaconToken !== undefined) {
    return `${CLOUDFLARE_BEACON_HOST}/beacon.min.js`;
  }
  return undefined;
}

/**
 * Whether this provider can receive the typed events in `analytics.ts`.
 *
 * False for Cloudflare, which has no custom-event API. The sink is not mounted
 * in that case, so the events are never constructed rather than being built and
 * thrown away.
 */
export const analyticsHasCustomEvents: boolean =
  analyticsProvider === 'plausible' || analyticsProvider === 'umami';

export const analyticsEnabled: boolean = analyticsScriptSrc() !== undefined;

/**
 * Origins for the CSP. Kept beside the provider choice so `nginx.conf` can be
 * generated from configuration rather than from someone's memory of which hosts
 * this deployment talks to.
 */
export const analyticsOrigins: readonly string[] = (() => {
  if (analyticsProvider === 'plausible') return [plausibleHost];
  if (analyticsProvider === 'umami' && umamiHost !== undefined) return [umamiHost];
  if (analyticsProvider === 'cloudflare') return [CLOUDFLARE_BEACON_HOST];
  return [];
})();
