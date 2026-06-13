"use client";

import * as React from "react";
import Link from "next/link";
import {
  DownloadIcon,
  ExternalLinkIcon,
  SearchIcon,
} from "lucide-react";

import { EntryAssetBadges } from "@/components/site/entry-asset-badges";
import { EntryCover } from "@/components/site/entry-cover";
import {
  ALL_CATEGORIES,
  ALL_SUBCATEGORIES,
  applyCatalogFilters,
  buildCatalogSearch,
  getCategoryOptions,
  getSubcategoryOptions,
} from "@/lib/catalog-search";
import type { CatalogEntry } from "@/lib/catalog-shared";
import {
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { toRouteSlug } from "@/lib/route-slug";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
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
  detailPathPrefix = "/charts",
}: CatalogBrowserProps) {
  const dictionary = getDictionary(locale).catalogBrowser;
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(initialCategory);
  const [subcategory, setSubcategory] = React.useState(ALL_SUBCATEGORIES);
  const [hasUserSelectedCategory, setHasUserSelectedCategory] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);

  const search = React.useMemo(() => buildCatalogSearch(entries), [entries]);
  const hasQuery = query.trim().length > 0;
  const categories = React.useMemo(() => getCategoryOptions(entries), [entries]);
  const resolvedCategory = categories.includes(category) ? category : ALL_CATEGORIES;
  const effectiveCategory =
    hasQuery && !hasUserSelectedCategory ? ALL_CATEGORIES : resolvedCategory;
  const baseEntries = React.useMemo(() => search(query), [search, query]);
  const subcategories = React.useMemo(
    () => getSubcategoryOptions(baseEntries, effectiveCategory),
    [baseEntries, effectiveCategory]
  );
  const resolvedSubcategory = subcategories.includes(subcategory)
    ? subcategory
    : ALL_SUBCATEGORIES;
  const visibleEntries = React.useMemo(
    () => applyCatalogFilters(baseEntries, effectiveCategory, resolvedSubcategory),
    [baseEntries, effectiveCategory, resolvedSubcategory]
  );
  const selectedSubcategoryLabel =
    resolvedSubcategory === ALL_SUBCATEGORIES
      ? dictionary.allSubcategories
      : resolvedSubcategory;
  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedEntries = React.useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * PAGE_SIZE;
    return visibleEntries.slice(startIndex, startIndex + PAGE_SIZE);
  }, [safeCurrentPage, visibleEntries]);
  const pageStart =
    visibleEntries.length === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safeCurrentPage * PAGE_SIZE, visibleEntries.length);

  return (
    <div className="flex flex-col gap-6">
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
              {selectedSubcategoryLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {subcategories.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === ALL_SUBCATEGORIES ? dictionary.allSubcategories : value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {visibleEntries.length === 0 ? (
        <Card size="sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {dictionary.emptyState}
          </CardContent>
        </Card>
      ) : (
        <div
          data-layout="card-grid"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {paginatedEntries.map((entry) => (
            <Card
              key={entry.id}
              size="sm"
              className="flex h-full overflow-hidden border border-border/70 bg-card/80"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <div
                  data-entry-cover="compact"
                  className="aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-border/60"
                >
                  <EntryCover entry={entry} locale={locale} className="h-full w-full" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
                  <div className="flex min-w-0 flex-col gap-4">
                    <div data-entry-meta="primary" className="flex min-w-0 flex-1 flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{formatEntrySubcategory(entry)}</Badge>
                        {entry.category !== "Remote" && entry.version ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            {entry.version}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="line-clamp-1">
                          {formatEntryTitle(entry, locale)}
                        </CardTitle>
                        <CardDescription className="line-clamp-1">
                          {formatEntryArtist(entry, locale)}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.difficulties.slice(0, 5).map((difficulty) => (
                          <Badge key={`${entry.id}-${difficulty.slot}`} variant="outline">
                            {difficulty.level || `Lv.${difficulty.slot}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div
                      data-entry-actions="compact"
                      className="mt-auto flex flex-wrap items-center gap-2"
                    >
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`${detailPathPrefix}/${toRouteSlug(entry.id)}`}>
                          <SearchIcon data-icon="inline-start" />
                          {dictionary.details}
                        </Link>
                      </Button>
                      {(entry.download_mode === "onsite" || entry.download_mode === "mixed") && (
                        <Button size="sm" asChild>
                          <Link href={`${detailPathPrefix}/${toRouteSlug(entry.id)}`}>
                            <DownloadIcon data-icon="inline-start" />
                            {dictionary.download}
                          </Link>
                        </Button>
                      )}
                      {(entry.download_mode === "external" || entry.download_mode === "mixed") &&
                      entry.source_url ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={entry.source_url} target="_blank" rel="noreferrer">
                            <ExternalLinkIcon data-icon="inline-start" />
                            {dictionary.source}
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div
                    data-entry-summary="secondary"
                    className="flex min-w-0 flex-col gap-3 border-t border-border/50 pt-3 text-sm text-muted-foreground"
                  >
                    <div className="flex flex-wrap gap-2">
                      <EntryAssetBadges entry={entry} locale={locale} />
                    </div>
                    <p className="line-clamp-2">
                      {entry.version || entry.genre || "AstroDX remote directory entry"}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {totalPages > 1 ? (
            <Card size="sm" className="border border-border/70 bg-card/70">
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
        </div>
      )}
    </div>
  );
}
