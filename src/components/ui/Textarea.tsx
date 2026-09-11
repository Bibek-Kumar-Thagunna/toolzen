/**
 * Textarea — the multi-line sibling of Input, for pasted text, JSON, CSV and
 * code.
 *
 * Decisions recorded here:
 *
 *  - React 19 pattern: `ref` is a normal prop, so there is no `forwardRef`.
 *    No `'use client'`: props in, DOM out.
 *  - `resize` defaults to `'vertical'` and never to `'none'`. Tool textareas
 *    hold pasted content of unpredictable length, and a fixed box turns a
 *    200-line payload into a 4-line peephole. `'none'` exists only for the rare
 *    case where the field sits in a strict grid. Horizontal resize is not an
 *    option at all: widening the box past its column breaks the page layout,
 *    and long lines are what `scrollbar-thin` and `overflow-wrap` are for.
 *  - `monospace` also turns spellcheck off. Red squiggles under every identifier
 *    in a JSON blob are pure noise, and the browser's suggestions are wrong for
 *    code by construction.
 *  - `leading-relaxed` rather than the tighter body leading: scanning a pasted
 *    wall of text for the line that broke needs the extra rhythm.
 *  - One class per axis — the border colour is chosen by `invalid`, not layered
 *    over a base colour. See the specificity note in src/lib/cn.ts.
 */
import type { Ref, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLTextAreaElement>;
  /** Paints the invalid border and sets `aria-invalid` unless you set it. */
  invalid?: boolean;
  /** For code, JSON, hashes, base64 — content where column alignment matters. */
  monospace?: boolean;
  resize?: 'none' | 'vertical';
}

export function Textarea({
  ref,
  invalid = false,
  monospace = false,
  resize = 'vertical',
  className,
  spellCheck,
  'aria-invalid': ariaInvalid,
  ...rest
}: TextareaProps) {
  return (
    <textarea
      {...rest}
      ref={ref}
      spellCheck={spellCheck ?? (monospace ? false : undefined)}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={cn(
        'block min-h-32 w-full rounded border bg-surface px-3 py-2.5 text-fg shadow-xs',
        'scrollbar-thin leading-relaxed placeholder:text-fg-subtle',
        'transition-colors duration-fast ease-out',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle',
        // `border-strong` at rest, not on hover: a form field's boundary is
        // what tells somebody there is a field there, so it has to be
        // visible before the pointer arrives — and on a touch screen the
        // pointer never arrives at all.
        invalid ? 'border-danger' : 'border-border-strong hover:border-fg-subtle',
        monospace ? 'font-mono text-sm' : 'text-base',
        resize === 'none' ? 'resize-none' : 'resize-y',
        className,
      )}
    />
  );
}
