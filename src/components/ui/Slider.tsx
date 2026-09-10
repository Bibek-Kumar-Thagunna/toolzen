/**
 * Slider — a native `<input type="range">`, styled.
 *
 * Decisions recorded here:
 *
 *  - React 19 pattern: `ref` is a normal prop, so there is no `forwardRef`.
 *    No `'use client'`: props in, DOM out.
 *  - Native range, not a custom drag surface. The native element already has
 *    arrow/Home/End/PageUp keyboard handling, `aria-valuenow` reporting, RTL
 *    awareness and pointer capture. Styling costs a pile of vendor pseudo-element
 *    selectors; re-implementing the behaviour costs correctness.
 *  - `touch-action: none` is deliberately absent. It is the standard fix for a
 *    custom drag handle, but on a real range input the browser already
 *    distinguishes a thumb drag from a page scroll, and suppressing touch
 *    actions only breaks scrolling for users who swipe over the control.
 *  - The input is `h-10` so the drag target is 40px tall. Left to itself an
 *    `appearance-none` range collapses to the height of its 6px track, leaving a
 *    6px-tall hit area. Both engines centre the track inside the taller box.
 *  - `box-border` is set explicitly on the thumbs. Preflight's `*` reset does
 *    not reach vendor pseudo-elements, so without it the 2px border would be
 *    added outside the 20px box and the WebKit centring offset would be wrong.
 *  - The readout is `aria-hidden`. The input already announces its value; a
 *    duplicate node makes a screen reader say the number twice. When the raw
 *    number needs a spoken unit, put `aria-valuetext` on the input.
 *  - Slider owns no state, so `showValue` renders from the `value` prop and does
 *    nothing when the control is uncontrolled. The tidiest placement for the
 *    readout is Field's `labelSuffix`, which the parent already controls; the
 *    inline readout here is for sliders used without a Field.
 */
import type { InputHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/cn';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** React 19: `ref` is a normal prop, no `forwardRef` needed. */
  ref?: Ref<HTMLInputElement>;
  /** Renders the current `value` at the end of the track. Needs `value`. */
  showValue?: boolean;
  formatValue?: (value: number) => string;
  /** Appended to the raw number when `formatValue` is absent. */
  valueSuffix?: string;
}

function readCurrent(value: SliderProps['value']): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function Slider({
  ref,
  showValue = false,
  formatValue,
  valueSuffix,
  className,
  value,
  ...rest
}: SliderProps) {
  const current = showValue ? readCurrent(value) : undefined;
  const readout =
    current === undefined
      ? null
      : (formatValue?.(current) ?? `${current}${valueSuffix ?? ''}`);

  return (
    <div className="flex items-center gap-3">
      <input
        {...rest}
        ref={ref}
        type="range"
        value={value}
        className={cn(
          'h-10 w-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent',
          'disabled:cursor-not-allowed disabled:opacity-[0.55]',
          // Track — WebKit and Blink.
          '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full',
          '[&::-webkit-slider-runnable-track]:bg-surface-sunken',
          // Track — Gecko.
          '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full',
          '[&::-moz-range-track]:bg-surface-sunken',
          // Thumb — WebKit and Blink. -7px re-centres a 20px thumb on a 6px track.
          '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:box-border',
          '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5',
          '[&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2',
          '[&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-surface',
          '[&::-webkit-slider-thumb]:shadow-sm',
          // Thumb — Gecko. It centres itself on the track, so no offset here.
          '[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5',
          '[&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent',
          '[&::-moz-range-thumb]:bg-surface [&::-moz-range-thumb]:shadow-sm',
          className,
        )}
      />
      {readout === null ? null : (
        <span
          aria-hidden="true"
          className="tabular min-w-[3.5rem] shrink-0 text-right text-sm text-fg-muted"
        >
          {readout}
        </span>
      )}
    </div>
  );
}
