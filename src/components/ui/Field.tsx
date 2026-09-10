/**
 * Field — the labelling, hint and error chrome shared by every form control,
 * so accessibility is structural instead of remembered per tool.
 *
 * Decisions recorded here:
 *
 *  - `Field` renders chrome only. It does NOT wire `aria-describedby` or
 *    `aria-invalid` onto its child. Doing that would need `cloneElement`, which
 *    fails the moment the child is a Server Component, a fragment, or a wrapper
 *    around the real control — all three happen in this codebase. Instead the
 *    control wires itself with the two helpers below, and the id contract is a
 *    plain string both sides derive from.
 *  - `htmlFor` is a required explicit id, not a `useId` call. Rejected `useId`
 *    because it would force `'use client'` on the wrapper every tool page uses,
 *    and because stable ids keep the server markup deep-linkable (`#tool-input`)
 *    and testable.
 *  - The error is colour + icon + text + `role="alert"`. Colour alone would
 *    fail WCAG 1.4.1, and an error that only appears visually is invisible to a
 *    screen reader user who has already moved past the field.
 *  - Hint is described before error, matching the visual order, so the
 *    announcement order matches what a sighted user reads.
 *  - `required` renders an `aria-hidden` asterisk. The real signal is the
 *    control's own `required` attribute; a literal "*" read aloud as "star" is
 *    noise.
 */
import type { ReactNode } from 'react';

import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';

/** Derived ids for the hint and error nodes belonging to control `id`. */
export function fieldIds(id: string): { hintId: string; errorId: string } {
  return { hintId: `${id}-hint`, errorId: `${id}-error` };
}

/**
 * The `aria-describedby` value for control `id`, given the same `hint`/`error`
 * values passed to `Field`. Returns `undefined` when there is nothing to
 * describe, so the attribute is omitted rather than emitted empty.
 */
export function describedBy(
  id: string,
  parts: { hint?: string | boolean; error?: string | boolean },
): string | undefined {
  const { hintId, errorId } = fieldIds(id);
  const ids: string[] = [];
  if (parts.hint) ids.push(hintId);
  if (parts.error) ids.push(errorId);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface FieldProps {
  /** Visible label text. Also the accessible name of the control. */
  label: string;
  /** The `id` of the control this labels. Required — see the note above. */
  htmlFor: string;
  /**
   * `null` is accepted alongside `undefined` because that is the shape the rest
   * of the codebase produces: `useToolRun` hands back `string | null`, and so do
   * the engines' validation helpers. Forcing every caller to write
   * `hint={x ?? undefined}` would be noise at forty call sites and one missed
   * conversion away from a type error at build time.
   */
  hint?: string | null;
  /** Present tense, specific, and it names the fix. Not "Invalid input". */
  error?: string | null;
  /** Marks the label visually. The control still needs its own `required`. */
  required?: boolean;
  /** Mutually exclusive with `required`. Set at most one. */
  optional?: boolean;
  /** Sits at the far end of the label row: a units toggle, a reset link. */
  labelSuffix?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  optional = false,
  labelSuffix,
  children,
  className,
}: FieldProps) {
  const { hintId, errorId } = fieldIds(htmlFor);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-danger-fg">
              *
            </span>
          ) : null}
          {optional ? (
            <span className="ml-1.5 text-2xs uppercase tracking-wide text-fg-subtle">Optional</span>
          ) : null}
        </label>
        {labelSuffix ? (
          <div className="shrink-0 text-xs text-fg-muted">{labelSuffix}</div>
        ) : null}
      </div>

      {children}

      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger-fg">
          <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
