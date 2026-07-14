"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { SearchIcon } from "lucide-react";
import { useMotionValue, useSpring, type Variants } from "framer-motion";

import { AnimatePresence, EASE_OUT, motion, springSoft, useReducedMotion } from "@/components/motion";
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

const MotionLink = motion.create(Link);

// Rotating example queries for the idle placeholder — one per field the fuzzy
// search matches on (title, 别名/alias, artist, genre). The search index only
// loads on first focus, so these are hardcoded rather than sourced from data.
const PLACEHOLDER_EXAMPLES = [
  "PANDORA PARADOXXX",
  "潘多拉",
  "sasakure.UK",
  "niconico＆VOCALOID",
  "系ぎて",
];
const PLACEHOLDER_CYCLE_MS = 3200;

// Hydration + hover-capability detection without setState-in-effect: both are
// external facts (client vs static HTML, pointer hardware) read via
// useSyncExternalStore so the server snapshot stays deterministic.
function subscribeToNothing() {
  return () => {};
}

const HOVER_QUERY = "(hover: hover)";

function subscribeToHoverCapable(onChange: () => void) {
  const media = window.matchMedia(HOVER_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// Transform-only mount cascade: chips must stay fully visible in the static
// HTML, so the hidden state offsets y but never touches opacity.
const chipVariants: Variants = {
  hidden: { y: 6 },
  visible: { y: 0 },
};

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
  const reduced = useReducedMotion();
  const [query, setQuery] = React.useState("");
  // The committed suggestion query: debounced, never set mid-IME-composition.
  const [suggestQuery, setSuggestQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // Flips on first focus and stays on — keys the lazy index fetch.
  const [indexWanted, setIndexWanted] = React.useState(false);
  // The cycling-placeholder overlay is post-hydration only, so the static HTML
  // keeps the real placeholder attribute for crawlers and no-JS readers.
  const mounted = React.useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
  const [exampleIndex, setExampleIndex] = React.useState(0);

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

  // Lead with the real placeholder so the hydration handoff to the overlay is
  // invisible, then rotate through the example queries.
  const placeholderPhrases = React.useMemo(
    () => [placeholder, ...PLACEHOLDER_EXAMPLES],
    [placeholder]
  );
  const cyclingPlaceholder = mounted && !reduced && !focused && query === "";

  React.useEffect(() => {
    if (!cyclingPlaceholder) return;
    let intervalId: number | null = null;
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = () => {
      if (intervalId === null) {
        intervalId = window.setInterval(() => {
          setExampleIndex((previous) => (previous + 1) % placeholderPhrases.length);
        }, PLACEHOLDER_CYCLE_MS);
      }
    };
    // Don't churn placeholder swaps in a hidden tab.
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cyclingPlaceholder, placeholderPhrases.length]);

  // Magnetic submit button: leans toward the cursor by up to ~8px. Pointer-only
  // (hover-capable devices) and skipped under reduced motion — MotionConfig
  // does not gate style-bound motion values, so this is gated by hand.
  const hoverCapable = React.useSyncExternalStore(
    subscribeToHoverCapable,
    () => window.matchMedia(HOVER_QUERY).matches,
    () => false
  );
  const magnetic = hoverCapable && !reduced;

  const magnetX = useMotionValue(0);
  const magnetY = useMotionValue(0);
  const submitX = useSpring(magnetX, { stiffness: 320, damping: 26, mass: 0.5 });
  const submitY = useSpring(magnetY, { stiffness: 320, damping: 26, mass: 0.5 });

  React.useEffect(() => {
    if (!magnetic) {
      magnetX.set(0);
      magnetY.set(0);
    }
  }, [magnetic, magnetX, magnetY]);

  const onSubmitPointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!magnetic) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // -0.5..0.5 across the padded hitbox → a lean of up to ±8px.
    magnetX.set(((event.clientX - rect.left) / rect.width - 0.5) * 16);
    magnetY.set(((event.clientY - rect.top) / rect.height - 0.5) * 16);
  };
  const onSubmitPointerLeave = () => {
    magnetX.set(0);
    magnetY.set(0);
  };

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
      <motion.form
        onSubmit={submit}
        // z-30 keeps the suggestion dropdown above the genre chips below: the
        // focus scale makes this form a stacking context, so the listbox's
        // z-50 no longer competes globally — the chips' own transforms would
        // otherwise paint over it in DOM order.
        className="relative isolate z-30 flex gap-2"
        initial={false}
        animate={{ scale: focused ? 1.005 : 1 }}
        transition={springSoft}
      >
        {/* Focus glow echoing the h1 gradient: pre-blurred, crossfaded via
            opacity only (never animate filter). Decorative, so opacity:0 in
            the static HTML is fine. */}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: focused ? 1 : 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="pointer-events-none absolute -inset-2 -z-10 rounded-2xl bg-gradient-to-r from-primary/30 via-violet-500/20 to-fuchsia-500/30 blur-lg"
        />
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
              setFocused(true);
              setIndexWanted(true);
              setOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              closeList();
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={submitLabel}
            className={cn(
              "h-12 rounded-xl border-border/70 bg-background/70 pl-11 text-base shadow-sm backdrop-blur",
              // The real placeholder attribute stays in the HTML for no-JS;
              // hide it via CSS only while the cycling overlay stands in.
              cyclingPlaceholder && "placeholder:text-transparent"
            )}
          />
          {cyclingPlaceholder ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-3 left-11 flex items-center overflow-hidden text-base text-muted-foreground md:text-sm"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={exampleIndex}
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                  className="truncate"
                >
                  {placeholderPhrases[exampleIndex]}
                </motion.span>
              </AnimatePresence>
            </span>
          ) : null}
          <AnimatePresence>
            {showList ? (
              <motion.ul
                id={listboxId}
                role="listbox"
                aria-label={dictionary.home.searchSuggestionsLabel}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="absolute top-full right-0 left-0 z-50 mt-2 origin-top overflow-hidden rounded-xl border border-border/70 bg-popover py-1 text-popover-foreground shadow-lg"
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
                          "relative flex flex-col gap-0.5 px-4 py-2 text-left transition-colors",
                          active && "text-accent-foreground"
                        )}
                      >
                        {active ? (
                          // One shared layoutId so the highlight glides between
                          // rows on keyboard/mouse moves instead of jumping.
                          <motion.span
                            layoutId="hero-suggestion-highlight"
                            transition={springSoft}
                            aria-hidden="true"
                            className="absolute inset-x-1 inset-y-0.5 rounded-lg bg-accent"
                          />
                        ) : null}
                        <span className="relative truncate text-sm font-medium">
                          {formatEntryTitle(result.entry, locale)}
                        </span>
                        <span className="relative truncate text-xs text-muted-foreground">
                          {formatEntryArtist(result.entry, locale)}
                          {result.aliasHit
                            ? ` · ${dictionary.catalogBrowser.aliasMatchLabel}: ${result.aliasHit}`
                            : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </motion.ul>
            ) : null}
          </AnimatePresence>
        </div>
        {/* Padded hitbox (-m/p cancel in layout) so the lean starts a touch
            before the cursor reaches the button itself. */}
        <span
          className="-m-2 shrink-0 p-2"
          onPointerMove={onSubmitPointerMove}
          onPointerLeave={onSubmitPointerLeave}
        >
          <motion.span className="block" style={{ x: submitX, y: submitY }}>
            <Button type="submit" size="lg" className="h-12 px-5">
              <SearchIcon data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">{submitLabel}</span>
            </Button>
          </motion.span>
        </span>
      </motion.form>

      {genres.length > 0 ? (
        <motion.div
          className="flex flex-wrap items-center gap-1.5"
          initial="hidden"
          animate="visible"
          // Stagger lives on the parent so each chip's own transition stays
          // delay-free for hover/tap and hover-exit.
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
        >
          {quickLabel ? (
            <span className="mr-1 text-xs text-muted-foreground">{quickLabel}</span>
          ) : null}
          {genres.map((genre) => (
            <MotionLink
              key={genre.id}
              href={`${searchHref}?genre=${genre.id}`}
              variants={chipVariants}
              whileHover={{ scale: 1.06, y: -1 }}
              whileTap={{ scale: 0.94 }}
              transition={springSoft}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium opacity-80 transition-opacity hover:opacity-100",
                genre.badge
              )}
            >
              {genre.label}
            </MotionLink>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}
