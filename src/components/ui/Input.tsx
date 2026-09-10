/**
 * Input — the native `<input>` wearing the project's chrome.
 *
 * Decisions recorded here:
 *
 *  - React 19 pattern: `ref` is a normal prop, so there is no `forwardRef`.
 *  - No `'use client'`. Props in, DOM out.
 *  - Padding is composed per side (`pl-3`/`pl-9`, `pr-3`/`pr-11`) rather than
 *    starting from `px-3` and overriding one side. Two classes touching the
 *    same property rely on stylesheet order to resolve, which src/lib/cn.ts
 *    explicitly refuses to depend on. Same reason the border colour is a single
 *    class chosen by `invalid`, never a base colour plus an override.
 *  - The focus ring stays on the `<input>` itself, where the global
 *    `:focus-visible` rule in globals.css puts it. The decoration wrapper is a
 *    plain `relative` block with no `overflow` clipping, so the 2px ring offset
 *    is not swallowed and no per-component ring is needed.
 *  - `type="number"` loses its spinners. They are ~10px unlabelled targets that
 *    fail WCAG 2.2 target-size, they sit exactly where a mobile thumb rests,
 *    and a scroll wheel over a focused field silently changes the value. Tool
 *    fields want a real numeric keyboard, which `inputMode` provides instead.
 *  - Numeric fields get `tabular` so a live-updating value does not jitter the
 *    caret or reflow a suffix.
 *  - When `iconLeft` or `suffix` is set, size the field from its container.
 *    The decoration is positioned against the wrapper, so a width class on the
 *    input alone would leave it stranded.
 */
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

/** `md` is 40px: the mobile touch-target floor. */
const sizeClasses: Record<InputSize, string> = {
  sm: 'h-9 text-sm',
  md: 'h-10 text-base',
  lg: 'h-11 text-md',
};

const glyphPixels: Record<InputSize, number> = { sm: 16, md: 18, lg: 18 };

/**
 * `appearance: textfield` covers Firefox; the two WebKit pseudo-elements cover
 * Chrome and Safari, which ignore it.
 */
const noSpinners =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none ' +
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLInputElement>;
  /** Paints the invalid border and sets `aria-invalid` unless you set it. */
  invalid?: boolean;
  /** Named `inputSize` because `size` is a real HTML attribute on `<input>`. */
  inputSize?: InputSize;
  iconLeft?: IconName;
  /** A unit label ("kg", "px") or a small action such as a copy button. */
  suffix?: ReactNode;
  /** Tabular figures plus a decimal keypad, without `type="number"`. */
  numeric?: boolean;
}

export function Input({
  ref,
  invalid = false,
  inputSize = 'md',
  iconLeft,
  suffix,
  numeric = false,
  className,
  type,
  inputMode,
  'aria-invalid': ariaInvalid,
  ...rest
}: InputProps) {
  const isNumberType = type === 'number';
  const wantsNumeric = numeric || isNumberType;

  const control = (
    <input
      {...rest}
      ref={ref}
      type={type}
      inputMode={inputMode ?? (wantsNumeric ? 'decimal' : undefined)}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={cn(
        'w-full rounded border bg-surface text-fg shadow-xs placeholder:text-fg-subtle',
        'transition-colors duration-fast ease-out',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle',
        sizeClasses[inputSize],
        invalid ? 'border-danger' : 'border-border hover:border-border-strong',
        iconLeft ? 'pl-9' : 'pl-3',
        suffix ? 'pr-11' : 'pr-3',
        wantsNumeric && 'tabular',
        isNumberType && noSpinners,
        className,
      )}
    />
  );

  if (!iconLeft && !suffix) return control;

  return (
    <div className="relative">
      {iconLeft ? (
        <Icon
          name={iconLeft}
          size={glyphPixels[inputSize]}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
      ) : null}
      {control}
      {suffix ? (
        // Inert by default so a click on a unit label still focuses the field,
        // but direct children opt back in, which keeps a copy button clickable.
        <div
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center',
            'text-sm text-fg-muted [&>*]:pointer-events-auto',
          )}
        >
          {suffix}
        </div>
      ) : null}
    </div>
  );
}
