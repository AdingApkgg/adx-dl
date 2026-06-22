"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// The hero search box: a real query input that routes to the search page
// (?q=...), plus genre quick-filter chips that deep-link into pre-filtered
// results (?genre=...). The search page's CatalogBrowser reads these params on
// mount, so a landing query/genre lands already applied.
export function HomeHeroSearch({
  searchHref,
  placeholder,
  submitLabel,
  quickLabel,
  genres = [],
}: HomeHeroSearchProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    router.push(trimmed ? `${searchHref}?q=${encodeURIComponent(trimmed)}` : searchHref);
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={submitLabel}
            className="h-12 rounded-xl border-border/70 bg-background/70 pl-11 text-base shadow-sm backdrop-blur"
          />
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
