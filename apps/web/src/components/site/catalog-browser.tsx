"use client";

import * as React from "react";
import Image from "next/image";
import useSWR from "swr";
import { SearchIcon, XIcon } from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { ChartCard } from "@/components/site/chart-card";
import {
  ALL_CATEGORIES,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearchWithMatches,
  getCategoryOptions,
  getSubcategoryOptions,
} from "@/lib/catalog-search";
import type { CatalogCardEntry, ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  BPM_BUCKETS,
  bpmBucketId,
  cabinetBucket,
  collectDifficultyLevels,
  DIFFICULTY_TONE_CLASS,
  type DifficultyTone,
  entryHasLevel,
  GENRES,
  resolveGenreId,
  sortByReleaseDesc,
  versionShortName,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { jsonFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import {
  VERSION_IMAGE_DIMENSIONS,
  versionImageIndex,
  versionImageSrc,
} from "@/lib/version-image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { tabsListVariants, tabsTriggerClassName } from "@/components/ui/tabs";

type CatalogBrowserProps = {
  /** Card-level entries only — the heavy per-chart file payload stays off the page. */
  entries: CatalogCardEntry[];
  initialCategory?: string;
  locale?: "zh" | "en" | "ja";
  detailPathPrefix?: string;
  /** Base name for a multi-select batch download (e.g. the version label). */
  collectionName?: string;
};

const PAGE_SIZE = 24;
// Long enough to coalesce fast typing, short enough to feel instant.
const SEARCH_DEBOUNCE_MS = 200;
// Static (build-time) manifest of per-chart download specs, keyed by entry id.
// Fetched only when the user enters select mode — card entries deliberately do
// not carry the file URLs a batch download needs.
const CHART_SPECS_PATH = "/charts/specs.json";
// Matches the browse grid: 2 columns on phones, 3 from lg, 4 from xl.
const CARD_SIZES = "(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw";

export function CatalogBrowser({
  entries,
  initialCategory = "Remote",
  locale = "zh",
  collectionName,
}: CatalogBrowserProps) {
  const dictionary = getDictionary(locale).catalogBrowser;
  // The input is controlled by `inputValue`; `query` is the committed search
  // term, updated debounced and never mid-IME-composition, so pinyin/kana
  // buffers don't churn the result grid on every keystroke.
  const [inputValue, setInputValue] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(initialCategory);
  // Every dimension is a multi-select chip row: an empty set means "all", and
  // selections are OR within a dimension, AND across dimensions.
  const [versionSet, setVersionSet] = React.useState<ReadonlySet<string>>(new Set());
  const [levelSet, setLevelSet] = React.useState<ReadonlySet<string>>(new Set());
  const [genreIds, setGenreIds] = React.useState<ReadonlySet<string>>(new Set());
  const [cabinetSet, setCabinetSet] = React.useState<ReadonlySet<string>>(new Set());
  const [bpmSet, setBpmSet] = React.useState<ReadonlySet<string>>(new Set());
  const [assetSet, setAssetSet] = React.useState<ReadonlySet<string>>(new Set());
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  // URL params are read once after mount; writes are suppressed until then so
  // the landing params aren't clobbered by the initial default state.
  const [urlReady, setUrlReady] = React.useState(false);

  const isComposingRef = React.useRef(false);
  const debounceRef = React.useRef<number | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const listTopRef = React.useRef<HTMLDivElement | null>(null);

  // Apply state passed via the URL (home search, genre chips, shared links,
  // back-navigation from a detail page). Read once via window.location — this
  // keeps the static export free of a useSearchParams Suspense boundary. A
  // layout effect (not useEffect) so the filtered state commits before the
  // first client paint instead of flashing the unfiltered grid.
  React.useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const pageParam = Number(params.get("page") ?? "");
    // Each dimension param is a comma-separated list; the home page still
    // deep-links a single genre id, which parses as a one-item set.
    const readSet = (key: string): ReadonlySet<string> | null => {
      const raw = params.get(key);
      if (!raw) return null;
      const items = raw.split(",").filter(Boolean);
      return items.length > 0 ? new Set(items) : null;
    };
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q) {
      setInputValue(q);
      setQuery(q);
    }
    const genreSet = readSet("genre");
    if (genreSet) setGenreIds(new Set([...genreSet].filter((id) => GENRES[Number(id)])));
    const version = readSet("version");
    if (version) setVersionSet(version);
    const level = readSet("level");
    if (level) setLevelSet(level);
    const cabinet = readSet("cabinet");
    if (cabinet) setCabinetSet(cabinet);
    const bpm = readSet("bpm");
    if (bpm) setBpmSet(bpm);
    const asset = readSet("asset");
    if (asset) setAssetSet(asset);
    if (Number.isInteger(pageParam) && pageParam > 1) {
      setCurrentPage(pageParam);
    }
    setUrlReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    []
  );

  const commitQuery = React.useCallback((value: string) => {
    setQuery(value);
    setCurrentPage(1);
    if (!value.trim()) {
      setHasUserSelectedCategory(false);
    }
  }, []);

  const scheduleCommit = React.useCallback(
    (value: string) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        commitQuery(value);
      }, SEARCH_DEBOUNCE_MS);
    },
    [commitQuery]
  );

  const clearSearch = React.useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setInputValue("");
    commitQuery("");
    searchInputRef.current?.focus();
  }, [commitQuery]);

  const search = React.useMemo(() => buildCatalogSearchWithMatches(entries), [entries]);
  const hasQuery = query.trim().length > 0;
  const categories = React.useMemo(() => getCategoryOptions(entries), [entries]);
  const resolvedCategory = categories.includes(category) ? category : ALL_CATEGORIES;
  const effectiveCategory =
    hasQuery && !hasUserSelectedCategory ? ALL_CATEGORIES : resolvedCategory;
  const searchResults = React.useMemo(() => search(query), [search, query]);
  const baseEntries = React.useMemo(
    () => searchResults.map((result) => result.entry),
    [searchResults]
  );
  // Which alias matched each result, so a card can explain an alias-driven hit.
  const aliasHitById = React.useMemo(
    () => new Map(searchResults.map((result) => [result.entry.id, result.aliasHit])),
    [searchResults]
  );
  // Dimension chip option lists. Derived from the full catalog (not the current
  // search) so the chip rows stay stable while you type or narrow other filters.
  const versionOptions = React.useMemo(
    () =>
      getSubcategoryOptions(entries, effectiveCategory)
        .filter((value) => value !== ALL_SUBCATEGORIES)
        .sort((a, b) => (versionImageIndex(b) ?? -1) - (versionImageIndex(a) ?? -1)),
    [entries, effectiveCategory]
  );
  // Highest level first (15 → 1) so the hard charts most people filter for sit
  // at the front of the row.
  const levelOptions = React.useMemo(
    () => [...collectDifficultyLevels(entries)].reverse(),
    [entries]
  );
  const genreOptions = React.useMemo(() => {
    const ids = new Set<number>();
    for (const entry of entries) {
      const id = resolveGenreId(entry);
      if (id !== null) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [entries]);
  const cabinetOptions = React.useMemo(() => {
    const present = new Set<string>();
    for (const entry of entries) present.add(cabinetBucket(entry.cabinet));
    return (["DX", "ST", "UTG"] as const).filter((value) => present.has(value));
  }, [entries]);
  const bpmOptions = React.useMemo(() => {
    const present = new Set<string>();
    for (const entry of entries) {
      const id = bpmBucketId(entry.bpm);
      if (id) present.add(id);
    }
    return BPM_BUCKETS.filter((bucket) => present.has(bucket.id));
  }, [entries]);
  const assetOptions = React.useMemo(() => {
    const options: Array<{ id: "pv" | "dx"; label: string }> = [];
    if (entries.some((entry) => entry.assets?.has_pv)) {
      options.push({ id: "pv", label: dictionary.assetHasPv });
    }
    if (entries.some((entry) => entry.assets?.has_dx_chart)) {
      options.push({ id: "dx", label: dictionary.assetHasDx });
    }
    return options;
  }, [entries, dictionary.assetHasPv, dictionary.assetHasDx]);

  const visibleEntries = React.useMemo(() => {
    let filtered = applyCatalogFilters(baseEntries, effectiveCategory, ALL_SUBCATEGORIES);
    // OR within each dimension, AND across dimensions.
    if (versionSet.size > 0) {
      filtered = filtered.filter((entry) => versionSet.has(entry.subcategory));
    }
    if (levelSet.size > 0) {
      filtered = filtered.filter((entry) =>
        [...levelSet].some((level) => entryHasLevel(entry, level))
      );
    }
    if (genreIds.size > 0) {
      filtered = filtered.filter((entry) => genreIds.has(String(resolveGenreId(entry))));
    }
    if (cabinetSet.size > 0) {
      filtered = filtered.filter((entry) => cabinetSet.has(cabinetBucket(entry.cabinet)));
    }
    if (bpmSet.size > 0) {
      filtered = filtered.filter((entry) => {
        const id = bpmBucketId(entry.bpm);
        return id !== null && bpmSet.has(id);
      });
    }
    if (assetSet.size > 0) {
      // Asset toggles are requirements (AND): each selected asset must be present.
      filtered = filtered.filter(
        (entry) =>
          (!assetSet.has("pv") || Boolean(entry.assets?.has_pv)) &&
          (!assetSet.has("dx") || Boolean(entry.assets?.has_dx_chart))
      );
    }
    return filtered;
  }, [baseEntries, effectiveCategory, versionSet, levelSet, genreIds, cabinetSet, bpmSet, assetSet]);
  // Default browse order is newest-first by release (version era, then song id);
  // a text query keeps the search relevance ranking instead.
  const orderedEntries = React.useMemo(
    () => (hasQuery ? visibleEntries : sortByReleaseDesc(visibleEntries)),
    [hasQuery, visibleEntries]
  );
  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedEntries = React.useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return orderedEntries.slice(startIndex, startIndex + PAGE_SIZE);
  }, [safeCurrentPage, orderedEntries]);
  const pageStart =
    visibleEntries.length === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safeCurrentPage * PAGE_SIZE, visibleEntries.length);

  const hasActiveFilters =
    hasQuery ||
    versionSet.size > 0 ||
    levelSet.size > 0 ||
    genreIds.size > 0 ||
    cabinetSet.size > 0 ||
    bpmSet.size > 0 ||
    assetSet.size > 0 ||
    (hasUserSelectedCategory && effectiveCategory !== ALL_CATEGORIES);

  // Toggle a value in a dimension set and reset to page 1. `clearSet` empties a
  // whole dimension (its "all" chip).
  type SetState = React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  const toggleIn = (setter: SetState) => (id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCurrentPage(1);
  };
  const clearSet = (setter: SetState) => () => {
    setter(new Set());
    setCurrentPage(1);
  };
  const toggleVersion = toggleIn(setVersionSet);
  const toggleLevel = toggleIn(setLevelSet);
  const toggleGenre = toggleIn(setGenreIds);
  const toggleCabinet = toggleIn(setCabinetSet);
  const toggleBpm = toggleIn(setBpmSet);
  const toggleAsset = toggleIn(setAssetSet);

  const clearAllFilters = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setInputValue("");
    setQuery("");
    setVersionSet(new Set());
    setLevelSet(new Set());
    setGenreIds(new Set());
    setCabinetSet(new Set());
    setBpmSet(new Set());
    setAssetSet(new Set());
    setCategory(initialCategory);
    setHasUserSelectedCategory(false);
    setCurrentPage(1);
  };

  // Mirror the browse state into the URL (replaceState — no history spam) so
  // reload, share links, and back-navigation from a detail page all restore
  // the user's place. The home page already deep-links here with ?q=/?genre=.
  React.useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams(window.location.search);
    const apply = (key: string, value: string | null) => {
      if (value !== null) params.set(key, value);
      else params.delete(key);
    };
    const joinSet = (set: ReadonlySet<string>) => (set.size > 0 ? [...set].join(",") : null);
    apply("q", hasQuery ? query : null);
    apply("version", joinSet(versionSet));
    apply("level", joinSet(levelSet));
    apply("genre", joinSet(genreIds));
    apply("cabinet", joinSet(cabinetSet));
    apply("bpm", joinSet(bpmSet));
    apply("asset", joinSet(assetSet));
    apply("page", safeCurrentPage > 1 ? String(safeCurrentPage) : null);
    const queryString = params.toString();
    const next = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [
    urlReady,
    hasQuery,
    query,
    versionSet,
    levelSet,
    genreIds,
    cabinetSet,
    bpmSet,
    assetSet,
    safeCurrentPage,
  ]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    // After the new page renders, bring the list top back into view — otherwise
    // the viewport is left stranded at the pagination card below the grid.
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      listTopRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  // Card entries don't carry the per-chart file specs a batch download needs;
  // fetch the static manifest lazily the first time select mode is entered.
  // SWR caches it, so re-entering select mode is free.
  const { data: chartSpecs, error: chartSpecsError } = useSWR<
    Record<string, ChartDownloadSpec>
  >(selectMode ? CHART_SPECS_PATH : null, jsonFetcher);
  const specsPending = selectMode && !chartSpecs && !chartSpecsError;

  // Selection persists by id across pagination and filters, so a batch can span pages.
  const selectedCharts = React.useMemo(() => {
    if (!chartSpecs) return [];
    return entries
      .filter((entry) => selectedIds.has(entry.id))
      .map((entry) => chartSpecs[entry.id])
      .filter((spec): spec is ChartDownloadSpec => Boolean(spec));
  }, [chartSpecs, entries, selectedIds]);

  const toggleSelection = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const selectAllFiltered = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const entry of orderedEntries) {
        next.add(entry.id);
      }
      return next;
    });

  const clearSelection = () => setSelectedIds(new Set());

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const showBatchBar = selectMode && selectedCharts.length > 0;

  return (
    <div className={cn("flex flex-col gap-6", showBatchBar && "pb-24")}>
      {categories.length > 2 ? (
        // Tab-styled filter buttons; not ARIA tabs because there are no panels —
        // they narrow the one grid below.
        <div className="group/tabs flex gap-2 data-horizontal:flex-col" data-orientation="horizontal">
          <div
            role="group"
            aria-label={dictionary.allCategories}
            data-variant="line"
            className={cn(tabsListVariants({ variant: "line" }), "h-8 w-full justify-start overflow-x-auto")}
          >
            {categories.map((value) => {
              const active = value === effectiveCategory;
              return (
                <button
                  key={value}
                  type="button"
                  data-active={active ? "" : undefined}
                  aria-pressed={active}
                  className={tabsTriggerClassName}
                  onClick={() => {
                    setCategory(value);
                    setVersionSet(new Set());
                    setHasUserSelectedCategory(true);
                    setCurrentPage(1);
                  }}
                >
                  {value === ALL_CATEGORIES ? dictionary.allCategories : value}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          className={cn("pl-9", inputValue && "pr-9")}
          placeholder={dictionary.searchPlaceholder}
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            // Mid-composition updates are IME buffer states (e.g. "dongfang"
            // on the way to 东方) — commit only once composition ends.
            if (isComposingRef.current) return;
            scheduleCommit(nextValue);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false;
            scheduleCommit(event.currentTarget.value);
          }}
        />
        {inputValue ? (
          <button
            type="button"
            aria-label={dictionary.clearSearch}
            onClick={clearSearch}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>

      {/* One chip row per dimension — pick directly, combine across rows. Each
          row's "all" chip clears just that dimension. */}
      <div className="flex flex-col gap-2.5">
        {versionOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterVersion}>
            <AllChip active={versionSet.size === 0} onClick={clearSet(setVersionSet)}>
              {dictionary.filterAll}
            </AllChip>
            {versionOptions.map((value) => {
              const iconSrc = versionImageSrc(value);
              // Icon-only: the version logo is the identity; name lives in the
              // aria-label / title for a11y and hover.
              return (
                <ToggleChip
                  key={value}
                  active={versionSet.has(value)}
                  onClick={() => toggleVersion(value)}
                  className="px-2 py-1"
                  ariaLabel={value}
                  title={value}
                >
                  {iconSrc ? (
                    <Image
                      src={iconSrc}
                      alt=""
                      width={VERSION_IMAGE_DIMENSIONS.width}
                      height={VERSION_IMAGE_DIMENSIONS.height}
                      unoptimized
                      className="h-9 w-auto"
                    />
                  ) : (
                    versionShortName(value)
                  )}
                </ToggleChip>
              );
            })}
          </ChipFilterRow>
        ) : null}

        {levelOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterLevel}>
            <AllChip active={levelSet.size === 0} onClick={clearSet(setLevelSet)}>
              {dictionary.filterAll}
            </AllChip>
            {levelOptions.map((value) => (
              <ToggleChip
                key={value}
                active={levelSet.has(value)}
                onClick={() => toggleLevel(value)}
                tone={levelTone(value)}
              >
                {value}
              </ToggleChip>
            ))}
          </ChipFilterRow>
        ) : null}

        {genreOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterGenre}>
            <AllChip active={genreIds.size === 0} onClick={clearSet(setGenreIds)}>
              {dictionary.filterAll}
            </AllChip>
            {genreOptions.map((id) => (
              <ToggleChip
                key={id}
                active={genreIds.has(String(id))}
                onClick={() => toggleGenre(String(id))}
                tone={GENRES[id].badge}
              >
                {GENRES[id][locale]}
              </ToggleChip>
            ))}
          </ChipFilterRow>
        ) : null}

        {cabinetOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterCabinet}>
            <AllChip active={cabinetSet.size === 0} onClick={clearSet(setCabinetSet)}>
              {dictionary.filterAll}
            </AllChip>
            {cabinetOptions.map((value) => {
              const label =
                value === "DX"
                  ? "DX"
                  : value === "ST"
                    ? dictionary.cabinetStandard
                    : dictionary.cabinetUtage;
              return (
                <ToggleChip
                  key={value}
                  active={cabinetSet.has(value)}
                  onClick={() => toggleCabinet(value)}
                  className="px-2"
                  ariaLabel={label}
                  title={label}
                >
                  <CabinetBadge cabinet={value} className="h-4" />
                </ToggleChip>
              );
            })}
          </ChipFilterRow>
        ) : null}

        {bpmOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterBpm}>
            <AllChip active={bpmSet.size === 0} onClick={clearSet(setBpmSet)}>
              {dictionary.filterAll}
            </AllChip>
            {bpmOptions.map((bucket) => (
              <ToggleChip
                key={bucket.id}
                active={bpmSet.has(bucket.id)}
                onClick={() => toggleBpm(bucket.id)}
                tone={BPM_TONE[bucket.id]}
              >
                {bucket.label}
              </ToggleChip>
            ))}
          </ChipFilterRow>
        ) : null}

        {assetOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterAssets}>
            {assetOptions.map((option) => (
              <ToggleChip
                key={option.id}
                active={assetSet.has(option.id)}
                onClick={() => toggleAsset(option.id)}
              >
                {option.label}
              </ToggleChip>
            ))}
          </ChipFilterRow>
        ) : null}
      </div>

      {hasActiveFilters ? (
        // A single place to see every applied condition and drop any one of
        // them — the fast path for narrowing by several criteria at once.
        <div
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          role="group"
          aria-label={dictionary.activeFiltersLabel}
        >
          {hasQuery ? (
            <FilterChip
              onRemove={clearSearch}
              removeLabel={dictionary.removeFilter(query)}
              icon={<SearchIcon className="size-3 shrink-0 text-muted-foreground" />}
            >
              {query}
            </FilterChip>
          ) : null}
          {[...versionSet].map((value) => (
            <FilterChip
              key={`v-${value}`}
              onRemove={() => toggleVersion(value)}
              removeLabel={dictionary.removeFilter(value)}
              icon={
                versionImageSrc(value) ? (
                  <Image
                    src={versionImageSrc(value)!}
                    alt=""
                    width={VERSION_IMAGE_DIMENSIONS.width}
                    height={VERSION_IMAGE_DIMENSIONS.height}
                    unoptimized
                    className="h-4 w-auto shrink-0"
                  />
                ) : undefined
              }
            >
              {versionShortName(value)}
            </FilterChip>
          ))}
          {[...levelSet].map((value) => (
            <FilterChip
              key={`l-${value}`}
              onRemove={() => toggleLevel(value)}
              removeLabel={dictionary.removeFilter(dictionary.levelOption(value))}
            >
              {dictionary.levelOption(value)}
            </FilterChip>
          ))}
          {[...genreIds].map((id) => {
            const info = GENRES[Number(id)];
            if (!info) return null;
            return (
              <FilterChip
                key={`g-${id}`}
                onRemove={() => toggleGenre(id)}
                removeLabel={dictionary.removeFilter(info[locale])}
                className={info.badge}
              >
                {info[locale]}
              </FilterChip>
            );
          })}
          {[...cabinetSet].map((value) => {
            const label =
              value === "DX"
                ? "DX"
                : value === "ST"
                  ? dictionary.cabinetStandard
                  : dictionary.cabinetUtage;
            return (
              <FilterChip
                key={`c-${value}`}
                onRemove={() => toggleCabinet(value)}
                removeLabel={dictionary.removeFilter(label)}
              >
                {label}
              </FilterChip>
            );
          })}
          {[...bpmSet].map((value) => {
            const label = BPM_BUCKETS.find((b) => b.id === value)?.label ?? value;
            return (
              <FilterChip
                key={`b-${value}`}
                onRemove={() => toggleBpm(value)}
                removeLabel={dictionary.removeFilter(label)}
              >
                {label}
              </FilterChip>
            );
          })}
          {[...assetSet].map((value) => {
            const label = value === "pv" ? dictionary.assetHasPv : dictionary.assetHasDx;
            return (
              <FilterChip
                key={`a-${value}`}
                onRemove={() => toggleAsset(value)}
                removeLabel={dictionary.removeFilter(label)}
              >
                {label}
              </FilterChip>
            );
          })}
          {hasUserSelectedCategory && effectiveCategory !== ALL_CATEGORIES ? (
            <FilterChip
              onRemove={() => {
                setCategory(initialCategory);
                setHasUserSelectedCategory(false);
                setCurrentPage(1);
              }}
              removeLabel={dictionary.removeFilter(effectiveCategory)}
            >
              {effectiveCategory}
            </FilterChip>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters}>
            {dictionary.clearFilters}
          </Button>
        </div>
      ) : null}

      <div
        ref={listTopRef}
        className="flex scroll-mt-24 flex-wrap items-center justify-between gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={selectMode ? "default" : "outline"}
            size="sm"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          >
            {selectMode ? dictionary.exitSelectMode : dictionary.selectMode}
          </Button>
          {selectMode ? (
            <Button type="button" variant="outline" size="sm" onClick={selectAllFiltered}>
              {dictionary.selectAll}
            </Button>
          ) : null}
          {/* The batch manifest loads lazily on entering select mode. */}
          {specsPending ? (
            <span role="status" className="text-sm text-muted-foreground">
              {dictionary.specsLoading}
            </span>
          ) : null}
          {selectMode && chartSpecsError ? (
            <span role="status" className="text-sm text-destructive">
              {dictionary.specsError}
            </span>
          ) : null}
        </div>
        {/* Live so filter/search changes are announced to screen readers. */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {dictionary.resultsSummary(visibleEntries.length)}
          {totalPages > 1 ? ` · ${dictionary.pageLabel(safeCurrentPage, totalPages)}` : null}
        </p>
      </div>

      {visibleEntries.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          <Card size="sm">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center text-sm text-muted-foreground">
              <p>{dictionary.emptyState}</p>
              {hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearAllFilters}>
                  {dictionary.clearFilters}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          layout
          data-layout="card-grid"
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {paginatedEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className="h-full"
              >
                <ChartCard
                  entry={entry}
                  locale={locale}
                  priority={safeCurrentPage === 1 && index < 4}
                  sizes={CARD_SIZES}
                  aliasHit={hasQuery ? aliasHitById.get(entry.id) ?? null : null}
                  selectable={selectMode}
                  selected={selectedIds.has(entry.id)}
                  onToggleSelect={() => toggleSelection(entry.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {totalPages > 1 ? (
            <Card size="sm" className="col-span-full border border-border/70 bg-card/70">
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <p>{dictionary.rangeLabel(pageStart, pageEnd, visibleEntries.length)}</p>
                  <p>{dictionary.pageLabel(safeCurrentPage, totalPages)}</p>
                </div>
                <nav
                  aria-label={dictionary.pageLabel(safeCurrentPage, totalPages)}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage === 1}
                    onClick={() => goToPage(Math.max(1, safeCurrentPage - 1))}
                  >
                    {dictionary.previousPage}
                  </Button>
                  {buildPageWindow(safeCurrentPage, totalPages).map((item, index) =>
                    item === "gap" ? (
                      <span
                        key={`gap-${index}`}
                        aria-hidden="true"
                        className="px-1 text-sm text-muted-foreground"
                      >
                        …
                      </span>
                    ) : (
                      <Button
                        key={item}
                        type="button"
                        variant={item === safeCurrentPage ? "default" : "outline"}
                        size="sm"
                        className="min-w-9 px-2"
                        aria-label={dictionary.goToPage(item)}
                        aria-current={item === safeCurrentPage ? "page" : undefined}
                        onClick={() => goToPage(item)}
                      >
                        {item}
                      </Button>
                    )
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage === totalPages}
                    onClick={() => goToPage(Math.min(totalPages, safeCurrentPage + 1))}
                  >
                    {dictionary.nextPage}
                  </Button>
                </nav>
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      )}

      <AnimatePresence>
        {showBatchBar ? (
          <BatchDownloadBar
            charts={selectedCharts}
            collectionName={collectionName ?? dictionary.batchDefaultName}
            locale={locale}
            onClear={clearSelection}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// A labeled row of filter chips (one dimension). Chips never wrap — the group
// scrolls horizontally (swipe on touch, trackpad/shift-wheel on desktop) so a
// long dimension like version stays a single compact line. Scrollbar hidden.
function ChipFilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-x-2">
      <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {/* overflow-x also clips overflow-y, so pad vertically (and a touch right)
          to give the selected chip's ring room instead of shearing its edge. */}
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1.5 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

// The "all" chip that clears a whole dimension (active when nothing is picked).
function AllChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.93 }}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-8 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-muted/60"
      )}
    >
      {children}
    </motion.button>
  );
}

// A single multi-select filter chip. `tone` (a border/bg/text class set) makes
// it always-colored — active then adds a ring and inactive dims — for genre,
// level and BPM. Without a tone it uses the neutral → primary style.
function ToggleChip({
  active,
  onClick,
  children,
  tone,
  className,
  ariaLabel,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.93 }}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={cn(
        "flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        tone
          ? cn(tone, active ? "ring-2 ring-current" : "opacity-70 hover:opacity-100")
          : active
            ? "border-primary bg-primary/15 text-primary"
            : "border-border text-muted-foreground hover:bg-muted/60",
        className
      )}
    >
      {children}
    </motion.button>
  );
}

// Tint a level chip with maimai's real difficulty palette (the same tones the
// difficulty pills use): the level a chart sits at tracks its difficulty slot,
// so low levels read Basic-green and top levels Master/Re:Master-violet.
function levelTone(level: string): string {
  const n = Number.parseInt(level, 10);
  const tone: DifficultyTone =
    n <= 5 ? "basic" : n <= 8 ? "advanced" : n <= 11 ? "expert" : n <= 13 ? "master" : "remaster";
  return DIFFICULTY_TONE_CLASS[tone];
}

// BPM buckets, slow (cool) → fast (warm), keyed by bucket id.
const BPM_TONE: Record<string, string> = {
  "0": "border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300",
  "1": "border-teal-500/40 bg-teal-500/12 text-teal-700 dark:text-teal-300",
  "2": "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "3": "border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

// One applied filter shown in the active-filters bar: a label + a remove (×).
// `className` tints it to match a genre chip; `icon` prefixes it (search glyph
// or version logo).
function FilterChip({
  children,
  onRemove,
  removeLabel,
  icon,
  className,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border py-1 pr-1 pl-2.5 text-xs font-medium",
        className ?? "border-border bg-muted/50"
      )}
    >
      {icon}
      <span className="max-w-[12rem] truncate">{children}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="rounded-full p-0.5 text-current/70 transition-colors hover:bg-background/60 hover:text-current"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

// Compact page window: first/last always visible, one neighbor around the
// current page, gaps collapsed to an ellipsis (e.g. 1 … 4 [5] 6 … 66).
function buildPageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const sorted = [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous === 2) {
      result.push(previous + 1);
    } else if (previous && page - previous > 2) {
      result.push("gap");
    }
    result.push(page);
    previous = page;
  }
  return result;
}
