import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { CabinetBadge } from "@/components/site/cabinet-badge";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryCover } from "@/components/site/entry-cover";
import { GenreBadge } from "@/components/site/genre-badge";
import { VersionBadge } from "@/components/site/version-badge";
import {
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { cn } from "@/lib/utils";

// Keep compact cards tidy: show a few alias chips inline, the rest as a "+N"
// overflow. The full list is still on the detail page and in the title tooltip.
const MAX_VISIBLE_ALIASES = 3;

type ChartCardProps = {
  entry: CatalogEntry;
  locale: Locale;
  /** Eagerly load above-the-fold covers (LCP). */
  priority?: boolean;
  sizes?: string;
  /** The alias that matched the current search, shown as a hint to explain the hit. */
  aliasHit?: string | null;
  /** In select mode the card toggles selection instead of navigating to the detail page. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
};

// The single chart card used on the home page and in the catalog browser. The
// whole card is a link to the detail page (no separate buttons) so a tap/click
// anywhere opens it.
export function ChartCard({
  entry,
  locale,
  priority = false,
  sizes,
  aliasHit = null,
  selectable = false,
  selected = false,
  onToggleSelect,
}: ChartCardProps) {
  const href = buildLocalePath(`/charts/${entrySlug(entry)}`, locale);
  const dictionary = getDictionary(locale);
  const aliasMatchLabel = dictionary.catalogBrowser.aliasMatchLabel;
  const aliasesLabel = dictionary.detail.aliasesLabel;

  const aliases = entry.aliases ?? [];
  // Float the search-matched alias first so it's always visible within the cap.
  const orderedAliases =
    aliasHit && aliases.includes(aliasHit)
      ? [aliasHit, ...aliases.filter((alias) => alias !== aliasHit)]
      : aliases;
  const visibleAliases = orderedAliases.slice(0, MAX_VISIBLE_ALIASES);
  const overflowCount = orderedAliases.length - visibleAliases.length;

  const cardClassName = cn(
    "group flex h-full flex-col overflow-hidden rounded-xl border bg-card/80 transition-all",
    selectable
      ? cn(
          "cursor-pointer",
          selected
            ? "border-primary ring-2 ring-primary"
            : "border-border/70 hover:border-primary/40"
        )
      : "border-border/70 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
  );

  const cover = (
    <div className="relative aspect-square overflow-hidden border-b border-border/60">
      <EntryCover
        entry={entry}
        locale={locale}
        priority={priority}
        sizes={sizes}
        className="h-full w-full"
      />
      {selectable ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border shadow-sm transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/70 bg-background/80 text-transparent"
          )}
        >
          <CheckIcon className="size-4" />
        </span>
      ) : null}
    </div>
  );

  const body = (
    <>
      {cover}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 sm:p-4">
        <div className="min-w-0">
          <h3 className="line-clamp-1 font-semibold leading-snug">
            {formatEntryTitle(entry, locale)}
          </h3>
          <p className="line-clamp-1 text-sm text-muted-foreground">
            {formatEntryArtist(entry, locale)}
          </p>
          {aliases.length > 0 ? (
            <ul
              className="mt-1.5 flex flex-wrap gap-1"
              title={`${aliasesLabel}: ${aliases.join("、")}`}
            >
              {visibleAliases.map((alias) => {
                const matched = alias === aliasHit;
                return (
                  <li
                    key={alias}
                    title={matched ? `${aliasMatchLabel}: ${alias}` : undefined}
                    className={cn(
                      "max-w-full truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight",
                      matched
                        ? "border-primary/40 bg-primary/10 font-medium text-primary"
                        : "border-border/60 bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {alias}
                  </li>
                );
              })}
              {overflowCount > 0 ? (
                <li className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground">
                  +{overflowCount}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <VersionBadge version={entry.version} label={formatEntrySubcategory(entry)} />
          <CabinetBadge cabinet={entry.cabinet} />
          <GenreBadge entry={entry} locale={locale} />
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5">
          {entry.difficulties.slice(0, 5).map((difficulty) => (
            <DifficultyPill key={`${entry.id}-${difficulty.slot}`} difficulty={difficulty} />
          ))}
        </div>
      </div>
    </>
  );

  if (selectable) {
    return (
      <div
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        onClick={onToggleSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleSelect?.();
          }
        }}
        className={cardClassName}
      >
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className={cardClassName}>
      {body}
    </Link>
  );
}
