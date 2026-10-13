"use client";

import * as React from "react";
import { cn } from "@astrodx/ui/lib/utils";

/**
 * A single-line label that gently auto-scrolls to reveal its full text when it
 * overflows, then returns — so long names (a version tile's "maimai DX BUDDiES
 * PLUS", the music player's current track) aren't simply clipped. Only
 * overflowing labels animate; the full text is always in the `title`, and
 * reduced-motion users get the static label via the CSS guard in globals.css.
 *
 * `active={false}` holds it still with an ellipsis instead — the music player
 * only scrolls the title while a track is playing.
 */
export function ScrollingLabel({
  text,
  active = true,
  className,
  containerClassName,
}: {
  text: string;
  active?: boolean;
  className?: string;
  containerClassName?: string;
}) {
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const [shift, setShift] = React.useState(0);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // The container's scrollWidth covers the text whether it is laid out
    // inline (ellipsis) or as an inline-block (scrolling).
    const measure = () => {
      setShift(Math.max(0, Math.ceil(container.scrollWidth - container.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text]);

  const scrolling = active && shift > 1;
  // Scale the cycle to the travel distance (~28px/s over the ~60% of the cycle
  // spent moving) with a floor so short overflows don't whip past.
  const duration = Math.max(6, Math.round((shift / 28) * 3 + 3));

  // A block-level span rather than a div, so it can sit inside a heading.
  return (
    <span
      ref={containerRef}
      className={cn("block overflow-hidden whitespace-nowrap", !scrolling && "text-ellipsis", containerClassName)}
      title={text}
    >
      <span
        data-marquee={scrolling ? "on" : undefined}
        // An inline-block can't be ellipsized, so it is one only while moving.
        className={cn(scrolling && "inline-block", className)}
        style={
          scrolling
            ? ({
                animation: `marquee-reveal ${duration}s ease-in-out infinite`,
                "--marquee-shift": `-${shift}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
