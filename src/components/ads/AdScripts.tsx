import Script from 'next/script';

import { adsenseScriptSrc } from '@/lib/ads/config';

/**
 * Loads the ad provider's script, or renders nothing.
 *
 * Mounted once from the root layout. `lazyOnload` is chosen over
 * `afterInteractive`: the loader is ~100KB of third-party JavaScript that no
 * tool needs, and letting it compete with the engine a user is waiting on would
 * trade a real interaction for an impression. `beforeInteractive` would be
 * indefensible here.
 *
 * When ads are unconfigured this returns `null`, so a local run, a CI build and a
 * self-hosted deployment make no third-party request at all — which is what makes
 * the privacy position defensible rather than aspirational.
 */
export function AdScripts() {
  const src = adsenseScriptSrc();
  if (src === undefined) return null;

  return <Script id="ads-provider" src={src} strategy="lazyOnload" crossOrigin="anonymous" async />;
}
