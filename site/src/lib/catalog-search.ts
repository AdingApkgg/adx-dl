import Fuse, { type IFuseOptions } from "fuse.js";

import type { CatalogEntry } from "@/lib/catalog-shared";

export const ALL_CATEGORIES = "all";
export const ALL_SUBCATEGORIES = "all";
const maxAcceptedScore = 0.4;

const fuseOptions: IFuseOptions<CatalogEntry> = {
  includeScore: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: "title", weight: 0.35 },
    { name: "title_en", weight: 0.35 },
    { name: "artist", weight: 0.15 },
    { name: "artist_en", weight: 0.15 },
    { name: "id", weight: 0.08 },
    { name: "version", weight: 0.05 },
    { name: "subcategory", weight: 0.04 },
    { name: "genre", weight: 0.03 },
  ],
};

export function buildCatalogSearch(entries: CatalogEntry[]) {
  const fuse = new Fuse(entries, fuseOptions);

  return (query: string): CatalogEntry[] => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return entries;
    }

    return fuse
      .search(normalizedQuery)
      .filter((result) => result.score === undefined || result.score <= maxAcceptedScore)
      .map((result) => result.item);
  };
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
