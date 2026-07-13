"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { CheckIcon } from "lucide-react";

import { AnimatePresence, motion, springSoft } from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { CompatibleImage } from "@/components/site/compatible-image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  versionFolderName,
  versionRouteId,
  versionShortName,
  type ChartDownloadSpec,
  type VersionGroup,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { jsonFetcher } from "@/lib/swr-fetcher";
import { VERSION_IMAGE_DIMENSIONS, versionImageSourcesByIndex } from "@/lib/version-image";
import { cn } from "@/lib/utils";

// Static (build-time) manifest: per-version chart download specs keyed by
// version slug. Fetched only when select mode is first enabled, so the versions
// index page doesn't embed file URLs for the whole catalog.
const VERSION_SPECS_PATH = "/versions/specs.json";

type VersionsBatchGridProps = {
  groups: VersionGroup[];
  /** Optional pre-embedded specs (legacy path); when absent they load lazily. */
  versionCharts?: Record<string, ChartDownloadSpec[]>;
  locale: Locale;
};

export function buildSelectedVersionCharts(
  groups: VersionGroup[],
  specs: Record<string, ChartDownloadSpec[]> | undefined,
  selectedSlugs: ReadonlySet<string>
): ChartDownloadSpec[] {
  if (!specs) {
    return [];
  }

  const selectedGroups = groups.filter((group) => selectedSlugs.has(group.slug));
  return selectedGroups.flatMap((group) => specs[group.slug] ?? []);
}

export function VersionsBatchGrid({
  groups,
  versionCharts,
  locale,
}: VersionsBatchGridProps) {
  const versions = getDictionary(locale).versions;
  const browser = getDictionary(locale).catalogBrowser;
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedSlugs, setSelectedSlugs] = React.useState<ReadonlySet<string>>(new Set());

  const hasEmbeddedSpecs = Boolean(versionCharts && Object.keys(versionCharts).length > 0);
  const { data: fetchedSpecs, error: specsError } = useSWR<
    Record<string, ChartDownloadSpec[]>
  >(selectMode && !hasEmbeddedSpecs ? VERSION_SPECS_PATH : null, jsonFetcher);
  const specs = hasEmbeddedSpecs ? versionCharts : fetchedSpecs;
  const specsPending = selectMode && !specs && !specsError;

  // Selectability comes from the chart count (known statically); the specs
  // manifest is only needed once a download actually starts.
  const selectableSlugs = React.useMemo(
    () => groups.filter((group) => group.count > 0).map((group) => group.slug),
    [groups]
  );

  const toggle = (slug: string) =>
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  const selectAll = () => setSelectedSlugs(new Set(selectableSlugs));
  const clear = () => setSelectedSlugs(new Set());
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedSlugs(new Set());
  };

  // Flatten the selected versions into one chart list for the batch archive.
  // Version folders are part of each global chart download spec.
  const selectedCharts = buildSelectedVersionCharts(groups, specs, selectedSlugs);
  // A single-version selection names its job (and archive) after the version,
  // so concurrent jobs stay distinguishable in the downloads tray. Multi-version
  // selections split into per-version archives anyway.
  const selectedGroups = groups.filter((group) => selectedSlugs.has(group.slug));
  const collectionName =
    selectedGroups.length === 1
      ? versionFolderName(selectedGroups[0].name)
      : browser.batchDefaultName;

  const showBar = selectMode && selectedCharts.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        showBar && "pb-[calc(var(--batch-download-bar-height,6rem)+2rem)]"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={selectMode ? "default" : "outline"}
          size="sm"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          {selectMode ? browser.exitSelectMode : browser.selectMode}
        </Button>
        {selectMode ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={selectAll}>
              {browser.selectAllVersions(selectableSlugs.length)}
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {versions.selectedVersionsCount(selectedSlugs.size)}
            </span>
          </>
        ) : null}
        {/* The batch manifest loads lazily the first time select mode opens. */}
        {specsPending ? (
          <span role="status" className="text-sm text-muted-foreground">
            {browser.specsLoading}
          </span>
        ) : null}
        {selectMode && specsError && !specs ? (
          <span role="status" className="text-sm text-destructive">
            {browser.specsError}
          </span>
        ) : null}
      </div>

      {/* The tile grid is the page's main content: render it visible in the
          prerendered HTML (no hidden-until-hydration reveal animation).
          Two columns from the smallest screens up (the version logos are wide,
          so two fit comfortably even on a 360px phone). */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((group) => {
          const label = group.name === "Unknown" ? versions.unknownLabel : group.name;
          const sources =
            group.imageIndex !== null ? versionImageSourcesByIndex(group.imageIndex) : null;
          const hasCharts = group.count > 0;
          const selectableHere = selectMode && hasCharts;
          const selected = selectedSlugs.has(group.slug);
          // Bottom label: drop the "maimai"/"maimai DX" era prefix (it's shown
          // as a でらっくす / スタンダード icon instead), leaving just the
          // sub-version (CiRCLE, PRiSM PLUS, GreeN…). Base versions have no
          // sub-name, so they fall back to the full name (id 0 → "maimai").
          const eraCabinet = versionEraCabinet(group.imageIndex);
          const shortName =
            group.name === "Unknown"
              ? versions.unknownLabel
              : versionShortName(group.name) || group.name;

          const card = (
            <Card
              size="sm"
              className={cn(
                // pt-0: the image header fills to the card's rounded top corners
                // (Card only auto-drops top padding for a first-child <img>, not
                // our <div>), so the corner badges sit in the actual R-corners.
                "h-full overflow-hidden border border-border/70 bg-card/85 pt-0 transition-all",
                !selectMode &&
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
                      // max-w-full guards against a logo whose aspect is wider
                      // than the tile ever exceeding the column (w-auto alone
                      // isn't capped by object-contain).
                      "h-full w-auto max-w-full object-contain",
                      !selectMode &&
                        hasCharts &&
                        "transition-transform group-hover/version:scale-[1.03]"
                    )}
                  />
                ) : (
                  <span className="text-center text-lg font-semibold text-muted-foreground">
                    {label}
                  </span>
                )}
                {/* Top-left: the selection checkbox in select mode, otherwise
                    the version's chronological index as a compact id. The two
                    badges swap with a scale pop; initial={false} keeps the
                    SSR'd index badge (and the first client render) static. */}
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
                  ) : group.imageIndex !== null ? (
                    <motion.span
                      key="index-badge"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={springSoft}
                      className="absolute top-2 left-2 rounded-md bg-background/85 px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm"
                    >
                      #{group.imageIndex}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                {/* Top-right: chart count, overlaid so the name below gets the
                    full width to scroll. */}
                <span
                  className={cn(
                    "absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums shadow-sm ring-1 backdrop-blur-sm",
                    hasCharts
                      ? "bg-background/85 text-foreground ring-border/60"
                      : "bg-background/70 text-muted-foreground ring-border/50"
                  )}
                >
                  {versions.chartCount(group.count)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 pb-1" title={label}>
                {eraCabinet ? (
                  <CabinetBadge cabinet={eraCabinet} className="h-4 shrink-0" />
                ) : null}
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

          if (selectMode) {
            // 0-chart versions can't be selected; render them dimmed and inert.
            if (!selectableHere) {
              return (
                <div key={group.slug} className="h-full" aria-disabled="true">
                  {card}
                </div>
              );
            }
            return (
              // initial={false}: hover/tap only — nothing is serialized into
              // the prerendered HTML and nothing animates on mount.
              <motion.div
                key={group.slug}
                className="h-full"
                initial={false}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                transition={springSoft}
              >
                <div
                  role="checkbox"
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={() => toggle(group.slug)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(group.slug);
                    }
                  }}
                  className="group/version block h-full cursor-pointer rounded-xl"
                >
                  {card}
                </div>
              </motion.div>
            );
          }

          if (!hasCharts) {
            return (
              <div key={group.slug} className="h-full" aria-disabled="true">
                {card}
              </div>
            );
          }

          return (
            <motion.div
              key={group.slug}
              className="h-full"
              initial={false}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              transition={springSoft}
            >
              <Link
                href={buildLocalePath(`/versions/${versionRouteId(group.imageIndex)}`, locale)}
                className="group/version block h-full rounded-xl"
              >
                {card}
              </Link>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {showBar ? (
          <BatchDownloadBar
            charts={selectedCharts}
            collectionName={collectionName}
            locale={locale}
            onClear={clear}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * A single-line label that gently auto-scrolls to reveal its full text when it
 * overflows the tile, then returns — so long version names ("maimai DX BUDDiES
 * PLUS") aren't clipped on a narrow two-column mobile layout. Only overflowing
 * labels animate; the full name is always in the `title`, and reduced-motion
 * users get the static (non-scrolling) label via the CSS guard in globals.css.
 */
// versionid 13 = "maimai DX" (first DX-era version); 0–12 are classic maimai.
const DX_ERA_MIN_INDEX = 13;

/** Which cabinet badge marks a version's era: DX (でらっくす) or ST (スタンダード). */
function versionEraCabinet(imageIndex: number | null): "DX" | "ST" | null {
  if (imageIndex === null) {
    return null;
  }
  return imageIndex >= DX_ERA_MIN_INDEX ? "DX" : "ST";
}

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
