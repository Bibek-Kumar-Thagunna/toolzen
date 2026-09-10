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

export type AnalyticsProvider = 'none' | 'plausible' | 'umami';

function readProvider(): AnalyticsProvider {
  const value = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  if (value === 'plausible' || value === 'umami') return value;
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
  return undefined;
}

export const analyticsEnabled: boolean = analyticsScriptSrc() !== undefined;

/**
 * Origins for the CSP. Kept beside the provider choice so `nginx.conf` can be
 * generated from configuration rather than from someone's memory of which hosts
 * this deployment talks to.
 */
export const analyticsOrigins: readonly string[] = (() => {
  if (analyticsProvider === 'plausible') return [plausibleHost];
  if (analyticsProvider === 'umami' && umamiHost !== undefined) return [umamiHost];
  return [];
})();
