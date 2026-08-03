"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * A two-thumb range slider whose track is a gradient.
 *
 * The gradient is the point, not decoration: on the level and BPM filters the
 * track runs through the same colours those values carry elsewhere on the site
 * (Basic-green→Re:Master-violet, slow-sky→fast-rose), so a thumb's position
 * reads as "around Master" or "around fast" before you look at the numbers.
 *
 * The gradient is painted once across the whole track and the *outside* of the
 * selection is then veiled, rather than painting the selected span on its own —
 * that way a narrow range keeps the exact colours it has on the full scale
 * instead of restretching the entire ramp into a few pixels.
 *
 * `gradient` is any CSS gradient value (a `linear-gradient(...)`).
 */
function RangeSlider({
  className,
  gradient,
  formatValue,
  renderThumbValue,
  reversed = false,
  min = 0,
  max = 100,
  ...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "value" | "defaultValue" | "dir"> & {
  value: number[]
  gradient: string
  /** Accessible label per thumb, e.g. (v, i) => (i === 0 ? `最低 ${v}` : `最高 ${v}`). */
  formatValue?: (value: number, index: number) => string
  /** Short text shown under each thumb — the value it currently sits on. */
  renderThumbValue?: (value: number, index: number) => string
  /**
   * Put the high end on the left. The values stay in their natural ascending
   * order — only the direction they are laid out in flips — so callers index
   * `value[0]` as the low end either way. `gradient` is always given in visual
   * left-to-right order, so a reversed slider wants a reversed gradient.
   */
  reversed?: boolean
}) {
  const values = props.value
  const span = max - min || 1
  const toPercent = (value: number) => ((value - min) / span) * 100
  const lowPercent = toPercent(values[0])
  const highPercent = toPercent(values[values.length - 1])
  // Distance from each visual edge to the selection. Reversed, the low value is
  // the one on the right, so the two veils swap.
  const leadingVeil = reversed ? 100 - highPercent : lowPercent
  const trailingVeil = reversed ? lowPercent : 100 - highPercent

  return (
    <SliderPrimitive.Root
      data-slot="range-slider"
      min={min}
      max={max}
      // Radix lays the track out right-to-left and adapts arrow-key direction.
      dir={reversed ? "rtl" : "ltr"}
      className={cn(
        // Bottom padding leaves room for the per-thumb value labels below.
        "relative flex w-full touch-none items-center pt-1.5 pb-5 select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="range-slider-track"
        className="relative h-2 w-full grow overflow-hidden rounded-full"
        style={{ backgroundImage: gradient }}
      >
        {/* Veils over the unselected head and tail. Decorative — the value is
            announced by the thumbs — and pointer-transparent so a click on the
            dimmed part still seeks the nearest thumb. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-background/75"
          style={{ width: `${leadingVeil}%` }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 bg-background/75"
          style={{ width: `${trailingVeil}%` }}
        />
      </SliderPrimitive.Track>
      {values.map((value, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="range-slider-thumb"
          aria-label={formatValue?.(value, index)}
          className="relative block size-4 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm transition-shadow hover:ring-4 hover:ring-primary/20 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-hidden"
        >
          {renderThumbValue ? (
            // Rides under its own thumb so the two ends are read off where they
            // sit, not from a separate readout. aria-hidden because the thumb's
            // aria-label already announces the same value with its role.
            <span
              aria-hidden="true"
              // Explicitly LTR: a reversed slider sets dir="rtl" on the root, and
              // bidi reordering would render a level like "13+" as "+13".
              dir="ltr"
              className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 text-[0.6875rem] leading-none font-medium tabular-nums text-foreground"
            >
              {renderThumbValue(value, index)}
            </span>
          ) : null}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )
}

export { RangeSlider }
