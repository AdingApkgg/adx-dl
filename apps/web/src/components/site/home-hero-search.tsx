"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildCatalogSearchWithMatches,
  type CatalogSearchIndexEntry,
  type CatalogSearchResult,
} from "@/lib/catalog-search";
import { formatEntryArtist, formatEntryTitle } from "@/lib/catalog-shared";
import { defaultLocale, getDictionary, isSupportedLocale, type Locale } from "@/lib/i18n";
import { jsonFetcher } from "@/lib/swr-fetcher";
import { cn } from "@/lib/utils";

export type HeroGenreChip = {
  id: number;
  label: string;
  /** Tailwind badge classes from GENRES[id].badge. */
  badge: string;
};

type HomeHeroSearchProps = {
  /** Locale-aware base path for the search page, e.g. "/search" or "/en/search". */
  searchHref: string;
  placeholder: string;
  submitLabel: string;
  /** Optional lead-in shown before the genre quick-filter chips. */
  quickLabel?: string;
  genres?: HeroGenreChip[];
};

// Slim build-time search index (id/slug/titles/artists/aliases) fetched lazily
// on first focus, so the home page payload stays free of the catalog.
const SEARCH_INDEX_PATH = "/charts/search-index.json";
const SUGGESTION_LIMIT = 6;
// Short debounce: suggestions should feel immediate but not churn per keystroke.
const SUGGEST_DEBOUNCE_MS = 150;

// The page only hands us the locale-prefixed search path; recover the locale
// from it so suggestion labels and detail links localize without a prop change.
function localeFromHref(href: string): Locale {
  const [first] = href.split("/").filter(Boolean);
  return first && isSupportedLocale(first) ? first : defaultLocale;
}

// The hero search box: a real query input that routes to the search page
// (?q=...), plus genre quick-filter chips that deep-link into pre-filtered
// results (?genre=...). The search page's CatalogBrowser reads these params on
// mount, so a landing query/genre lands already applied. While typing, a
// combobox dropdown offers instant fuzzy matches that link straight to chart
// detail pages; Enter without a highlighted option keeps the plain submit.
export function HomeHeroSearch({
  searchHref,
  placeholder,
  submitLabel,
  quickLabel,
  genres = [],
}: HomeHeroSearchProps) {
  const router = useRouter();
  const locale = localeFromHref(searchHref);
  const dictionary = getDictionary(locale);
  const [query, setQuery] = React.useState("");
  // The committed suggestion query: debounced, never set mid-IME-composition.
  const [suggestQuery, setSuggestQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // Flips on first focus and stays on — keys the lazy index fetch.
  const [indexWanted, setIndexWanted] = React.useState(false);

  const isComposingRef = React.useRef(false);
  const debounceRef = React.useRef<number | null>(null);
  const listboxId = React.useId();

  const { data: index } = useSWR<CatalogSearchIndexEntry[]>(
    indexWanted ? SEARCH_INDEX_PATH : null,
    jsonFetcher
  );

  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    []
  );

  const search = React.useMemo(
    () => (index ? buildCatalogSearchWithMatches(index) : null),
    [index]
  );
  const suggestions = React.useMemo<CatalogSearchResult<CatalogSearchIndexEntry>[]>(
    () => (search && suggestQuery.trim() ? search(suggestQuery).slice(0, SUGGESTION_LIMIT) : []),
    [search, suggestQuery]
  );
  const showList = open && suggestions.length > 0;

  const scheduleSuggest = React.useCallback((value: string) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      setSuggestQuery(value);
      setActiveIndex(-1);
      setOpen(true);
    }, SUGGEST_DEBOUNCE_MS);
  }, []);

  const optionId = (suggestionIndex: number) => `${listboxId}-option-${suggestionIndex}`;
  const detailHref = (entry: CatalogSearchIndexEntry) =>
    `${searchHref}/${encodeURIComponent(entry.slug)}`;

  const closeList = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    closeList();
    const trimmed = query.trim();
    router.push(trimmed ? `${searchHref}?q=${encodeURIComponent(trimmed)}` : searchHref);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Mid-composition keys belong to the IME (e.g. Enter confirms the buffer).
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!showList) return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Cycle through "no selection" (-1) and the options: -1 → 0 … last → -1,
      // so Enter after stepping past the ends falls back to the plain submit.
      setActiveIndex((previous) => {
        const cycle = suggestions.length + 1;
        return ((previous + 1 + delta + cycle) % cycle) - 1;
      });
      return;
    }
    if (event.key === "Escape" && showList) {
      event.preventDefault();
      closeList();
      return;
    }
    if (event.key === "Enter" && showList && activeIndex >= 0) {
      event.preventDefault();
      const target = suggestions[activeIndex];
      if (target) {
        closeList();
        router.push(detailHref(target.entry));
      }
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listboxId : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              // Mid-composition updates are IME buffer states — wait for the end.
              if (isComposingRef.current) return;
              scheduleSuggest(nextValue);
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              scheduleSuggest(event.currentTarget.value);
            }}
            onFocus={() => {
              setIndexWanted(true);
              setOpen(true);
            }}
            onBlur={closeList}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={submitLabel}
            className="h-12 rounded-xl border-border/70 bg-background/70 pl-11 text-base shadow-sm backdrop-blur"
          />
          {showList ? (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={dictionary.home.searchSuggestionsLabel}
              className="absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden rounded-xl border border-border/70 bg-popover py-1 text-popover-foreground shadow-lg"
            >
              {suggestions.map((result, suggestionIndex) => {
                const active = suggestionIndex === activeIndex;
                return (
                  <li
                    key={result.entry.id}
                    id={optionId(suggestionIndex)}
                    role="option"
                    aria-selected={active}
                  >
                    <Link
                      href={detailHref(result.entry)}
                      prefetch={false}
                      tabIndex={-1}
                      // Keep focus in the input so blur doesn't close the list
                      // before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(suggestionIndex)}
                      onClick={closeList}
                      className={cn(
                        "flex flex-col gap-0.5 px-4 py-2 text-left transition-colors",
                        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                      )}
                    >
                      <span className="truncate text-sm font-medium">
                        {formatEntryTitle(result.entry, locale)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatEntryArtist(result.entry, locale)}
                        {result.aliasHit
                          ? ` · ${dictionary.catalogBrowser.aliasMatchLabel}: ${result.aliasHit}`
                          : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="h-12 shrink-0 px-5">
          <SearchIcon data-icon="inline-start" aria-hidden="true" />
          <span className="hidden sm:inline">{submitLabel}</span>
        </Button>
      </form>

      {genres.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {quickLabel ? (
            <span className="mr-1 text-xs text-muted-foreground">{quickLabel}</span>
          ) : null}
          {genres.map((genre) => (
            <Link
              key={genre.id}
              href={`${searchHref}?genre=${genre.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium opacity-80 transition-opacity hover:opacity-100",
                genre.badge
              )}
            >
              {genre.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
