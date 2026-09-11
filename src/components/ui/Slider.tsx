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

  // The percentage of the track to the left of the thumb. WebKit has no
  // progress pseudo-element, so the filled portion is a gradient stop and this
  // is the number it stops at. Clamped because a value outside min..max would
  // otherwise produce a gradient the browser silently refuses to paint.
  const min = readCurrent(rest.min) ?? 0;
  const max = readCurrent(rest.max) ?? 100;
  const position = readCurrent(value);
  const fill =
    position === undefined || max <= min
      ? 0
      : Math.min(100, Math.max(0, ((position - min) / (max - min)) * 100));

  return (
    <div className="flex items-center gap-3">
      <input
        {...rest}
        ref={ref}
        type="range"
        value={value}
        style={{ ['--slider-fill' as string]: `${fill}%`, ...rest.style }}
        className={cn('range-input flex-1', className)}
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
