"use client";

import * as React from "react";
import Image from "next/image";
import useSWR from "swr";
import { SearchIcon, XIcon } from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { ChartCard } from "@/components/site/chart-card";
import {
  ALL_CATEGORIES,
  ALL_LEVELS,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearchWithMatches,
  getCategoryOptions,
  getSubcategoryOptions,
} from "@/lib/catalog-search";
import type { CatalogCardEntry, ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  collectDifficultyLevels,
  entryHasLevel,
  GENRES,
  resolveGenreId,
  sortByReleaseDesc,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [subcategory, setSubcategory] = React.useState(ALL_SUBCATEGORIES);
  const [genre, setGenre] = React.useState("all");
  const [level, setLevel] = React.useState(ALL_LEVELS);
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
    const genreParam = params.get("genre");
    const versionParam = params.get("version");
    const levelParam = params.get("level");
    const pageParam = Number(params.get("page") ?? "");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (q) {
      setInputValue(q);
      setQuery(q);
    }
    if (genreParam && GENRES[Number(genreParam)]) {
      setGenre(genreParam);
    }
    if (versionParam) {
      // Invalid values resolve back to "all versions" via resolvedSubcategory.
      setSubcategory(versionParam);
    }
    if (levelParam) {
      // Invalid values resolve back to "all levels" via resolvedLevel.
      setLevel(levelParam);
    }
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
  const subcategories = React.useMemo(() => {
    const options = getSubcategoryOptions(baseEntries, effectiveCategory);
    // Order versions newest-first (matches the release-order sort everywhere else).
    const versions = options
      .filter((value) => value !== ALL_SUBCATEGORIES)
      .sort((a, b) => (versionImageIndex(b) ?? -1) - (versionImageIndex(a) ?? -1));
    return [ALL_SUBCATEGORIES, ...versions];
  }, [baseEntries, effectiveCategory]);
  // The selected version stays in state even when the current search narrows
  // the option set past it — it resolves back automatically once it matches
  // again, so typing a query never wipes the user's version choice.
  const resolvedSubcategory = subcategories.includes(subcategory)
    ? subcategory
    : ALL_SUBCATEGORIES;
  const genreOptions = React.useMemo(() => {
    const ids = new Set<number>();
    for (const entry of entries) {
      const id = resolveGenreId(entry);
      if (id !== null) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [entries]);
  // Level filter options come from the data itself (distinct levels, play order).
  const levelOptions = React.useMemo(() => collectDifficultyLevels(entries), [entries]);
  // Like the version select: an unknown level (stale URL, narrowed data set)
  // resolves to "all" without wiping the user's stored choice.
  const resolvedLevel = levelOptions.includes(level) ? level : ALL_LEVELS;
  const visibleEntries = React.useMemo(() => {
    let filtered = applyCatalogFilters(baseEntries, effectiveCategory, resolvedSubcategory);
    if (genre !== "all") {
      filtered = filtered.filter((entry) => String(resolveGenreId(entry)) === genre);
    }
    if (resolvedLevel !== ALL_LEVELS) {
      // An entry matches when ANY of its difficulties carries the level.
      filtered = filtered.filter((entry) => entryHasLevel(entry, resolvedLevel));
    }
    return filtered;
  }, [baseEntries, effectiveCategory, resolvedSubcategory, genre, resolvedLevel]);
  // Default browse order is newest-first by release (version era, then song id);
  // a text query keeps the search relevance ranking instead.
  const orderedEntries = React.useMemo(
    () => (hasQuery ? visibleEntries : sortByReleaseDesc(visibleEntries)),
    [hasQuery, visibleEntries]
  );
  const selectedSubcategoryLabel =
    resolvedSubcategory === ALL_SUBCATEGORIES
      ? dictionary.allSubcategories
      : resolvedSubcategory;
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
    genre !== "all" ||
    resolvedSubcategory !== ALL_SUBCATEGORIES ||
    resolvedLevel !== ALL_LEVELS ||
    (hasUserSelectedCategory && effectiveCategory !== ALL_CATEGORIES);

  const clearAllFilters = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setInputValue("");
    setQuery("");
    setGenre("all");
    setSubcategory(ALL_SUBCATEGORIES);
    setLevel(ALL_LEVELS);
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
    apply("q", hasQuery ? query : null);
    apply("genre", genre !== "all" ? genre : null);
    apply("version", resolvedSubcategory !== ALL_SUBCATEGORIES ? resolvedSubcategory : null);
    apply("level", resolvedLevel !== ALL_LEVELS ? resolvedLevel : null);
    apply("page", safeCurrentPage > 1 ? String(safeCurrentPage) : null);
    const queryString = params.toString();
    const next = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [urlReady, hasQuery, query, genre, resolvedSubcategory, resolvedLevel, safeCurrentPage]);

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
                    setSubcategory(ALL_SUBCATEGORIES);
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

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_150px]">
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

        <Select
          value={resolvedSubcategory}
          onValueChange={(value) => {
            setSubcategory(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={dictionary.allSubcategories}>
              <span className="flex items-center gap-2 truncate">
                {resolvedSubcategory !== ALL_SUBCATEGORIES && versionImageSrc(resolvedSubcategory) ? (
                  <Image
                    src={versionImageSrc(resolvedSubcategory)!}
                    alt=""
                    width={VERSION_IMAGE_DIMENSIONS.width}
                    height={VERSION_IMAGE_DIMENSIONS.height}
                    unoptimized
                    className="h-5 w-auto shrink-0"
                  />
                ) : null}
                <span className="truncate">{selectedSubcategoryLabel}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {subcategories.map((value) => {
                const iconSrc = value === ALL_SUBCATEGORIES ? null : versionImageSrc(value);
                return (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      {iconSrc ? (
                        <Image
                          src={iconSrc}
                          alt=""
                          width={VERSION_IMAGE_DIMENSIONS.width}
                          height={VERSION_IMAGE_DIMENSIONS.height}
                          unoptimized
                          className="h-5 w-auto shrink-0"
                        />
                      ) : null}
                      {value === ALL_SUBCATEGORIES ? dictionary.allSubcategories : value}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* Level filter: options derived from the data; matches an entry when
            ANY of its difficulties carries the selected level. */}
        <Select
          value={resolvedLevel}
          onValueChange={(value) => {
            setLevel(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-full" aria-label={dictionary.levelFilterLabel}>
            {/* Explicit children (not item-text lookup) so the label is present
                in the prerendered HTML, like the version select above. */}
            <SelectValue placeholder={dictionary.allLevels}>
              <span className="truncate">
                {resolvedLevel === ALL_LEVELS
                  ? dictionary.allLevels
                  : dictionary.levelOption(resolvedLevel)}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL_LEVELS}>{dictionary.allLevels}</SelectItem>
              {levelOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {dictionary.levelOption(value)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {genreOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.93 }}
            aria-pressed={genre === "all"}
            onClick={() => {
              setGenre("all");
              setCurrentPage(1);
            }}
            className={cn(
              "min-h-8 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              genre === "all"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/60"
            )}
          >
            {dictionary.allGenres}
          </motion.button>
          {genreOptions.map((id) => {
            const active = genre === String(id);
            return (
              <motion.button
                key={id}
                type="button"
                whileTap={{ scale: 0.93 }}
                aria-pressed={active}
                onClick={() => {
                  setGenre(active ? "all" : String(id));
                  setCurrentPage(1);
                }}
                className={cn(
                  "min-h-8 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  GENRES[id].badge,
                  active ? "ring-2 ring-current" : "opacity-70 hover:opacity-100"
                )}
              >
                {GENRES[id][locale]}
              </motion.button>
            );
          })}
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
