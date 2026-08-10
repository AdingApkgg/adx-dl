import {
  compareByImportedDesc,
  compareByReleaseDesc,
  levelSortValue,
} from "@/lib/catalog-shared";

/**
 * The ordering slice the browse sorters read. Both `CatalogEntry` and the
 * slimmer `CatalogCardEntry` satisfy it, so the same comparators serve the
 * browse grid and any server-side listing.
 */
export type SortableEntry = {
  title: string;
  bpm: number | null;
  imported_at?: string;
  versionid?: number;
  cabinet: string;
  short_id: string;
  difficulties: readonly { level: string }[];
};

/**
 * Browse orderings, in the order they appear in the picker.
 *
 * `default` is not a seventh ordering so much as "let the page decide": with a
 * query it means the search's own relevance ranking (which no comparator can
 * reproduce — it lives in the result order), and without one it means the
 * newest release era first. Keeping it a distinct value is what lets `?sort=`
 * stay absent from the URL until the visitor actually picks something.
 */
export const CATALOG_SORT_IDS = [
  "default",
  "imported",
  "level-desc",
  "level-asc",
  "bpm-desc",
  "bpm-asc",
  "title-asc",
] as const;

export type CatalogSortId = (typeof CATALOG_SORT_IDS)[number];

export const DEFAULT_CATALOG_SORT: CatalogSortId = "default";

/** Read a `?sort=` value, or null when it names no ordering (so the caller keeps
 *  its default rather than silently reordering the grid). */
export function parseCatalogSortId(raw: string | null | undefined): CatalogSortId | null {
  const value = raw?.trim();
  return value && (CATALOG_SORT_IDS as readonly string[]).includes(value)
    ? (value as CatalogSortId)
    : null;
}

/**
 * The hardest difficulty a chart offers, on the same scale the level filter
 * uses ("12+" sits between 12 and 13). `null` when no difficulty carries a
 * parsable level — UTAGE charts sometimes only have "宴".
 */
export function entryPeakLevelValue(entry: SortableEntry): number | null {
  let peak: number | null = null;
  for (const difficulty of entry.difficulties) {
    const value = levelSortValue(difficulty.level ?? "");
    if (value < 0) continue;
    if (peak === null || value > peak) peak = value;
  }
  return peak;
}

function entryBpmValue(entry: SortableEntry): number | null {
  return typeof entry.bpm === "number" && Number.isFinite(entry.bpm) ? entry.bpm : null;
}

/**
 * Compare on a numeric key that some entries simply don't have.
 *
 * Entries without a value sink to the bottom in *both* directions rather than
 * flipping to the top on the ascending pass: "sort by BPM, ascending" is a
 * request to see the slowest charts, not the ones whose BPM was never measured.
 * Ties fall back to the default release order so the grid never reshuffles
 * arbitrarily between renders.
 */
function compareByOptionalNumber<T extends SortableEntry>(
  a: T,
  b: T,
  valueOf: (entry: T) => number | null,
  direction: "asc" | "desc"
): number {
  const valueA = valueOf(a);
  const valueB = valueOf(b);
  if (valueA === null || valueB === null) {
    if (valueA === valueB) return compareByReleaseDesc(a, b);
    return valueA === null ? 1 : -1;
  }
  if (valueA !== valueB) {
    return direction === "asc" ? valueA - valueB : valueB - valueA;
  }
  return compareByReleaseDesc(a, b);
}

/**
 * Sort a copy of `entries` into the requested order.
 *
 * `collator` is required only for `title-asc`; it is passed in rather than
 * built here so the caller can pin it to the reader's locale (zh sorts by
 * pinyin, ja by kana) and reuse one instance across renders.
 */
export function sortCatalogEntries<T extends SortableEntry>(
  entries: readonly T[],
  sort: CatalogSortId,
  collator?: Intl.Collator
): T[] {
  const sorted = [...entries];
  switch (sort) {
    case "imported":
      return sorted.sort(compareByImportedDesc);
    case "level-desc":
      return sorted.sort((a, b) => compareByOptionalNumber(a, b, entryPeakLevelValue, "desc"));
    case "level-asc":
      return sorted.sort((a, b) => compareByOptionalNumber(a, b, entryPeakLevelValue, "asc"));
    case "bpm-desc":
      return sorted.sort((a, b) => compareByOptionalNumber(a, b, entryBpmValue, "desc"));
    case "bpm-asc":
      return sorted.sort((a, b) => compareByOptionalNumber(a, b, entryBpmValue, "asc"));
    case "title-asc":
      return sorted.sort(
        (a, b) =>
          (collator
            ? collator.compare(a.title, b.title)
            : a.title.localeCompare(b.title)) || compareByReleaseDesc(a, b)
      );
    default:
      return sorted.sort(compareByReleaseDesc);
  }
}
