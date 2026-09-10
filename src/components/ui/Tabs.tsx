'use client';

/**
 * Tabs — WAI-ARIA Tabs pattern, horizontal, controlled.
 *
 * ── Manual activation, and why ──────────────────────────────────────────────
 * Arrow keys move focus between tabs; Enter, Space or a click activates. The
 * alternative (automatic activation, where the arrow key both moves focus and
 * switches panels) is genuinely nicer for cheap panels — it is one keypress
 * instead of two, and APG recommends it as the default.
 *
 * We are not using it, because the panels here are not cheap. This component
 * renders one panel at a time and the parent decides what that panel is, and on
 * this product a panel is a tool surface: a file drop zone, a canvas preview, a
 * pdf.js worker, an image decode. Automatic activation on a roving arrow key
 * would mount and tear down each of those on the way past — three wasted worker
 * boots to get from the first tab to the fourth. Manual activation lets a
 * keyboard user survey the tabs and commit once, which is the same thing a mouse
 * user does.
 *
 * The cost is honest: one extra keypress, and users who expect auto-activation
 * may pause. That is the better trade when the wrong guess costs a worker boot.
 * If this ever gets used for a set of trivial panels, that usage wants a
 * different component rather than a prop — a mode flag would make the keyboard
 * contract unpredictable across the site.
 *
 * Enter and Space need no key handling at all: each tab is a real `<button>`, so
 * the platform already fires `click` for both. That is most of the reason to use
 * a button here rather than a styled `<div role="tab">`.
 *
 * ── Controlled only ─────────────────────────────────────────────────────────
 * No internal state. `value` can then come from a URL query param (shareable
 * deep links into a tool's "Options" tab), a parent reducer, or session storage,
 * without this component fighting any of them for ownership.
 *
 * ── One panel element, many tabs ────────────────────────────────────────────
 * Since the parent renders only the active panel, there is exactly one
 * `role="tabpanel"` in the DOM, and every tab's `aria-controls` points at it.
 * That is accurate: they all control that one region. Pointing each tab at an
 * id that does not exist — the usual outcome when panels are lazily rendered —
 * is not.
 *
 * ── Overflow tradeoff ───────────────────────────────────────────────────────
 * On narrow screens the strip scrolls (`overflow-x-auto scrollbar-thin`). CSS
 * cannot clip one axis and leave the other visible: `overflow-x: auto` forces
 * `overflow-y` to `auto` as well, so the focus ring on the tabs is clipped at
 * the bottom edge by the scroll container no matter what. `px-0.5 pt-0.5` buys
 * back the left, right and top; the bottom stays clipped. `scroll-px-6` makes
 * the browser leave 24px of slack when it scrolls a newly focused tab into view,
 * so a keyboard user never lands on a tab jammed against the edge. Accepted:
 * the ring is visible on three sides, which still passes 2.4.7, and the
 * alternative (no scrolling, wrapping rows) breaks the tab metaphor.
 */
import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export interface TabDescriptor {
  id: string;
  label: string;
  /** Decorative — the label is right there. */
  icon?: IconName;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  value: string;
  onValueChange: (id: string) => void;
  /** The active panel's content. The parent renders one panel, not all of them. */
  children?: ReactNode;
  /** Names the tablist, e.g. "Compression options". Required: an unnamed tablist is a puzzle. */
  ariaLabel: string;
  className?: string;
}

export function Tabs({ tabs, value, onValueChange, children, ariaLabel, className }: TabsProps) {
  const base = useId();
  const panelId = `${base}-panel`;
  const tabId = (id: string) => `${base}-tab-${id}`;

  // React 19: `ref` is an ordinary prop, so there is no `forwardRef` here. The
  // callback body is wrapped in braces on purpose — React 19 treats a returned
  // value from a ref callback as a cleanup function and warns on anything else,
  // and `ref={(n) => (arr[i] = n)}` would return the node.
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = tabs.findIndex((tab) => tab.id === value);
  // If `value` matches nothing — a stale URL param, a typo — no tab is selected,
  // but the strip must still be reachable with Tab. Park the roving tabindex on
  // the first tab in that case.
  const rovingIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }

    // Stops Home/End scrolling the page and the arrows scrolling the strip out
    // from under the focus we are about to move.
    event.preventDefault();
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div className="border-b border-border">
        <div className="scrollbar-thin -mb-px overflow-x-auto scroll-px-6 px-0.5 pt-0.5">
          <div
            role="tablist"
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            className="flex min-w-max gap-1"
          >
            {tabs.map((tab, index) => {
              const selected = index === selectedIndex;

              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    buttonsRef.current[index] = node;
                  }}
                  type="button"
                  id={tabId(tab.id)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={index === rovingIndex ? 0 : -1}
                  onClick={() => onValueChange(tab.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-t border-b-2 px-3 py-2 text-sm transition-colors duration-fast',
                    // Weight changes with state as well as colour, so the active
                    // tab is not identified by hue alone.
                    selected
                      ? 'border-accent font-medium text-fg'
                      : 'border-transparent font-normal text-fg-muted hover:border-border-strong hover:text-fg',
                  )}
                >
                  {tab.icon ? <Icon name={tab.icon} size={16} className="shrink-0" /> : null}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* `tabIndex={0}` per APG: a panel whose content happens to hold nothing
          focusable would otherwise be unreachable, and the user would have no
          way to scroll it from the keyboard. */}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={selectedIndex === -1 ? undefined : tabId(value)}
        tabIndex={0}
        className="pt-4"
      >
        {children}
      </div>
    </div>
  );
}
