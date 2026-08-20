"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";

import { AnimatePresence, motion, springSoft } from "@/components/motion";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { CompatibleImage } from "@/components/site/compatible-image";
import { Card } from "@/components/ui/card";
import { versionShortName } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { VERSION_IMAGE_DIMENSIONS, versionImageSourcesByIndex } from "@/lib/version-image";
import { cn } from "@/lib/utils";

// versionid 13 = "maimai DX" (first DX-era version); 0–12 are classic maimai.
const DX_ERA_MIN_INDEX = 13;

/** Which cabinet badge marks a version's era: DX (でらっくす) or SD (スタンダード). */
export function versionEraCabinet(imageIndex: number | null): "DX" | "SD" | null {
  if (imageIndex === null) {
    return null;
  }
  return imageIndex >= DX_ERA_MIN_INDEX ? "DX" : "SD";
}

type VersionTileCardProps = {
  /** Raw version name (may be "Unknown"); localized + short-formed internally. */
  name: string;
  imageIndex: number | null;
  count: number;
  locale: Locale;
  /**
   * Overrides the corner badge text. /music counts playable tracks rather than
   * charts, and "N charts" would be a different (smaller) number than the one
   * its play button actually queues.
   */
  countLabel?: string;
  /** Select mode swaps the top-left #index badge for a checkbox (batch download). */
  selectMode?: boolean;
  selected?: boolean;
};

/**
 * The version logo tile shared by the versions index grid and the homepage's
 * "browse by version" teaser: a framed logo with a chronological #index badge,
 * a chart-count badge, and an era-cabinet icon beside the (scrolling) short name.
 * The hover lift/border glow is driven by a `group/version` parent on the caller
 * (a <Link> or the selectable checkbox wrapper).
 */
export function VersionTileCard({
  name,
  imageIndex,
  count,
  locale,
  countLabel,
  selectMode = false,
  selected = false,
}: VersionTileCardProps) {
  const versions = getDictionary(locale).versions;
  const label = name === "Unknown" ? versions.unknownLabel : name;
  const sources = imageIndex !== null ? versionImageSourcesByIndex(imageIndex) : null;
  const hasCharts = count > 0;
  const selectableHere = selectMode && hasCharts;
  const eraCabinet = versionEraCabinet(imageIndex);
  // Bottom label: drop the "maimai"/"maimai DX" era prefix (shown as a
  // でらっくす / スタンダード icon instead), leaving just the sub-version
  // (CiRCLE, PRiSM PLUS, GreeN…). Base versions fall back to the full name.
  const shortName =
    name === "Unknown" ? versions.unknownLabel : versionShortName(name) || name;

  return (
    <Card
      size="sm"
      className={cn(
        // pt-0: the image header fills to the card's rounded top corners (Card
        // only auto-drops top padding for a first-child <img>, not our <div>),
        // so the corner badges sit in the actual R-corners.
        "h-full overflow-hidden border border-border/70 bg-card/85 pt-0 transition-all",
        hasCharts &&
          "group-hover/version:border-primary/40 group-hover/version:shadow-lg group-hover/version:shadow-primary/10",
        !hasCharts && "opacity-45",
        selectableHere && selected && "border-primary ring-2 ring-primary"
      )}
    >
      <div className="relative flex aspect-[332/160] items-center justify-center bg-background/60 p-4">
        {sources ? (
          <CompatibleImage
            sources={sources}
            alt={label}
            width={VERSION_IMAGE_DIMENSIONS.width}
            height={VERSION_IMAGE_DIMENSIONS.height}
            className={cn(
              // max-w-full guards against a logo whose aspect is wider than the
              // tile ever exceeding the column (w-auto alone isn't capped by
              // object-contain).
              "h-full w-auto max-w-full object-contain",
              hasCharts && "transition-transform group-hover/version:scale-[1.03]"
            )}
          />
        ) : (
          <span className="text-center text-lg font-semibold text-muted-foreground">
            {label}
          </span>
        )}
        {/* Top-left: the selection checkbox in select mode, otherwise the
            version's chronological index as a compact id. The two badges swap
            with a scale pop; initial={false} keeps the SSR'd index badge (and
            the first client render) static. */}
        <AnimatePresence initial={false}>
          {selectableHere ? (
            <motion.span
              key="select-badge"
              aria-hidden="true"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={springSoft}
              className={cn(
                "absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/70 bg-background/80 text-transparent"
              )}
            >
              <motion.span
                className="inline-flex"
                initial={false}
                animate={selected ? { scale: 1 } : { scale: 0 }}
                transition={springSoft}
              >
                <CheckIcon className="size-4" />
              </motion.span>
            </motion.span>
          ) : imageIndex !== null ? (
            <motion.span
              key="index-badge"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={springSoft}
              className="absolute top-2 left-2 rounded-md bg-background/85 px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm"
            >
              #{imageIndex}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {/* Top-right: chart count, overlaid so the name below gets the full
            width to scroll. */}
        <span
          className={cn(
            "absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums shadow-sm ring-1 backdrop-blur-sm",
            hasCharts
              ? "bg-background/85 text-foreground ring-border/60"
              : "bg-background/70 text-muted-foreground ring-border/50"
          )}
        >
          {countLabel ?? versions.chartCount(count)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-1" title={label}>
        {eraCabinet ? <CabinetBadge cabinet={eraCabinet} className="h-4 shrink-0" /> : null}
        {shortName ? (
          <ScrollingLabel
            text={shortName}
            className="text-sm font-medium"
            containerClassName="min-w-0 flex-1"
          />
        ) : null}
      </div>
    </Card>
  );
}

/**
 * A single-line label that gently auto-scrolls to reveal its full text when it
 * overflows the tile, then returns — so long version names ("maimai DX BUDDiES
 * PLUS") aren't clipped on a narrow two-column mobile layout. Only overflowing
 * labels animate; the full name is always in the `title`, and reduced-motion
 * users get the static (non-scrolling) label via the CSS guard in globals.css.
 */
function ScrollingLabel({
  text,
  className,
  containerClassName,
}: {
  text: string;
  className?: string;
  containerClassName?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [shift, setShift] = React.useState(0);

  React.useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) {
      return;
    }
    const measure = () => {
      setShift(Math.max(0, Math.ceil(textEl.scrollWidth - container.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text]);

  const scrolling = shift > 1;
  // Scale the cycle to the travel distance (~28px/s over the ~60% of the cycle
  // spent moving) with a floor so short overflows don't whip past.
  const duration = Math.max(6, Math.round((shift / 28) * 3 + 3));

  return (
    <div ref={containerRef} className={cn("overflow-hidden", containerClassName)} title={text}>
      <span
        ref={textRef}
        data-marquee={scrolling ? "on" : undefined}
        className={cn("inline-block whitespace-nowrap", className)}
        style={
          scrolling
            ? ({
                animation: `marquee-reveal ${duration}s ease-in-out infinite`,
                ["--marquee-shift"]: `-${shift}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}
