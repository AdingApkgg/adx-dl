"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { AnimatePresence, RevealGroup, RevealItem } from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ChartDownloadSpec, VersionGroup } from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { VERSION_IMAGE_DIMENSIONS, versionImageSrcByIndex } from "@/lib/version-image";
import { cn } from "@/lib/utils";

type VersionsBatchGridProps = {
  groups: VersionGroup[];
  /** Per-version chart download specs (dir + asset urls), keyed by version slug. */
  versionCharts: Record<string, ChartDownloadSpec[]>;
  locale: Locale;
};

export function VersionsBatchGrid({ groups, versionCharts, locale }: VersionsBatchGridProps) {
  const versions = getDictionary(locale).versions;
  const browser = getDictionary(locale).catalogBrowser;
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedSlugs, setSelectedSlugs] = React.useState<ReadonlySet<string>>(new Set());

  const selectableSlugs = React.useMemo(
    () => groups.filter((group) => versionCharts[group.slug]?.length).map((group) => group.slug),
    [groups, versionCharts]
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
  const selectedCharts = React.useMemo(
    () => [...selectedSlugs].flatMap((slug) => versionCharts[slug] ?? []),
    [selectedSlugs, versionCharts]
  );

  const selectedNames = groups
    .filter((group) => selectedSlugs.has(group.slug))
    .map((group) => (group.name === "Unknown" ? versions.unknownLabel : group.name));
  const collectionName =
    selectedNames.length === 1 ? selectedNames[0] : browser.batchDefaultName;

  const showBar = selectMode && selectedCharts.length > 0;

  return (
    <div className={cn("flex flex-col gap-4", showBar && "pb-24")}>
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
              {browser.selectAll}
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {versions.selectedVersionsCount(selectedSlugs.size)}
            </span>
          </>
        ) : null}
      </div>

      <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((group) => {
          const label = group.name === "Unknown" ? versions.unknownLabel : group.name;
          const src = group.imageIndex !== null ? versionImageSrcByIndex(group.imageIndex) : null;
          const hasCharts = group.count > 0;
          const selectableHere = selectMode && Boolean(versionCharts[group.slug]?.length);
          const selected = selectedSlugs.has(group.slug);

          const card = (
            <Card
              size="sm"
              className={cn(
                "h-full overflow-hidden border border-border/70 bg-card/85 transition-all",
                !selectMode &&
                  hasCharts &&
                  "group-hover/version:border-primary/40 group-hover/version:shadow-lg group-hover/version:shadow-primary/10",
                !hasCharts && "opacity-45",
                selectableHere && selected && "border-primary ring-2 ring-primary"
              )}
            >
              <div className="relative flex aspect-[332/160] items-center justify-center bg-background/60 p-4">
                {src ? (
                  <Image
                    src={src}
                    alt={label}
                    width={VERSION_IMAGE_DIMENSIONS.width}
                    height={VERSION_IMAGE_DIMENSIONS.height}
                    unoptimized
                    className={cn(
                      "h-full w-auto object-contain",
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
                {selectableHere ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background/80 text-transparent"
                    )}
                  >
                    <CheckIcon className="size-4" />
                  </span>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 pb-1">
                <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                <Badge variant={hasCharts ? "secondary" : "outline"}>
                  {versions.chartCount(group.count)}
                </Badge>
              </div>
            </Card>
          );

          if (selectMode) {
            // 0-chart versions can't be selected; render them dimmed and inert.
            if (!selectableHere) {
              return (
                <RevealItem key={group.slug} className="h-full" aria-disabled="true">
                  {card}
                </RevealItem>
              );
            }
            return (
              <RevealItem key={group.slug} className="h-full">
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
              </RevealItem>
            );
          }

          if (!hasCharts) {
            return (
              <RevealItem key={group.slug} className="h-full" aria-disabled="true">
                {card}
              </RevealItem>
            );
          }

          return (
            <RevealItem key={group.slug} className="h-full">
              <Link
                href={buildLocalePath(`/versions/${group.slug}`, locale)}
                className="group/version block h-full rounded-xl transition-transform hover:-translate-y-0.5"
              >
                {card}
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>

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
