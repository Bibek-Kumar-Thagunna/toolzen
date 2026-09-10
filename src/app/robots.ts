import type { MetadataRoute } from 'next';

import { siteUrl, isIndexableDeployment } from '@/lib/site';

/**
 * ============================================================================
 * robots.txt
 * ============================================================================
 * Generated rather than static, because two of its lines depend on the
 * environment: the sitemap URL has to be absolute, and a non-production build
 * must not invite crawlers at all. See {@link isIndexableDeployment} for why
 * that guard exists and what it does not cover.
 *
 * ── What is disallowed, and what deliberately is not ────────────────────────
 * `/api/` is excluded because nothing under it is a page. Every tool that runs
 * in the browser has no API route at all; the ones that may later need a server
 * worker would expose an endpoint that returns a file or an error, never HTML,
 * so a crawler spending its budget there gets nothing and may report soft 404s.
 *
 * Query strings are *not* disallowed. `/tools?q=…` is a real, useful page and
 * the canonical tag on it already points at `/tools`, which is the correct way
 * to handle a filtered view — `Disallow: /*?*` would instead stop the crawler
 * from ever reading that canonical, leaving the parameterised URLs indexable
 * and unexplained.
 *
 * There is no `Crawl-delay`. On a 4 vCPU VPS serving pre-rendered static pages
 * through nginx, crawl traffic is not the load that matters, and the directive
 * is ignored by Google anyway.
 *
 * AI crawlers are not blocked. The pages here are tool documentation whose
 * value is in being found; there is no proprietary corpus to protect, and a
 * blanket block on the assistants people increasingly use to find tools would
 * cost discovery for no gain. That is a product decision, easy to revisit in
 * this one file.
 * ============================================================================
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
