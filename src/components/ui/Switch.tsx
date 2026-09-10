/**
 * Switch — a two-state toggle whose effect is immediate (no Apply button).
 *
 * Decisions recorded here:
 *
 *  - No `'use client'`. This is a controlled component with no hooks: it takes
 *    `checked` and hands back the next value. The module that owns the state is
 *    the client module, and Switch joins that graph when imported. Corollary
 *    worth knowing: rendered directly from a Server Component it is inert,
 *    because nothing hydrates it.
 *  - `<button role="switch">`, not `<input type="checkbox">`. A checkbox
 *    announces "checked/unchecked" for a setting that is really on/off, and
 *    styling the native box into a track and knob means fighting the user
 *    agent. `role="switch"` + `aria-checked` is the ARIA-specified pattern and
 *    gets "on/off" from every current screen reader.
 *  - `label` is required and becomes `aria-label`, so an accessible name cannot
 *    be forgotten. Note that a visible `<label for>` DOES associate with a
 *    button (buttons are labelable), but `aria-label` wins the name computation
 *    when both exist — so when a visible label is present, pass its exact text
 *    here, or WCAG 2.5.3 Label in Name breaks.
 *  - State is never colour alone: the knob moves, `aria-checked` carries it to
 *    assistive tech, and at `md` a `check` glyph appears inside the knob.
 *  - Colours deviate from the obvious `bg-border-strong` for the off track,
 *    which was rejected on measurement: in the light theme it is 1.5:1 against
 *    the canvas and 1.5:1 against a surface-coloured knob, failing WCAG 1.4.11
 *    twice. The shipped combination was measured in both themes and clears 3:1
 *    on every boundary that carries meaning — track against page (3.6:1 light,
 *    4.4:1 dark), knob against track (3.3:1 / 4.3:1 off, 5.2:1 / 6.6:1 on),
 *    and on-fill against off-fill (4.6:1 / 6.8:1).
 *  - The visible track is only 24px tall, so a `::before` overlay grows the hit
 *    area to 40px without inflating the focus ring, which stays hugging the
 *    track. Rejected padding the button itself: that draws a 40px-tall ring
 *    around a 24px control.
 */
import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react';

import { Icon } from '@/components/icons';
import { cn } from '@/lib/cn';

export type SwitchSize = 'sm' | 'md';

const trackClasses: Record<SwitchSize, string> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
};

const knobClasses: Record<SwitchSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
};

/** Inner width minus knob minus the 1px inset on each side. */
const knobTravel: Record<SwitchSize, string> = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
};

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'role' | 'aria-checked' | 'aria-label' | 'children' | 'type' | 'value'
  > {
  checked: boolean;
  /**
   * Named `onCheckedChange`, not `onChange`: a prop called `onChange` on a
   * `<button>` would shadow the native `FormEventHandler` with a different
   * signature, which is exactly the kind of trap that ships a silent bug.
   */
  onCheckedChange?: (checked: boolean) => void;
  /** Accessible name. Must match the visible label text when there is one. */
  label: string;
  size?: SwitchSize;
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLButtonElement>;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  size = 'md',
  className,
  onClick,
  ref,
  ...rest
}: SwitchProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (!event.defaultPrevented) onCheckedChange?.(!checked);
  }

  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={handleClick}
      className={cn(
        'relative inline-flex shrink-0 rounded-full border transition-colors duration-fast ease-out',
        "before:absolute before:left-0 before:top-1/2 before:h-10 before:w-full",
        "before:-translate-y-1/2 before:content-['']",
        'disabled:cursor-not-allowed disabled:opacity-[0.55]',
        trackClasses[size],
        checked ? 'border-accent bg-accent' : 'border-fg-subtle bg-surface-sunken',
        className,
      )}
    >
      <span
        className={cn(
          'absolute left-px top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full',
          'transition-transform duration-fast ease-out',
          knobClasses[size],
          checked ? `${knobTravel[size]} bg-surface` : 'translate-x-0 bg-fg-subtle',
        )}
      >
        {checked && size === 'md' ? <Icon name="check" size={12} className="text-accent" /> : null}
      </span>
    </button>
  );
}
