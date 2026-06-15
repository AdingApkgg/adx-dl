"use client";

import * as React from "react";
import Image from "next/image";
import { SearchIcon } from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { ChartCard } from "@/components/site/chart-card";
import {
  ALL_CATEGORIES,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearch,
  getCategoryOptions,
  getSubcategoryOptions,
} from "@/lib/catalog-search";
import type { CatalogEntry } from "@/lib/catalog-shared";
import { GENRES, resolveGenreId, sortByReleaseDesc } from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CatalogBrowserProps = {
  entries: CatalogEntry[];
  initialCategory?: string;
  locale?: "zh" | "en" | "ja";
  detailPathPrefix?: string;
};

const PAGE_SIZE = 24;

export function CatalogBrowser({
  entries,
  initialCategory = "Remote",
  locale = "zh",
}: CatalogBrowserProps) {
  const dictionary = getDictionary(locale).catalogBrowser;
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(initialCategory);
  const [subcategory, setSubcategory] = React.useState(ALL_SUBCATEGORIES);
  const [genre, setGenre] = React.useState("all");
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);

  const search = React.useMemo(() => buildCatalogSearch(entries), [entries]);
  const hasQuery = query.trim().length > 0;
  const categories = React.useMemo(() => getCategoryOptions(entries), [entries]);
  const resolvedCategory = categories.includes(category) ? category : ALL_CATEGORIES;
  const effectiveCategory =
    hasQuery && !hasUserSelectedCategory ? ALL_CATEGORIES : resolvedCategory;
  const baseEntries = React.useMemo(() => search(query), [search, query]);
  const subcategories = React.useMemo(() => {
    const options = getSubcategoryOptions(baseEntries, effectiveCategory);
    // Order versions newest-first (matches the release-order sort everywhere else).
    const versions = options
      .filter((value) => value !== ALL_SUBCATEGORIES)
      .sort((a, b) => (versionImageIndex(b) ?? -1) - (versionImageIndex(a) ?? -1));
    return [ALL_SUBCATEGORIES, ...versions];
  }, [baseEntries, effectiveCategory]);
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
  const visibleEntries = React.useMemo(() => {
    const filtered = applyCatalogFilters(baseEntries, effectiveCategory, resolvedSubcategory);
    return genre === "all"
      ? filtered
      : filtered.filter((entry) => String(resolveGenreId(entry)) === genre);
  }, [baseEntries, effectiveCategory, resolvedSubcategory, genre]);
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

  return (
    <div className="flex flex-col gap-6">
      {categories.length > 2 ? (
        <Tabs
          value={effectiveCategory}
          onValueChange={(value) => {
            setCategory(value);
            setSubcategory(ALL_SUBCATEGORIES);
            setHasUserSelectedCategory(true);
            setCurrentPage(1);
          }}
        >
          <TabsList variant="line" className="w-full justify-start overflow-x-auto">
            {categories.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value === ALL_CATEGORIES ? dictionary.allCategories : value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={dictionary.searchPlaceholder}
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;

              setQuery(nextQuery);
              setSubcategory(ALL_SUBCATEGORIES);
              setCurrentPage(1);
              if (!nextQuery.trim()) {
                setHasUserSelectedCategory(false);
              }
            }}
          />
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
      </div>

      {genreOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.93 }}
            onClick={() => {
              setGenre("all");
              setCurrentPage(1);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
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
                onClick={() => {
                  setGenre(active ? "all" : String(id));
                  setCurrentPage(1);
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
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

      {visibleEntries.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
        >
          <Card size="sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {dictionary.emptyState}
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
            {paginatedEntries.map((entry) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className="h-full"
              >
                <ChartCard entry={entry} locale={locale} />
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
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage === 1}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  >
                    {dictionary.previousPage}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeCurrentPage === totalPages}
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                  >
                    {dictionary.nextPage}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </motion.div>
      )}
    </div>
  );
}
