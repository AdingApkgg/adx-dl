import Link from "next/link";

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

  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
    >
      <div className="aspect-square overflow-hidden border-b border-border/60">
        <EntryCover
          entry={entry}
          locale={locale}
          priority={priority}
          sizes={sizes}
          className="h-full w-full"
        />
      </div>
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
    </Link>
  );
}
