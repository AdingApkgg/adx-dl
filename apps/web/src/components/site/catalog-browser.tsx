"use client";

import * as React from "react";
import useSWR from "swr";
import { ChevronDownIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react";
import type { Variants } from "framer-motion";

import {
  AnimatePresence,
  EASE_OUT,
  motion,
  RollingNumber,
  springSoft,
  useReducedMotion,
} from "@/components/motion";
import { BatchDownloadBar } from "@/components/site/batch-download-bar";
import { CabinetBadge } from "@/components/site/cabinet-badge";
import { ChartCard } from "@/components/site/chart-card";
import { CompatibleImage } from "@/components/site/compatible-image";
import { RandomChartButton } from "@/components/site/random-chart-button";
import {
  ALL_CATEGORIES,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearchWithMatches,
  getCategoryOptions,
} from "@/lib/catalog-search";
import type { CatalogCardEntry, ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  BPM_GRADIENT,
  buildLevelGradient,
  cabinetBucket,
  type CabinetBucket,
  clampRange,
  collectDifficultyLevels,
  entryHasLevelInRange,
  type FilterRange,
  formatRangeParam,
  GENRES,
  isFullRange,
  isKnownVersionIndex,
  normalizeCabinetId,
  parseBpmParam,
  parseLevelParam,
  resolveGenreId,
  resolveVersionIndex,
  sortByReleaseDesc,
  UTAGE_CABINET,
  UTAGE_GENRE_ID,
  versionRouteId,
  versionShortName,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { jsonFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";
import {
  MAIMAI_VERSIONS,
  VERSION_IMAGE_DIMENSIONS,
  versionImageSourcesByIndex,
} from "@/lib/version-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RangeSlider } from "@/components/ui/range-slider";
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
// Matches the browse grid: 2 columns on phones, 3 from md, 4 from lg, 6 from
// xl (content is capped at max-w-7xl, so xl cards are ~200px wide).
const CARD_SIZES =
  "(max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 200px";
// Sticky offset for the results toolbar — clears the sticky site header
// (~65px tall) with a little breathing room. Must match `top-[4.5rem]` below.
const STICKY_TOOLBAR_TOP_PX = 72;
const VERSION_NAME_BY_INDEX = new Map(
  MAIMAI_VERSIONS.map((version) => [version.index, version.name] as const)
);

type VersionIdentityEntry = Pick<CatalogCardEntry, "versionid" | "version">;

export function catalogVersionFilterId(entry: VersionIdentityEntry): string {
  return versionRouteId(resolveVersionIndex(entry));
}

/** Normalize old name-based shared URLs while keeping new URLs id-only. */
export function normalizeVersionFilterId(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === "unknown") return versionRouteId(null);
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized);
    return isKnownVersionIndex(index) ? versionRouteId(index) : null;
  }
  const index = resolveVersionIndex({ version: normalized });
  return index === null ? null : versionRouteId(index);
}

/**
 * Resolve the genre + cabinet query params onto the chips that actually exist.
 *
 * Two rewrites happen here, both so a link from outside lands on a panel whose
 * chips match the grid:
 *  - `genre=107` becomes `cabinet=UTAGE`. They select the identical 128 charts,
 *    but only the Type row has a chip for it, so a raw genre=107 link filtered
 *    the grid while leaving every chip in both rows unlit.
 *  - `cabinet=UTG` becomes `cabinet=UTAGE` — the bucket's former id, still live
 *    in shared and indexed links.
 * Values naming no chip at all (unknown genre id, unknown cabinet) are dropped
 * rather than applied invisibly.
 *
 * Returns null for a dimension the URL didn't mention, so the caller can leave
 * that piece of state at its default.
 */
export function foldUtageGenreIntoCabinet(
  genreParam: ReadonlySet<string> | null,
  cabinetParam: ReadonlySet<string> | null
): { genreIds: ReadonlySet<string> | null; cabinetIds: ReadonlySet<string> | null } {
  const utageId = String(UTAGE_GENRE_ID);
  const known = genreParam ? [...genreParam].filter((id) => GENRES[Number(id)]) : [];
  const hasUtage = known.includes(utageId);
  const cabinets = new Set(
    [...(cabinetParam ?? [])]
      .map(normalizeCabinetId)
      .filter((id): id is CabinetBucket => id !== null)
  );
  if (hasUtage) {
    cabinets.add(UTAGE_CABINET);
  }
  return {
    genreIds: genreParam ? new Set(known.filter((id) => id !== utageId)) : null,
    cabinetIds: cabinetParam || hasUtage ? cabinets : null,
  };
}

/**
 * Whether a Type-row chip is locked out by what is already picked there.
 *
 * The other rows get their greying from plain faceted counts, but the Type row
 * needs this extra rule: its values are OR-ed like any dimension, so nothing in
 * the data stops you asking for "宴会場 or DX" — the counts stay non-zero and no
 * chip would grey out. That query is not one anyone means, though. UTAGE charts
 * are a different thing from normal ones: their own chart type, their own level
 * notation ("13?"), their own genre, and a whole separate way of being played.
 * So 宴会場 is exclusive with the other two.
 *
 * DX and ST stay combinable with each other — those are both normal charts, and
 * "DX or ST" is a real thing to ask for (it is "everything but 宴会場").
 */
export function isCabinetLockedOut(
  value: string,
  selected: ReadonlySet<string>
): boolean {
  if (selected.size === 0) {
    return false;
  }
  return selected.has(UTAGE_CABINET) ? value !== UTAGE_CABINET : value === UTAGE_CABINET;
}

// Advanced-filter panel: opening staggers the rows in one by one; collapse
// runs fast and un-staggered so closing feels immediate.
const filterPanelVariants: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: { duration: 0.2, ease: EASE_OUT },
  },
  open: {
    height: "auto",
    opacity: 1,
    transition: { duration: 0.25, ease: EASE_OUT, staggerChildren: 0.04 },
  },
};

const filterRowVariants: Variants = {
  collapsed: { opacity: 0, x: -8, transition: { duration: 0.15, ease: EASE_OUT } },
  open: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE_OUT } },
};

export function buildSelectedCatalogCharts(
  entries: readonly CatalogCardEntry[],
  specs: Record<string, ChartDownloadSpec> | undefined,
  selectedIds: ReadonlySet<string>
): ChartDownloadSpec[] {
  if (!specs) {
    return [];
  }

  return entries
    .filter((entry) => selectedIds.has(entry.id))
    .map((entry) => specs[entry.id])
    .filter((spec): spec is ChartDownloadSpec => Boolean(spec));
}

export function CatalogBrowser({
  entries,
  initialCategory = "Remote",
  locale = "zh",
  collectionName,
}: CatalogBrowserProps) {
  const siteDictionary = getDictionary(locale);
  const dictionary = siteDictionary.catalogBrowser;
  const unknownVersionLabel = siteDictionary.versions.unknownLabel;
  const reduceMotion = useReducedMotion();
  // The input is controlled by `inputValue`; `query` is the committed search
  // term, updated debounced and never mid-IME-composition, so pinyin/kana
  // buffers don't churn the result grid on every keystroke.
  const [inputValue, setInputValue] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(initialCategory);
  // Categorical dimensions are multi-select chip rows: an empty set means "all",
  // and selections are OR within a dimension, AND across dimensions.
  const [versionSet, setVersionSet] = React.useState<ReadonlySet<string>>(new Set());
  const [genreIds, setGenreIds] = React.useState<ReadonlySet<string>>(new Set());
  const [cabinetSet, setCabinetSet] = React.useState<ReadonlySet<string>>(new Set());
  const [assetSet, setAssetSet] = React.useState<ReadonlySet<string>>(new Set());
  // Level and BPM are ordered scales, so they are two-thumb ranges instead: null
  // means the whole scale (nothing filtered out), which keeps "no filter" a
  // distinct state from "the range happens to span everything".
  const [levelRange, setLevelRange] = React.useState<FilterRange | null>(null);
  const [bpmRange, setBpmRange] = React.useState<FilterRange | null>(null);
  // The filter picker rows are tucked into a collapsible "advanced filters"
  // panel, closed by default (opened automatically when a deep link arrives
  // with filters already applied).
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  // URL params are read once after mount; writes are suppressed until then so
  // the landing params aren't clobbered by the initial default state.
  const [urlReady, setUrlReady] = React.useState(false);
  // Whether the results toolbar is pinned under the site header (drives the
  // backdrop crossfade — sticky itself is pure CSS).
  const [toolbarStuck, setToolbarStuck] = React.useState(false);

  // The two range scales. Declared up here because the URL reader below resolves
  // its `level`/`bpm` params against them; both derive from the full catalog, so
  // the scales stay put while the filters narrow the results.
  //
  // Ascending (1 → 15). Both sliders *display* hardest/fastest on the left, but
  // that is purely a direction flip inside RangeSlider (`reversed`), so every
  // value here stays in natural order and range[0] is always the low end.
  const levelScale = React.useMemo(() => collectDifficultyLevels(entries), [entries]);
  const levelBounds = React.useMemo<FilterRange>(
    () => [0, Math.max(0, levelScale.length - 1)],
    [levelScale]
  );
  // BPM spans what the catalog actually holds, rounded outwards to a whole 10 so
  // the ends are round numbers rather than one specific chart's BPM.
  const bpmBounds = React.useMemo<FilterRange>(() => {
    const values = entries
      .map((entry) => entry.bpm)
      .filter((bpm): bpm is number => typeof bpm === "number" && Number.isFinite(bpm));
    if (values.length === 0) {
      return [0, 0];
    }
    return [
      Math.floor(Math.min(...values) / 10) * 10,
      Math.ceil(Math.max(...values) / 10) * 10,
    ];
  }, [entries]);

  const isComposingRef = React.useRef(false);
  const debounceRef = React.useRef<number | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const listTopRef = React.useRef<HTMLDivElement | null>(null);
  const toolbarSentinelRef = React.useRef<HTMLDivElement | null>(null);

  // A 1px sentinel just above the toolbar reports when it has scrolled under
  // the sticky header, i.e. the toolbar is pinned and needs its backdrop.
  React.useEffect(() => {
    const sentinel = toolbarSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setToolbarStuck(
          !entry.isIntersecting && entry.boundingClientRect.top < STICKY_TOOLBAR_TOP_PX
        );
      },
      { rootMargin: `-${STICKY_TOOLBAR_TOP_PX}px 0px 0px 0px` }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

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
    // genre=107 (宴会場) has no chip of its own — it resolves to the Type row's
    // UTAGE chip, so read the two dimensions together.
    const genreSet = readSet("genre");
    const cabinet = readSet("cabinet");
    const { genreIds: genreFromUrl, cabinetIds: cabinetFromUrl } =
      foldUtageGenreIntoCabinet(genreSet, cabinet);
    if (genreFromUrl) setGenreIds(genreFromUrl);
    if (cabinetFromUrl) setCabinetSet(cabinetFromUrl);
    const versionParam = readSet("version");
    const versionIds = versionParam
      ? new Set(
          [...versionParam]
            .map(normalizeVersionFilterId)
            .filter((id): id is string => id !== null)
        )
      : null;
    if (versionIds && versionIds.size > 0) setVersionSet(versionIds);
    // Level and BPM are ranges now; both readers still accept the chip-list form
    // they replaced (`level=13,14+`, `bpm=1,2`), collapsing a list to its span.
    const level = params.get("level");
    const parsedLevel = level ? parseLevelParam(level, levelScale) : null;
    if (parsedLevel) setLevelRange(isFullRange(parsedLevel, levelBounds) ? null : parsedLevel);
    const bpm = params.get("bpm");
    const parsedBpm = bpm ? parseBpmParam(bpm, bpmBounds) : null;
    if (parsedBpm) setBpmRange(isFullRange(parsedBpm, bpmBounds) ? null : parsedBpm);
    const asset = readSet("asset");
    if (asset) setAssetSet(asset);
    // Landed with dimension filters already applied → reveal the picker so the
    // user can see and adjust them.
    if ((versionIds && versionIds.size > 0) || level || genreSet || cabinet || bpm || asset) {
      setFiltersOpen(true);
    }
    if (Number.isInteger(pageParam) && pageParam > 1) {
      setCurrentPage(pageParam);
    }
    // The header's search icon links here with ?focus=search. Put the cursor in
    // the filter box, then strip the param so it never reaches a shared or
    // restored URL (the sync effect below re-reads location.search after this).
    if (params.get("focus") === "search") {
      // preventScroll: the box is already near the top on a fresh navigation,
      // and jumping the viewport mid-mount reads as a glitch.
      searchInputRef.current?.focus({ preventScroll: true });
      params.delete("focus");
      const rest = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`
      );
    }
    setUrlReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Mount-only by design: this reads the landing URL exactly once, and re-running
    // it would overwrite whatever the user has since picked. The level/BPM scales it
    // resolves ranges against are derived from `entries`, fixed for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const versionOptions = React.useMemo(() => {
    const scopedEntries =
      effectiveCategory === ALL_CATEGORIES
        ? entries
        : entries.filter((entry) => entry.category === effectiveCategory);
    const byId = new Map<
      string,
      { id: string; label: string; imageIndex: number | null }
    >();

    for (const entry of scopedEntries) {
      const id = catalogVersionFilterId(entry);
      if (byId.has(id)) continue;
      const imageIndex = id === "unknown" ? null : Number(id);
      const label =
        imageIndex === null
          ? unknownVersionLabel
          : VERSION_NAME_BY_INDEX.get(imageIndex) ||
            entry.subcategory ||
            entry.version ||
            unknownVersionLabel;
      byId.set(id, { id, label, imageIndex });
    }

    return [...byId.values()].sort(
      (a, b) => (b.imageIndex ?? -1) - (a.imageIndex ?? -1)
    );
  }, [entries, effectiveCategory, unknownVersionLabel]);
  const versionOptionById = React.useMemo(
    () => new Map(versionOptions.map((option) => [option.id, option] as const)),
    [versionOptions]
  );
  // Built over the reversed scale because the slider is reversed: the gradient is
  // always given in visual left-to-right order, i.e. Re:Master-violet → Basic-green.
  const levelGradient = React.useMemo(
    () => buildLevelGradient([...levelScale].reverse()),
    [levelScale]
  );
  // The slider always shows a concrete span; null state means "the whole scale".
  const levelValue = levelRange ?? levelBounds;
  const genreOptions = React.useMemo(() => {
    const ids = new Set<number>();
    for (const entry of entries) {
      const id = resolveGenreId(entry);
      // The 宴会场 genre equals the Type row's Utage chip, so it's only offered
      // there (as the 宴会場 icon) to avoid a duplicate 宴 chip. Deep links that
      // name it are folded onto that chip by foldUtageGenreIntoCabinet.
      if (id !== null && id !== UTAGE_GENRE_ID) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [entries]);
  const cabinetOptions = React.useMemo(() => {
    const present = new Set<string>();
    for (const entry of entries) present.add(cabinetBucket(entry.cabinet));
    return (["DX", "ST", "UTAGE"] as const).filter((value) => present.has(value));
  }, [entries]);
  const bpmValue = bpmRange ?? bpmBounds;
  // BGA (background video) presence — a single-select pair: with / without.
  const assetOptions = React.useMemo(() => {
    const options: Array<{ id: "pv" | "nopv"; label: string }> = [];
    if (entries.some((entry) => entry.assets?.has_pv)) {
      options.push({ id: "pv", label: dictionary.assetHasPv });
    }
    if (entries.some((entry) => !entry.assets?.has_pv)) {
      options.push({ id: "nopv", label: dictionary.assetNoPv });
    }
    return options;
  }, [entries, dictionary.assetHasPv, dictionary.assetNoPv]);

  // One predicate per dimension, each `null` when that dimension filters nothing.
  // Keeping them separate is what lets the chip rows below ask "how many results
  // would survive if this dimension were dropped" without re-deriving the query.
  const dimensionTests = React.useMemo(() => {
    const levelSpan =
      levelRange && levelScale.length > 0 && !isFullRange(levelRange, levelBounds)
        ? ([levelScale[levelRange[0]], levelScale[levelRange[1]]] as const)
        : null;
    return {
      version:
        versionSet.size > 0
          ? (entry: CatalogCardEntry) => versionSet.has(catalogVersionFilterId(entry))
          : null,
      level: levelSpan
        ? (entry: CatalogCardEntry) => entryHasLevelInRange(entry, levelSpan[0], levelSpan[1])
        : null,
      genre:
        genreIds.size > 0
          ? (entry: CatalogCardEntry) => genreIds.has(String(resolveGenreId(entry)))
          : null,
      cabinet:
        cabinetSet.size > 0
          ? (entry: CatalogCardEntry) => cabinetSet.has(cabinetBucket(entry.cabinet))
          : null,
      bpm:
        bpmRange && !isFullRange(bpmRange, bpmBounds)
          ? (entry: CatalogCardEntry) =>
              typeof entry.bpm === "number" &&
              entry.bpm >= bpmRange[0] &&
              entry.bpm <= bpmRange[1]
          : null,
      asset: assetSet.has("pv")
        ? (entry: CatalogCardEntry) => Boolean(entry.assets?.has_pv)
        : assetSet.has("nopv")
          ? (entry: CatalogCardEntry) => !entry.assets?.has_pv
          : null,
    };
  }, [
    versionSet,
    levelRange,
    levelScale,
    levelBounds,
    genreIds,
    cabinetSet,
    bpmRange,
    bpmBounds,
    assetSet,
  ]);

  // Entries passing the search + category scope, before any dimension applies.
  const scopedEntries = React.useMemo(
    () => applyCatalogFilters(baseEntries, effectiveCategory, ALL_SUBCATEGORIES),
    [baseEntries, effectiveCategory]
  );

  const visibleEntries = React.useMemo(() => {
    const tests = Object.values(dimensionTests).filter((test) => test !== null);
    // OR within each dimension (inside its own predicate), AND across dimensions.
    return tests.length === 0
      ? scopedEntries
      : scopedEntries.filter((entry) => tests.every((test) => test(entry)));
  }, [scopedEntries, dimensionTests]);

  /**
   * How many results each chip would still leave, judged against every *other*
   * dimension — the standard faceted-search count. A chip at zero is a dead end
   * and gets disabled, which is what makes the incompatible combinations visible
   * instead of silently emptying the grid: pick a genre and the 宴会場 type greys
   * out (UTAGE charts are all genre 宴会場, so no genre can coexist with it), pick
   * 宴会場 and every genre greys out, pick an early version and it greys out too
   * (there are no UTAGE charts before BUDDiES).
   *
   * Counted against the other dimensions rather than the current results, so a
   * selected chip never zeroes itself out and stays clickable to undo.
   */
  const chipCounts = React.useMemo(() => {
    const withoutDimension = (skip: keyof typeof dimensionTests) => {
      const tests = Object.entries(dimensionTests)
        .filter(([key, test]) => key !== skip && test !== null)
        .map(([, test]) => test as (entry: CatalogCardEntry) => boolean);
      return tests.length === 0
        ? scopedEntries
        : scopedEntries.filter((entry) => tests.every((test) => test(entry)));
    };
    const tally = (list: CatalogCardEntry[], keyOf: (entry: CatalogCardEntry) => string) => {
      const counts = new Map<string, number>();
      for (const entry of list) {
        const key = keyOf(entry);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    const assetBase = withoutDimension("asset");
    return {
      version: tally(withoutDimension("version"), catalogVersionFilterId),
      genre: tally(withoutDimension("genre"), (entry) => String(resolveGenreId(entry))),
      cabinet: tally(withoutDimension("cabinet"), (entry) => cabinetBucket(entry.cabinet)),
      asset: new Map<string, number>([
        ["pv", assetBase.filter((entry) => entry.assets?.has_pv).length],
        ["nopv", assetBase.filter((entry) => !entry.assets?.has_pv).length],
      ]),
    };
  }, [scopedEntries, dimensionTests]);

  /** A chip is a dead end when nothing would survive picking it — unless it is
   *  already picked, in which case it has to stay clickable to be undone. */
  const isChipDisabled = (
    dimension: keyof typeof chipCounts,
    id: string,
    selected: boolean
  ) => !selected && (chipCounts[dimension].get(id) ?? 0) === 0;
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

  // Number of applied dimension filters, shown as a badge on the panel toggle.
  // A narrowed range counts as one filter, however wide it is.
  const levelFiltered = dimensionTests.level !== null;
  const bpmFiltered = dimensionTests.bpm !== null;
  const dimensionFilterCount =
    versionSet.size +
    genreIds.size +
    cabinetSet.size +
    assetSet.size +
    (levelFiltered ? 1 : 0) +
    (bpmFiltered ? 1 : 0);
  const hasActiveFilters =
    hasQuery ||
    dimensionFilterCount > 0 ||
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
  const toggleGenre = toggleIn(setGenreIds);
  const toggleCabinet = toggleIn(setCabinetSet);
  // Dragging a range back to its full span is the same as not filtering, so it
  // stores null — the badge count, the active-filter chip and the URL param all
  // read off that one state instead of each re-testing the bounds.
  const commitRange =
    (setter: React.Dispatch<React.SetStateAction<FilterRange | null>>, bounds: FilterRange) =>
    (next: number[]) => {
      const range = clampRange([next[0], next[1]], bounds);
      setter(isFullRange(range, bounds) ? null : range);
      setCurrentPage(1);
    };
  const commitLevelRange = commitRange(setLevelRange, levelBounds);
  const commitBpmRange = commitRange(setBpmRange, bpmBounds);
  // BGA is single-select (with / without are mutually exclusive): picking one
  // replaces the set; re-picking it clears back to "all".
  const selectAsset = (id: string) => {
    setAssetSet((prev) => (prev.has(id) ? new Set() : new Set([id])));
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    setInputValue("");
    setQuery("");
    setVersionSet(new Set());
    setGenreIds(new Set());
    setCabinetSet(new Set());
    setAssetSet(new Set());
    setLevelRange(null);
    setBpmRange(null);
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
    // Levels go out as labels ("8-13+") rather than indices, so a shared link
    // survives the scale growing a level.
    apply(
      "level",
      levelRange && levelScale[levelRange[0]] && levelScale[levelRange[1]]
        ? `${levelScale[levelRange[0]]}-${levelScale[levelRange[1]]}`
        : null
    );
    apply("genre", joinSet(genreIds));
    apply("cabinet", joinSet(cabinetSet));
    apply("bpm", bpmRange ? formatRangeParam(bpmRange) : null);
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
    levelRange,
    levelScale,
    genreIds,
    cabinetSet,
    bpmRange,
    assetSet,
    safeCurrentPage,
  ]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    // After the new page renders, bring the list top back into view — otherwise
    // the viewport is left stranded at the pagination card below the grid.
    requestAnimationFrame(() => {
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
    return buildSelectedCatalogCharts(entries, chartSpecs, selectedIds);
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
    <div
      className={cn(
        "flex flex-col gap-6",
        showBatchBar && "pb-[calc(var(--batch-download-bar-height,6rem)+2rem)]"
      )}
    >
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

      <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          // The header's search icon focuses this box directly when the browse
          // route is already mounted (no navigation to hang the ?focus= param on).
          data-catalog-search=""
          // Solid card fill + shadow so the box reads clearly against the page's
          // tinted gradient (a transparent input blends into it).
          className={cn("h-10 border-border bg-card pl-9 shadow-sm", inputValue && "pr-9")}
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
      <RandomChartButton locale={locale} label={dictionary.randomChart} iconOnly />
      </div>

      {/* Advanced filters are tucked into a collapsible panel (closed by
          default) so the browse page stays uncluttered. */}
      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
        aria-expanded={filtersOpen}
        className="flex w-fit items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ListFilterIcon className="size-4" />
        {dictionary.advancedFilters}
        {dimensionFilterCount > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {dimensionFilterCount}
          </Badge>
        ) : null}
        <ChevronDownIcon
          className={cn("size-4 transition-transform", filtersOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {filtersOpen ? (
          <motion.div
            key="filter-rows"
            initial="collapsed"
            animate="open"
            exit="collapsed"
            variants={filterPanelVariants}
            className="overflow-hidden"
          >
            {/* One chip row per dimension — pick directly, combine across rows.
                Each row's "all" chip clears just that dimension. */}
            <div className="flex flex-col gap-2.5 pt-1">
        {versionOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterVersion}>
            <AllChip active={versionSet.size === 0} onClick={clearSet(setVersionSet)}>
              {dictionary.filterAll}
            </AllChip>
            {versionOptions.map((option) => {
              const iconSources =
                option.imageIndex !== null
                  ? versionImageSourcesByIndex(option.imageIndex)
                  : null;
              // Icon-only: the version logo is the identity; name lives in the
              // aria-label / title for a11y and hover.
              return (
                <ToggleChip
                  key={option.id}
                  active={versionSet.has(option.id)}
                  disabled={isChipDisabled(
                    "version",
                    option.id,
                    versionSet.has(option.id)
                  )}
                  onClick={() => toggleVersion(option.id)}
                  className="px-2 py-1"
                  ariaLabel={option.label}
                  title={option.label}
                >
                  {iconSources ? (
                    <CompatibleImage
                      sources={iconSources}
                      alt=""
                      width={VERSION_IMAGE_DIMENSIONS.width}
                      height={VERSION_IMAGE_DIMENSIONS.height}
                      className="h-9 w-auto"
                    />
                  ) : (
                    versionShortName(option.label)
                  )}
                </ToggleChip>
              );
            })}
          </ChipFilterRow>
        ) : null}

        {levelScale.length > 1 ? (
          <RangeFilterRow
            label={dictionary.filterLevel}
            active={levelFiltered}
            onReset={() => {
              setLevelRange(null);
              setCurrentPage(1);
            }}
            resetLabel={dictionary.filterAll}
          >
            <RangeSlider
              value={[levelValue[0], levelValue[1]]}
              min={levelBounds[0]}
              max={levelBounds[1]}
              step={1}
              minStepsBetweenThumbs={0}
              onValueChange={commitLevelRange}
              gradient={levelGradient}
              reversed
              formatValue={(value, index) =>
                `${index === 0 ? dictionary.rangeMin : dictionary.rangeMax} ${levelScale[value] ?? value}`
              }
              renderThumbValue={(value) => levelScale[value] ?? String(value)}
            />
          </RangeFilterRow>
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
                disabled={isChipDisabled("genre", String(id), genreIds.has(String(id)))}
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
                  disabled={
                    isChipDisabled("cabinet", value, cabinetSet.has(value)) ||
                    isCabinetLockedOut(value, cabinetSet)
                  }
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

        {bpmBounds[1] > bpmBounds[0] ? (
          <RangeFilterRow
            label={dictionary.filterBpm}
            active={bpmFiltered}
            onReset={() => {
              setBpmRange(null);
              setCurrentPage(1);
            }}
            resetLabel={dictionary.filterAll}
          >
            <RangeSlider
              value={[bpmValue[0], bpmValue[1]]}
              min={bpmBounds[0]}
              max={bpmBounds[1]}
              step={5}
              minStepsBetweenThumbs={0}
              onValueChange={commitBpmRange}
              gradient={BPM_GRADIENT}
              reversed
              formatValue={(value, index) =>
                `${index === 0 ? dictionary.rangeMin : dictionary.rangeMax} BPM ${value}`
              }
              renderThumbValue={(value) => String(value)}
            />
          </RangeFilterRow>
        ) : null}

        {assetOptions.length > 0 ? (
          <ChipFilterRow label={dictionary.filterAssets}>
            <AllChip active={assetSet.size === 0} onClick={clearSet(setAssetSet)}>
              {dictionary.filterAll}
            </AllChip>
            {assetOptions.map((option) => (
              <ToggleChip
                key={option.id}
                active={assetSet.has(option.id)}
                disabled={isChipDisabled("asset", option.id, assetSet.has(option.id))}
                onClick={() => selectAsset(option.id)}
              >
                {option.label}
              </ToggleChip>
            ))}
          </ChipFilterRow>
        ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {hasActiveFilters ? (
        // A single place to see every applied condition and drop any one of
        // them — the fast path for narrowing by several criteria at once.
        <div
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          role="group"
          aria-label={dictionary.activeFiltersLabel}
        >
          {/* popLayout pops a removed chip out of flow so its neighbors (all
              layout chips) spring over on springSoft while it collapses. */}
          <AnimatePresence mode="popLayout" initial={false}>
          {hasQuery ? (
            <FilterChip
              key="q"
              onRemove={clearSearch}
              removeLabel={dictionary.removeFilter(query)}
              icon={<SearchIcon className="size-3 shrink-0 text-muted-foreground" />}
            >
              {query}
            </FilterChip>
          ) : null}
          {[...versionSet].map((id) => {
            const option = versionOptionById.get(id);
            const numericId = Number(id);
            const imageIndex =
              option?.imageIndex ?? (isKnownVersionIndex(numericId) ? numericId : null);
            const label =
              option?.label ??
              (imageIndex !== null ? VERSION_NAME_BY_INDEX.get(imageIndex) : undefined) ??
              unknownVersionLabel;
            const iconSources =
              imageIndex !== null ? versionImageSourcesByIndex(imageIndex) : null;
            return (
              <FilterChip
                key={`v-${id}`}
                onRemove={() => toggleVersion(id)}
                removeLabel={dictionary.removeFilter(label)}
                icon={
                  iconSources ? (
                    <CompatibleImage
                      sources={iconSources}
                      alt=""
                      width={VERSION_IMAGE_DIMENSIONS.width}
                      height={VERSION_IMAGE_DIMENSIONS.height}
                      className="h-4 w-auto shrink-0"
                    />
                  ) : undefined
                }
              >
                {versionShortName(label)}
              </FilterChip>
            );
          })}
          {levelFiltered ? (
            <FilterChip
              key="level"
              onRemove={() => {
                setLevelRange(null);
                setCurrentPage(1);
              }}
              removeLabel={dictionary.removeFilter(
                dictionary.levelRangeLabel(levelScale[levelValue[0]], levelScale[levelValue[1]])
              )}
            >
              {dictionary.levelRangeLabel(
                levelScale[levelValue[0]],
                levelScale[levelValue[1]]
              )}
            </FilterChip>
          ) : null}
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
          {bpmFiltered ? (
            <FilterChip
              key="bpm"
              onRemove={() => {
                setBpmRange(null);
                setCurrentPage(1);
              }}
              removeLabel={dictionary.removeFilter(
                dictionary.bpmRangeLabel(bpmValue[0], bpmValue[1])
              )}
            >
              {dictionary.bpmRangeLabel(bpmValue[0], bpmValue[1])}
            </FilterChip>
          ) : null}
          {[...assetSet].map((value) => {
            const label = value === "pv" ? dictionary.assetHasPv : dictionary.assetNoPv;
            return (
              <FilterChip
                key={`a-${value}`}
                onRemove={() => selectAsset(value)}
                removeLabel={dictionary.removeFilter(label)}
              >
                {label}
              </FilterChip>
            );
          })}
          {hasUserSelectedCategory && effectiveCategory !== ALL_CATEGORIES ? (
            <FilterChip
              key="category"
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
          {/* Layout-animated so the clear button slides along with the chips. */}
          <motion.div key="clear-all" layout transition={springSoft}>
            <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters}>
              {dictionary.clearFilters}
            </Button>
          </motion.div>
          </AnimatePresence>
        </div>
      ) : null}

      {/* 1px pin sentinel for the toolbar below; the negative margin swallows
          its own height plus the column gap so layout is unchanged. */}
      <div
        ref={toolbarSentinelRef}
        aria-hidden="true"
        className="-mb-[calc(1.5rem+1px)] h-px"
      />
      <div
        ref={listTopRef}
        className="sticky top-[4.5rem] z-10 flex scroll-mt-24 flex-wrap items-center justify-between gap-2"
      >
        {/* Pre-rendered pinned backdrop (bg + border + shadow), crossfaded via
            opacity only — never animate shadow/blur directly. Decorative, so
            opacity:0 in the static HTML is fine. */}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: toolbarStuck ? 1 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="pointer-events-none absolute -inset-x-3 -inset-y-2 -z-10 rounded-xl border border-border/60 bg-background/95 shadow-md"
        />
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
              {dictionary.selectAllFiltered(orderedEntries.length)}
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
        {/* Live so filter/search changes are announced to screen readers —
            RollingNumber keeps its animated digits aria-hidden, so only the
            final count is ever announced. */}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <ResultsSummary
            count={visibleEntries.length}
            template={dictionary.resultsSummary(visibleEntries.length)}
          />
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
        <motion.ul
          layout
          role="list"
          data-layout="card-grid"
          className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {paginatedEntries.map((entry, index) => (
              <motion.li
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                // In select mode the whole card is a toggle — give the press
                // tactile feedback on its owned click surface.
                whileTap={selectMode ? { scale: 0.97 } : undefined}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className="h-full"
              >
                <ChartCard
                  entry={entry}
                  locale={locale}
                  priority={safeCurrentPage === 1 && index < 6}
                  sizes={CARD_SIZES}
                  aliasHit={hasQuery ? aliasHitById.get(entry.id) ?? null : null}
                  selectable={selectMode}
                  selected={selectedIds.has(entry.id)}
                  onToggleSelect={() => toggleSelection(entry.id)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
          {totalPages > 1 ? (
            // Presentational so it isn't announced as a list item, but stays a
            // valid <ul> child while spanning the full grid row.
            <li role="presentation" className="col-span-full">
            <Card size="sm" className="border border-border/70 bg-card/70">
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
            </li>
          ) : null}
        </motion.ul>
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
// A motion row so the advanced panel's open stagger cascades through it (the
// variants are inherited from the panel — no own animate prop).
function ChipFilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <motion.div variants={filterRowVariants} className="flex items-center gap-x-2">
      <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {/* overflow-x also clips overflow-y, so pad vertically (and a touch right)
          to give the selected chip's ring room instead of shearing its edge. */}
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1.5 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </motion.div>
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
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  /** No result would survive picking this — greyed out and inert. */
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.93 }}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-[color,background-color,border-color,opacity,filter]",
        // Greyed out: desaturated and faded, whatever tone it would otherwise
        // carry, so an incompatible option reads as unavailable rather than
        // merely unselected.
        disabled
          ? "cursor-not-allowed border-border opacity-40 grayscale"
          : tone
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

// A labeled filter row holding a range slider plus its current readout. Mirrors
// ChipFilterRow's label column so the rows line up, but the control fills the
// track instead of scrolling horizontally.
function RangeFilterRow({
  label,
  active,
  onReset,
  resetLabel,
  children,
}: {
  label: string;
  active: boolean;
  onReset: () => void;
  resetLabel: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={filterRowVariants} className="flex items-center gap-x-2">
      <span className="w-12 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {/* The current values ride under the thumbs themselves (see RangeSlider),
          so the row carries only the reset chip and the track. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pr-4">
        <AllChip active={!active} onClick={onReset}>
          {resetLabel}
        </AllChip>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </motion.div>
  );
}

// The localized results summary is a whole sentence ("共 N 首谱面"); split it
// around the raw count so only the digits roll while the words stay static.
// SSR always contains the real value (RollingNumber's initial state).
function ResultsSummary({ count, template }: { count: number; template: string }) {
  const raw = String(count);
  const index = template.indexOf(raw);
  if (index === -1) {
    return <>{template}</>;
  }
  return (
    <>
      {template.slice(0, index)}
      <RollingNumber
        value={count}
        // Pinned locale so the server and client render identical grouping.
        format={(n) => n.toLocaleString("en-US")}
        className="tabular-nums"
      />
      {template.slice(index + raw.length)}
    </>
  );
}

// One applied filter shown in the active-filters bar: a label + a remove (×).
// `className` tints it to match a genre chip; `icon` prefixes it (search glyph
// or version logo). A layout motion element so add/remove reflows spring.
function FilterChip({
  children,
  onRemove,
  removeLabel,
  icon,
  className,
  ref,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
  icon?: React.ReactNode;
  className?: string;
  // popLayout's exit measurement needs a DOM ref through the component.
  ref?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <motion.span
      ref={ref}
      layout
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={springSoft}
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
    </motion.span>
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
