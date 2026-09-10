/**
 * Select — a native `<select>`, deliberately.
 *
 * Rejected a custom listbox (button + popover + `role="listbox"` + option
 * management). The native element gives us, for free and for zero client
 * JavaScript: the platform picker on iOS and Android, full keyboard support
 * including type-ahead, correct focus and dismissal behaviour, screen reader
 * support that is actually tested by the vendors, and form integration. A
 * hand-rolled listbox is roughly 200 lines of client code that has to
 * re-implement all of that and usually gets type-ahead and the mobile case
 * wrong. It only earns its cost for multi-select or rich option rows with
 * icons and secondary text — no tool that ships here needs either.
 *
 * Other decisions:
 *
 *  - React 19 pattern: `ref` is a normal prop, so there is no `forwardRef`.
 *    No `'use client'`: props in, DOM out.
 *  - `appearance-none` removes the platform arrow so one chevron matches the
 *    rest of the icon set across browsers. The drawn chevron is
 *    `pointer-events-none`, so clicking it still opens the menu.
 *  - The dropdown list itself is drawn by the user agent and is not stylable.
 *    It looks right in dark mode because globals.css sets `color-scheme` on
 *    `:root` and `.dark`; that one declaration is what keeps `<option>` text
 *    legible, and it is the reason no hack is needed here.
 *  - One class per axis — the border colour is chosen by `invalid`, never
 *    layered over a base colour. See the specificity note in src/lib/cn.ts.
 */
import type { Ref, SelectHTMLAttributes } from 'react';

import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';

export type SelectSize = 'sm' | 'md' | 'lg';

/** `md` is 40px: the mobile touch-target floor. */
const sizeClasses: Record<SelectSize, string> = {
  sm: 'h-9 text-sm',
  md: 'h-10 text-base',
  lg: 'h-11 text-md',
};

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLSelectElement>;
  /** Paints the invalid border and sets `aria-invalid` unless you set it. */
  invalid?: boolean;
  /** Named `selectSize` because `size` is a real HTML attribute on `<select>`. */
  selectSize?: SelectSize;
}

export function Select({
  ref,
  invalid = false,
  selectSize = 'md',
  className,
  children,
  'aria-invalid': ariaInvalid,
  ...rest
}: SelectProps) {
  return (
    // No `overflow` here, so the global `:focus-visible` ring on the select is
    // free to sit 2px outside its box without being clipped.
    <div className="relative">
      <select
        {...rest}
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        className={cn(
          'w-full appearance-none rounded border bg-surface pl-3 pr-9 text-fg shadow-xs',
          'transition-colors duration-fast ease-out',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle',
          sizeClasses[selectSize],
          invalid ? 'border-danger' : 'border-border hover:border-border-strong',
          className,
        )}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
}
