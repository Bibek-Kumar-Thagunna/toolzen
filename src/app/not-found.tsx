import Link from 'next/link';

import { routes } from '@/lib/site';
import { buildMetadata } from '@/lib/seo';
import { popularTools, toolCount } from '@/lib/registry';
import { Container } from '@/components/layout/Container';
import { buttonClasses } from '@/components/ui/Button';
import { Icon } from '@/components/icons';

/**
 * 404.
 *
 * Treated as a navigation problem rather than an apology. Someone who lands here
 * mistyped a URL or followed a stale link, and the useful response is the shortest
 * path to the tool they wanted: search, the full index, and the handful of tools
 * most people arrive for. A page that says only "not found" wastes the visit.
 *
 * `noIndex` because a soft 404 in the index is worse than no page at all.
 */
export const metadata = buildMetadata({
  title: 'Page not found',
  description: 'That page does not exist. Browse every tool, or jump to a popular one.',
  path: '/404',
  noIndex: true,
});

export default function NotFound() {
  return (
    <Container size="tool" as="section" className="py-16 sm:py-24">
      <p className="text-2xs font-semibold uppercase tracking-widest text-fg-muted">Error 404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        We could not find that page
      </h1>
      <p className="mt-4 max-w-prose text-md text-fg-muted">
        The link may be out of date, or the address may have a typo in it. Everything on the site is
        reachable from the tool index — all {toolCount} of them.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        {/* `buttonClasses()`, not `<Button>`: Button always renders a real
            `<button>`, so navigation borrows the styling instead of the element
            and keeps middle-click and ⌘-click working. */}
        <Link href={routes.tools} className={buttonClasses({ variant: 'primary' })}>
          <Icon name="grid" size={16} className="shrink-0" />
          Browse all tools
        </Link>
        <Link href={routes.home} className={buttonClasses({ variant: 'secondary' })}>
          <Icon name="home" size={16} className="shrink-0" />
          Go to the homepage
        </Link>
      </div>

      <h2 className="mt-12 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Popular tools
      </h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {popularTools.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={routes.tool(tool.slug)}
              className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-3 text-sm text-fg hover:bg-surface-hover"
            >
              <Icon name={tool.icon} size={16} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 truncate font-medium">{tool.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
