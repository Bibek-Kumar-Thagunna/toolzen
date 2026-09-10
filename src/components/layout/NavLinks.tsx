'use client';

/**
 * NavLinks — the category nav in the header on `md` and up.
 *
 * ── Why this one strip is a client component when Header is not ────────────
 * `aria-current="page"` on the active link requires knowing the current path.
 * In the App Router the header lives in `layout.tsx`, which is not re-rendered
 * per navigation and is given no pathname. The server-side alternatives are
 * `headers()` — which opts every page out of static rendering, a bad trade for
 * one attribute on an ad-supported SEO site — or threading an `activeCategory`
 * prop down from each page, which a layout cannot do. `usePathname()` is the
 * supported answer and it is client-only.
 *
 * The cost is deliberately bounded. Props are plain strings (no registry
 * import, so none of the FAQ/prose payload can follow it into the bundle), the
 * markup is still server-rendered so crawlers and no-JS visitors get every
 * link, and hydration is a map over six items.
 *
 * Active state is signalled three ways — weight, background and
 * `aria-current` — because colour alone fails WCAG 1.4.1 and is invisible to
 * the people most likely to be navigating by keyboard.
 *
 * Matching is exact. A tool page (`/tools/compress-image`) does not light up its
 * category, because deciding that would need the tool→category mapping, which
 * lives in the registry and is not allowed across this boundary. `aria-current`
 * means "this link is the page you are on", so exact is also the correct
 * semantics rather than a limitation we are working around.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

export interface NavLinksProps {
  /** Minimal projection; `CategoryLink` from MobileMenu satisfies it. */
  items: { id: string; name: string; href: string }[];
  className?: string;
}

export function NavLinks({ items, className }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Tool categories" className={cn('min-w-0', className)}>
      {/* `role="list"`: Safari drops list semantics from a flex list. */}
      <ul role="list" className="flex items-center">
        {items.map((item) => {
          const isCurrent = pathname === item.href;

          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  // px-2 rather than a gap: the padding is the separation, and
                  // it keeps six labels inside a 768px viewport.
                  'block whitespace-nowrap rounded px-2 py-1.5 text-sm transition-colors duration-fast',
                  isCurrent
                    ? 'bg-accent-subtle font-medium text-accent-fg'
                    : 'font-normal text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                {item.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
