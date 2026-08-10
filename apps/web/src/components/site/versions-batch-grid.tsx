"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";

import { AnimatePresence, motion, springSoft } from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { VersionTileCard } from "@/components/site/version-tile-card";
import { Button } from "@/components/ui/button";
import {
  versionFolderName,
  type ChartDownloadSpec,
  type VersionGroup,
} from "@/lib/catalog-shared";
import { buildVersionFilterHref } from "@/lib/catalog-links";
import { getDictionary, type Locale } from "@/lib/i18n";
import { jsonFetcher } from "@/lib/swr-fetcher";
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {groups.map((group) => {
          const hasCharts = group.count > 0;
          const selectableHere = selectMode && hasCharts;
          const selected = selectedSlugs.has(group.slug);

          const card = (
            <VersionTileCard
              name={group.name}
              imageIndex={group.imageIndex}
              count={group.count}
              locale={locale}
              selectMode={selectMode}
              selected={selected}
            />
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
                  // ARIA checkbox is Name-From-Author, so the tile's own logo
                  // and label contribute nothing: without this every version
                  // announced as an anonymous "checkbox, not checked".
                  aria-label={
                    group.name === "Unknown" ? versions.unknownLabel : group.name
                  }
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={() => toggle(group.slug)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(group.slug);
                    }
                  }}
                  className="group/version block h-full cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                href={buildVersionFilterHref(group.imageIndex, locale)}
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
