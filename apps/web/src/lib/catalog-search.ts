import Fuse, { type IFuseOptions } from "fuse.js";

import { uniqueChartDesigners, type CatalogEntry } from "@/lib/catalog-shared";

export const ALL_CATEGORIES = "all";
export const ALL_SUBCATEGORIES = "all";
export const ALL_LEVELS = "all";
const maxAcceptedScore = 0.4;

/**
 * The minimal slice an entry needs to go through the Fuse index. Full catalog
 * entries, card entries and the slim hero-suggestion index all satisfy it.
 */
export type SearchableEntry = {
  id: string;
  title: string;
  title_en?: string;
  /** Hepburn transliteration of a kana title — the Latin entry point for songs
   *  that have no English title at all (see lib/romaji.ts). */
  title_romaji?: string;
  artist: string;
  artist_en?: string;
  artist_romaji?: string;
  /** Community nicknames (别名). */
  aliases?: string[];
  version?: string;
  subcategory?: string;
  genre?: string;
  /** Per-difficulty charter (谱师) credits. Card and full entries carry them;
   *  the slim hero index deliberately does not. */
  difficulties?: readonly { designer?: string }[];
};

/** One row of the prebuilt client search index (hero instant suggestions). */
export type CatalogSearchIndexEntry = SearchableEntry & {
  /** Canonical chart route slug. */
  slug: string;
};

/** The charter names a query may hit, deduped and without the "-" placeholders. */
function searchableDesigners(entry: SearchableEntry): string[] {
  return entry.difficulties
    ? uniqueChartDesigners({ difficulties: entry.difficulties })
    : [];
}

const fuseOptions = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: "title", weight: 0.35 },
    { name: "title_en", weight: 0.35 },
    { name: "title_romaji", weight: 0.3 },
    // Community nicknames (别名) — an alias is effectively an alternate title, so
    // weight it like one. Fuse searches each string in the array.
    { name: "aliases", weight: 0.3 },
    { name: "artist", weight: 0.15 },
    { name: "artist_en", weight: 0.15 },
    { name: "artist_romaji", weight: 0.12 },
    // Charters are a first-class thing to browse by ("what else did はっぴー
    // chart?"), but a designer hit must never outrank a title hit, hence a
    // weight just below the artist's. The names live one level down inside
    // `difficulties`, so a getFn flattens them rather than a nested key path.
    { name: "designer", weight: 0.12, getFn: searchableDesigners },
    { name: "id", weight: 0.08 },
    { name: "version", weight: 0.05 },
    { name: "subcategory", weight: 0.04 },
    { name: "genre", weight: 0.03 },
  ],
} satisfies IFuseOptions<SearchableEntry>;

/** A search result paired with the alias that matched, when the hit came via an
 * alias (别名) rather than the title — used to explain why a result surfaced. */
export type CatalogSearchResult<T extends SearchableEntry = CatalogEntry> = {
  entry: T;
  aliasHit: string | null;
};

/** Titles a query can match, so an alias hint is suppressed when one of them
 *  already contains the query and the hint would be redundant. */
function visibleTitles(entry: SearchableEntry): (string | undefined)[] {
  return [entry.title, entry.title_en, entry.title_romaji];
}

// Surface the matched alias only when the visible title didn't also match, so the
// hint is never redundant with what the card already shows.
function pickAliasHit(
  entry: SearchableEntry,
  matches: readonly { key?: string; value?: string }[] | undefined,
  loweredQuery: string
): string | null {
  const aliasMatch = matches?.find(
    (match) => match.key === "aliases" && typeof match.value === "string"
  );
  if (!aliasMatch?.value) {
    return null;
  }
  const titleAlreadyMatches = visibleTitles(entry).some((title) =>
    title?.toLowerCase().includes(loweredQuery)
  );
  return titleAlreadyMatches ? null : aliasMatch.value;
}

function substringAliasHit(entry: SearchableEntry, loweredQuery: string): string | null {
  const alias = entry.aliases?.find((value) =>
    value.toLowerCase().includes(loweredQuery)
  );
  if (!alias) {
    return null;
  }
  const titleAlreadyMatches = visibleTitles(entry).some((title) =>
    title?.toLowerCase().includes(loweredQuery)
  );
  return titleAlreadyMatches ? null : alias;
}

/** Field separator in the substring haystack. NUL, because no keyboard emits it
 *  and so a match can never straddle two joined fields: with a space, the query
 *  "star hoshino" would hit an entry whose title ends in "Star" and whose artist
 *  begins with "Hoshino". */
const FIELD_SEPARATOR = "\u0000";

/**
 * One entry's precomputed search material: everything a query may hit, lowered
 * and joined, plus the charter names (needed again to rank a designer hit).
 */
type SearchRow = { haystack: string; designers: string[] };

function buildSearchRow(entry: SearchableEntry): SearchRow {
  const designers = searchableDesigners(entry);
  const fields = [
    entry.title,
    entry.title_en,
    entry.title_romaji,
    entry.artist,
    entry.artist_en,
    entry.artist_romaji,
    entry.version,
    entry.subcategory,
    entry.genre,
    entry.id,
    ...(entry.aliases ?? []),
    ...designers,
  ];
  return {
    haystack: fields
      .filter((field): field is string => Boolean(field))
      .join(FIELD_SEPARATOR)
      .toLowerCase(),
    designers,
  };
}

/**
 * Where a substring hit landed, low is better. The exact pass has no relevance
 * score of its own, and without this a genre match would sit above a title
 * match purely because it came first in the catalog. A prefix beats a
 * mid-string hit inside the same group.
 */
function substringRank(
  entry: SearchableEntry,
  designers: readonly string[],
  loweredQuery: string
): number {
  const rankOf = (values: readonly (string | undefined)[], base: number): number | null => {
    let best: number | null = null;
    for (const value of values) {
      if (!value) continue;
      const lowered = value.toLowerCase();
      if (lowered.startsWith(loweredQuery)) return base;
      if (lowered.includes(loweredQuery)) best = base + 1;
    }
    return best;
  };
  return (
    rankOf(visibleTitles(entry), 0) ??
    rankOf(entry.aliases ?? [], 2) ??
    rankOf([entry.artist, entry.artist_en, entry.artist_romaji], 4) ??
    rankOf(designers, 6) ??
    rankOf([entry.version, entry.subcategory, entry.genre, entry.id], 8) ??
    10
  );
}

export function buildCatalogSearchWithMatches<T extends SearchableEntry>(entries: T[]) {
  // Both indexes are built on the first non-empty query, never here. Building
  // the Fuse index over the full catalog costs tens to hundreds of milliseconds
  // (4–6× that on a mid-range phone), and the browse page mounts with an empty
  // query far more often than anyone types into it — paying that on every
  // render of a page whose search box is never touched is pure waste.
  let fuse: Fuse<T> | null = null;
  let rows: SearchRow[] | null = null;

  return (query: string): CatalogSearchResult<T>[] => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return entries.map((entry) => ({ entry, aliasHit: null }));
    }

    const loweredQuery = normalizedQuery.toLowerCase();

    // Pass 1 — plain case-insensitive substring, over every field a query may
    // hit. Fuse alone cannot serve these: its weighted product score punishes a
    // hit on a low-weight field so hard that an exact one still lands past
    // `maxAcceptedScore` (searching "BUDDiES" scored 0.88 and was dropped
    // entirely, even though it is literally part of the version name). Raising
    // the threshold instead would let real noise through, so the exact matches
    // get their own deterministic pass and rank ahead of the fuzzy ones.
    rows ??= entries.map(buildSearchRow);
    const exact: { entry: T; aliasHit: string | null; rank: number }[] = [];
    const seen = new Set<T>();
    for (let index = 0; index < entries.length; index += 1) {
      const row = rows[index];
      if (!row.haystack.includes(loweredQuery)) continue;
      const entry = entries[index];
      seen.add(entry);
      exact.push({
        entry,
        aliasHit: substringAliasHit(entry, loweredQuery),
        rank: substringRank(entry, row.designers, loweredQuery),
      });
    }
    // Stable, so entries sharing a rank keep catalog order.
    exact.sort((a, b) => a.rank - b.rank);

    fuse ??= new Fuse<T>(entries, fuseOptions);
    const fuzzy = fuse
      .search(normalizedQuery)
      .filter((result) => result.score === undefined || result.score <= maxAcceptedScore)
      .filter((result) => !seen.has(result.item))
      .map((result) => ({
        entry: result.item,
        aliasHit: pickAliasHit(result.item, result.matches, loweredQuery),
      }));

    return [
      ...exact.map(({ entry, aliasHit }) => ({ entry, aliasHit })),
      ...fuzzy,
    ];
  };
}

export function buildCatalogSearch<T extends SearchableEntry>(entries: T[]) {
  const search = buildCatalogSearchWithMatches(entries);
  return (query: string): T[] => search(query).map((result) => result.entry);
}

/** The category/version slice used by the browse filters. */
type CategorizedEntry = Pick<CatalogEntry, "category" | "subcategory">;

export function applyCatalogFilters<T extends CategorizedEntry>(
  entries: T[],
  category: string,
  subcategory: string
): T[] {
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

export function getCategoryOptions(entries: readonly CategorizedEntry[]): string[] {
  return [
    ALL_CATEGORIES,
    ...Array.from(new Set(entries.map((entry) => entry.category))).sort(),
  ];
}

export function getSubcategoryOptions(
  entries: readonly CategorizedEntry[],
  category: string
): string[] {
  const scopedEntries =
    category === ALL_CATEGORIES
      ? entries
      : entries.filter((entry) => entry.category === category);

  return [
    ALL_SUBCATEGORIES,
    ...Array.from(new Set(scopedEntries.map((entry) => entry.subcategory))).sort(),
  ];
}
