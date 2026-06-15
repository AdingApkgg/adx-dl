import Fuse, { type IFuseOptions } from "fuse.js";

import type { CatalogEntry } from "@/lib/catalog-shared";

export const ALL_CATEGORIES = "all";
export const ALL_SUBCATEGORIES = "all";
const maxAcceptedScore = 0.4;

const fuseOptions: IFuseOptions<CatalogEntry> = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: "title", weight: 0.35 },
    { name: "title_en", weight: 0.35 },
    // Community nicknames (别名) — an alias is effectively an alternate title, so
    // weight it like one. Fuse searches each string in the array.
    { name: "aliases", weight: 0.3 },
    { name: "artist", weight: 0.15 },
    { name: "artist_en", weight: 0.15 },
    { name: "id", weight: 0.08 },
    { name: "version", weight: 0.05 },
    { name: "subcategory", weight: 0.04 },
    { name: "genre", weight: 0.03 },
  ],
};

/** A search result paired with the alias that matched, when the hit came via an
 * alias (别名) rather than the title — used to explain why a result surfaced. */
export type CatalogSearchResult = {
  entry: CatalogEntry;
  aliasHit: string | null;
};

// Surface the matched alias only when the visible title didn't also match, so the
// hint is never redundant with what the card already shows.
function pickAliasHit(
  entry: CatalogEntry,
  matches: readonly { key?: string; value?: string }[] | undefined,
  loweredQuery: string
): string | null {
  const aliasMatch = matches?.find(
    (match) => match.key === "aliases" && typeof match.value === "string"
  );
  if (!aliasMatch?.value) {
    return null;
  }
  const titleAlreadyMatches = [entry.title, entry.title_en].some((title) =>
    title?.toLowerCase().includes(loweredQuery)
  );
  return titleAlreadyMatches ? null : aliasMatch.value;
}

export function buildCatalogSearchWithMatches(entries: CatalogEntry[]) {
  const fuse = new Fuse(entries, fuseOptions);

  return (query: string): CatalogSearchResult[] => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return entries.map((entry) => ({ entry, aliasHit: null }));
    }

    const loweredQuery = normalizedQuery.toLowerCase();
    return fuse
      .search(normalizedQuery)
      .filter((result) => result.score === undefined || result.score <= maxAcceptedScore)
      .map((result) => ({
        entry: result.item,
        aliasHit: pickAliasHit(result.item, result.matches, loweredQuery),
      }));
  };
}

export function buildCatalogSearch(entries: CatalogEntry[]) {
  const search = buildCatalogSearchWithMatches(entries);
  return (query: string): CatalogEntry[] => search(query).map((result) => result.entry);
}

export function applyCatalogFilters(
  entries: CatalogEntry[],
  category: string,
  subcategory: string
): CatalogEntry[] {
  return entries.filter((entry) => {
    if (category !== ALL_CATEGORIES && entry.category !== category) {
      return false;
    }

    if (subcategory !== ALL_SUBCATEGORIES && entry.subcategory !== subcategory) {
      return false;
    }

    return true;
  });
}

export function getCategoryOptions(entries: CatalogEntry[]): string[] {
  return [
    ALL_CATEGORIES,
    ...Array.from(new Set(entries.map((entry) => entry.category))).sort(),
  ];
}

export function getSubcategoryOptions(entries: CatalogEntry[], category: string): string[] {
  const scopedEntries =
    category === ALL_CATEGORIES
      ? entries
      : entries.filter((entry) => entry.category === category);

  return [
    ALL_SUBCATEGORIES,
    ...Array.from(new Set(scopedEntries.map((entry) => entry.subcategory))).sort(),
  ];
}
