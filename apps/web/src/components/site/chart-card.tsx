import Link from "next/link";

import { CabinetBadge } from "@/components/site/cabinet-badge";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { EntryCover } from "@/components/site/entry-cover";
import { GenreBadge } from "@/components/site/genre-badge";
import { SelectCheckBadge } from "@/components/site/select-check-badge";
import { VersionBadge } from "@/components/site/version-badge";
import {
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogCardEntry,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { japaneseTextLang } from "@/lib/text-lang";
import { entrySlug } from "@/lib/route-slug";
import { cn } from "@/lib/utils";

// Keep compact cards tidy: show a few alias chips inline, the rest as a "+N"
// overflow. The full list is still on the detail page and in the title tooltip.
const MAX_VISIBLE_ALIASES = 3;

// EntryCover and GenreBadge type their prop as the full CatalogEntry, but they
// only read fields present on the card slice (cover media, title, branch,
// genre). Stub the heavy fields so slim card entries can reuse them. Runs at
// render time only, so the stubs never inflate a serialized page payload.
function toFullEntryStub(entry: CatalogCardEntry): CatalogEntry {
  return {
    ...entry,
    remote_dir_name: "",
    source_archive: "",
    source_folder: "",
    bpm: null,
    offset: null,
    download_mode: "onsite",
    download_url: "",
    source_url: "",
    license_note: "",
    files: { maidata: "", maidata_dx: "", audio: "", background: "", pv: "" },
    assets: {
      has_audio: false,
      has_background: false,
      has_pv: false,
      has_dx_chart: false,
    },
    media: { entry_base_url: "", audio_url: "", pv_url: "", ...entry.media },
  };
}

type ChartCardProps = {
  entry: CatalogCardEntry;
  locale: Locale;
  /** Homepage/editorial surfaces can preserve the entire cover instead of cropping it. */
  coverFit?: "cover" | "contain";
  /** Eagerly load above-the-fold covers (LCP). */
  priority?: boolean;
  sizes?: string;
  /** The alias that matched the current search, shown as a hint to explain the hit. */
  aliasHit?: string | null;
  /**
   * Marks a chart the archive imported recently. Passed in rather than derived
   * from `entry.imported_at`, which the card slice does carry: the window has to
   * be measured against the catalog's `generated_at` (see `isRecentImport`) and
   * never against a render-time clock, and only the server surfaces holding the
   * full catalog know that instant.
   */
  isNew?: boolean;
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
  coverFit = "cover",
  priority = false,
  sizes,
  aliasHit = null,
  isNew = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: ChartCardProps) {
  const href = buildLocalePath(`/charts/${entrySlug(entry)}`, locale);
  const fullEntry = toFullEntryStub(entry);
  const dictionary = getDictionary(locale);
  const aliasMatchLabel = dictionary.catalogBrowser.aliasMatchLabel;
  const aliasesLabel = dictionary.detail.aliasesLabel;

  // Stable per-card id so the ARIA checkbox below can name itself from the
  // heading it already renders.
  const titleId = `chart-card-title-${entry.id}`;

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
          // The selectable card is a bare div, so it never picked up the focus
          // ring the Button/Link primitives carry.
          "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected
            ? "border-primary ring-2 ring-primary"
            : "border-border/70 hover:border-primary/40"
        )
      : "border-border/70 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
  );

  const cover = (
    <div className="relative aspect-square overflow-hidden border-b border-border/60">
      <EntryCover
        entry={fullEntry}
        locale={locale}
        fit={coverFit}
        priority={priority}
        sizes={sizes}
        className="h-full w-full"
      />
      {selectable ? <SelectCheckBadge selected={selected} /> : null}
      {/* Top-right: the opposite corner from SelectCheckBadge, so a freshly
          imported chart shown in select mode carries both without overlap. */}
      {isNew ? (
        <span
          title={dictionary.catalogBrowser.newBadgeHint}
          className="absolute top-2 right-2 rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-semibold uppercase leading-tight tracking-wide text-primary-foreground shadow-sm"
        >
          {dictionary.catalogBrowser.newBadge}
        </span>
      ) : null}
    </div>
  );

  const title = formatEntryTitle(entry, locale);
  const artist = formatEntryArtist(entry, locale);

  const body = (
    <>
      {cover}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3 sm:p-4">
        <div className="min-w-0">
          <h3
            id={titleId}
            lang={japaneseTextLang(title)}
            className="line-clamp-1 font-semibold leading-snug"
          >
            {title}
          </h3>
          <p
            lang={japaneseTextLang(artist)}
            className="line-clamp-1 text-sm text-muted-foreground"
          >
            {artist}
          </p>
          {aliases.length > 0 ? (
            // Aliases are Chinese community nicknames; tagging them keeps them
            // in a Simplified-Chinese font (and voice) on the ja tree.
            <ul
              lang="zh-Hans"
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
          <GenreBadge entry={fullEntry} locale={locale} />
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
        // ARIA checkbox is Name-From-Author: the card's own content does not
        // reach the accessible name, so without this a screen reader announced
        // two dozen identical "checkbox, not checked" rows with no song titles.
        aria-labelledby={titleId}
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
